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

export function attachWebSocket(httpServer, SimEngine, OcppClient, ModbusBus) {
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
    ws.send(JSON.stringify({ type: 'snapshot', data: SimEngine.snapshot() }));

    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const p = msg.payload || {};

      switch (msg.type) {
        case 'start-session':
          SimEngine.startUserSession(p);
          userSessionOwner = ws;
          break;
        case 'stop-session':
          SimEngine.stopUserSession(p.reason);
          if (userSessionOwner === ws) userSessionOwner = null;
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
      if (userSessionOwner === ws) userSessionOwner = null;
    });
  });

  return wss;
}
