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

export function attachWebSocket(httpServer, SimEngine, OcppClient, ModbusBus, authorization) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Conexão do totem dona da sessão do motorista — só ela recebe comandos de
  // relé (ligar/desligar o carregador real via ESP32).
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
    const notifyAuthorization = data => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'authorization', data }));
    };
    ws.send(JSON.stringify({ type: 'snapshot', data: SimEngine.snapshot() }));

    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const p = msg.payload || {};

      switch (msg.type) {
        case 'start-session':
          if (!SiteModel.getEvseByStation(p.stationId) || !p.vehicle || !Number.isFinite(p.vehicle.batteryCapacity)) {
            notifyAuthorization({ status: 'error', message: 'Selecione uma estação e um veículo válidos.' });
            break;
          }
          authorization.request(ws, p.stationId, notifyAuthorization, () => {
            const evse = SiteModel.getEvseByStation(p.stationId);
            if (ws.readyState !== ws.OPEN || evse.status !== 'Available' || SimEngine.userSession) throw new Error('Estação indisponível');
            // O dono é definido antes de o motor emitir LIGAR, após autorização MQTT.
            userSessionOwner = ws;
            SimEngine.startUserSession(p);
            // Inicializa a tela antes do próximo tick, inclusive se DESLIGAR vier logo em seguida.
            ws.send(JSON.stringify({ type: 'snapshot', data: SimEngine.snapshot() }));
          });
          break;
        case 'cancel-authorization':
          authorization.cancel(ws);
          // Cobre a corrida entre o clique em cancelar e a resposta MQTT.
          if (userSessionOwner === ws) {
            SimEngine.stopUserSession('Local');
            userSessionOwner = null;
          }
          break;
        case 'stop-session':
          authorization.cancel(ws);
          if (userSessionOwner !== ws) break;
          SimEngine.stopUserSession(p.reason);
          userSessionOwner = null;
          break;
        case 'mqtt-command':
          authorization.receive(ws, p.command);
          if (p.command === 'DESLIGAR' && userSessionOwner === ws) {
            userSessionOwner = null;
            SimEngine.stopUserSession('Remote');
            notifyAuthorization({ status: 'stopped', message: 'Recarga encerrada por MQTT.' });
          }
          break;
        case 'demo:set-time':
          SimClock.setTime(p.hour, p.minute);
          break;
        case 'demo:nudge':
          SimClock.nudgeMinutes(p.minutes);
          break;
        case 'demo:set-speed':
          SimClock.setSpeed(p.speed);
          break;
        case 'demo:toggle-clock':
          SimClock.toggle();
          break;
        case 'demo:set-day':
          SimClock.setDayOfWeek(p.dow);
          break;
        case 'demo:trigger-peak':
          SiteModel.triggerDemoPeak(p.folga);
          break;
        case 'demo:clear-peak':
          SiteModel.clearDemoPeak();
          break;
        case 'admin:toggle-station':
          SimEngine.toggleStation(p.evseId);
          break;
        default:
          console.warn('[ws] mensagem desconhecida:', msg.type);
      }
    });

    ws.on('close', () => {
      authorization.cancel(ws);
      if (userSessionOwner === ws) {
        SimEngine.stopUserSession('Other');
        userSessionOwner = null;
      }
    });
  });

  return wss;
}
