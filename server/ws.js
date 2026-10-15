/**
 * Canal ao vivo entre o motor de simulação e os clientes (totem + admin).
 *
 * Substitui o antigo `window.SimEngine.onUpdate(...)` chamado dentro da
 * própria página: agora o servidor empurra o snapshot por WebSocket a cada
 * tick (250ms) para todo mundo conectado, e os clientes mandam comandos em
 * vez de chamar o motor direto.
 */
import { WebSocketServer } from 'ws';
import { SimClock, SiteModel } from './sim/engine.js';
import { createRequire } from 'node:module';
import { finiteRange, validSessionConfig } from './sim/validation.js';
const { vehicles } = createRequire(import.meta.url)('../data/mock-data.js');

export function attachWebSocket(httpServer, SimEngine, OcppClient, ModbusBus, authorization, pix) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16384 });

  // A ponte física legada corresponde apenas à estação 1. As sessões
  // pertencem ao servidor e sobrevivem à navegação e reconexão do totem.
  let userSessionOwner = null;

  function broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(json);
    }
  }

  SimEngine.onUpdate(snapshot => broadcast({ type: 'snapshot', data: snapshot }));

  OcppClient.onFrame(frame => {
    if (frame.frame[0] !== 2) return; // só CALL — CALLRESULT é ruído no log
    broadcast({ type: 'ocpp-frame', data: frame });
  });

  ModbusBus.onWrite(write => broadcast({ type: 'modbus-write', data: write }));

  SimEngine.onRelay(command => {
    if (userSessionOwner && userSessionOwner.readyState === userSessionOwner.OPEN) {
      userSessionOwner.send(JSON.stringify({ type: 'relay', command }));
    }
  });

  wss.on('connection', ws => {
    let lastStartedSessionId = null;
    let requestRevision = 0;
    const notifyAuthorization = data => {
      if (data.status === 'approved') data = { ...data, sessionId: lastStartedSessionId };
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'authorization', data }));
    };
    ws.send(JSON.stringify({ type: 'snapshot', data: SimEngine.snapshot() }));

    ws.on('error', () => {}); // malformed or oversized frames must not crash the process
    ws.on('message', async raw => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const p = msg.payload ?? {};
      const commandError = () => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'command-error', data: { command: msg.type, message: 'Comando ou parâmetros inválidos.' } }));
      };
      if (!p || typeof p !== 'object' || Array.isArray(p)) return commandError();

      try {
      switch (msg.type) {
        case 'start-session': {
          const revision = ++requestRevision;
          const vehicle = vehicles.find(v => v.id === p.vehicle?.id);
          const config = { ...p, vehicle };
          if (SiteModel.getEvseByStation(p.stationId)?.status !== 'Available' || !validSessionConfig(config) || !['pix', 'demo', undefined].includes(p.paymentMethod)) {
            notifyAuthorization({ status: 'error', message: 'Selecione uma estação e um veículo válidos.' });
            break;
          }
          let consumePayment;
          if (p.paymentMethod === 'pix') {
            try {
              if (!pix) throw new Error('Validação do pagamento indisponível.');
              consumePayment = await pix.verify(p.paymentId, config);
            } catch (error) {
              if (revision === requestRevision) notifyAuthorization({ status: 'error', message: error.message });
              break;
            }
            if (revision !== requestRevision || ws.readyState !== ws.OPEN) break;
          }
          authorization.request(ws, p.stationId, notifyAuthorization, () => {
            const evse = SiteModel.getEvseByStation(p.stationId);
            if (revision !== requestRevision || ws.readyState !== ws.OPEN || evse.status !== 'Available') throw new Error('Estação indisponível');
            // O dono é definido antes de o motor emitir LIGAR, após autorização MQTT.
            if (evse.stationId === 1) userSessionOwner = ws;
            consumePayment?.(false);
            const session = SimEngine.startUserSession(config);
            if (!session) throw new Error('Estação indisponível');
            consumePayment?.();
            lastStartedSessionId = session.id;
            // Inicializa a tela antes do próximo tick, inclusive se DESLIGAR vier logo em seguida.
            broadcast({ type: 'snapshot', data: SimEngine.snapshot() });
          });
          break;
        }
        case 'cancel-authorization':
          requestRevision++;
          authorization.cancel(ws);
          break;
        case 'stop-session':
          if (typeof p.sessionId !== 'string') break;
          // Consulta e encerramento por estação no totem compartilhado.
          SimEngine.stopUserSession(p.reason, p.sessionId);
          broadcast({ type: 'snapshot', data: SimEngine.snapshot() });
          break;
        case 'mqtt-command': {
          if (!['LIGAR', 'DESLIGAR'].includes(p.command)) return commandError();
          const wasPending = authorization.pending?.owner === ws;
          authorization.receive(ws, p.command);
          if (p.command === 'DESLIGAR' && !wasPending) {
            // Texto puro externo atua somente na estação física legada 1.
            const sessionId = p.sessionId || lastStartedSessionId;
            const session = SimEngine.getUserSession(sessionId);
            if (userSessionOwner !== ws || session?.evse.stationId !== 1) break;
            SimEngine.stopUserSession('Remote', sessionId);
            broadcast({ type: 'snapshot', data: SimEngine.snapshot() });
            notifyAuthorization({ status: 'stopped', sessionId, message: 'Recarga encerrada por MQTT.' });
          }
          break;
        }
        case 'demo:set-time':
          if (!Number.isInteger(p.hour) || !finiteRange(p.hour, 0, 23) || (p.minute != null && (!Number.isInteger(p.minute) || !finiteRange(p.minute, 0, 59)))) return commandError();
          SimClock.setTime(p.hour, p.minute);
          break;
        case 'demo:nudge':
          if (!finiteRange(p.minutes, -1440, 1440)) return commandError();
          SimClock.nudgeMinutes(p.minutes);
          break;
        case 'demo:set-speed':
          if (!finiteRange(p.speed, 1, 240)) return commandError();
          SimClock.setSpeed(p.speed);
          break;
        case 'demo:toggle-clock':
          SimClock.toggle();
          break;
        case 'demo:set-day':
          if (!Number.isInteger(p.dow) || !finiteRange(p.dow, 0, 6)) return commandError();
          SimClock.setDayOfWeek(p.dow);
          break;
        case 'demo:trigger-peak':
          if (!finiteRange(p.folga, 0, 1)) return commandError();
          SiteModel.triggerDemoPeak(p.folga);
          SimEngine.rebalance();
          SimEngine._notify();
          break;
        case 'demo:clear-peak':
          SiteModel.clearDemoPeak();
          SimEngine.rebalance();
          SimEngine._notify();
          break;
        case 'admin:toggle-station':
          SimEngine.toggleStation(p.evseId);
          break;
        default:
          commandError();
      }
      if (String(msg.type).startsWith('demo:') || msg.type === 'admin:toggle-station') SimEngine._notify();
      } catch { commandError(); }
    });

    ws.on('close', () => {
      requestRevision++;
      authorization.cancel(ws);
      if (userSessionOwner === ws) {
        userSessionOwner = null;
      }
    });
  });

  return wss;
}
