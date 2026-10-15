import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import WebSocket from 'ws';
import SimEngine, { SimClock, SiteModel, OcppClient, ModbusBus } from '../sim/engine.js';
import { attachWebSocket } from '../ws.js';
import { MqttAuthorization } from '../mqtt-authorization.js';
const { vehicles } = createRequire(import.meta.url)('../../data/mock-data.js');

function cleanup() {
  SimClock.stop();
  for (const session of [...SiteModel.sessions]) SimEngine.stopUserSession('Local', session.id);
}

test('sessões coexistem; conclusão mantém o carro visível sem afetar outra estação', t => {
  SimEngine.boot({ ambient: 0 });
  SimClock.stop();
  t.after(cleanup);
  const first = SimEngine.startUserSession({ stationId: 1, vehicle: vehicles[0], startSoc: .2, targetSoc: .20001 });
  const second = SimEngine.startUserSession({ stationId: 2, vehicle: vehicles[1], startSoc: .3, targetSoc: .8 });
  assert.equal(SiteModel.sessions.length, 2);
  assert.equal(SimEngine.startUserSession({ stationId: 1, vehicle: vehicles[0] }), null);
  SimEngine._tick(15, SimClock.simDate);
  assert.equal(first.status, 'finished');
  assert.equal(first.evse.status, 'Finishing');
  assert.equal(SimEngine.snapshot().sessions.length, 2);
  assert.ok(second.energyGridKWh > 0);
  const historyCount = SimEngine.totemHistory.records.length;
  SimEngine.stopUserSession('Local', first.id);
  assert.equal(first.evse.status, 'Available');
  assert.equal(SimEngine.totemHistory.records.length, historyCount);
  assert.equal(SiteModel.sessions[0].id, second.id);
});

test('WebSocket: segundo atendimento, cancelamento e reconexão preservam a primeira recarga', { timeout: 5000 }, async t => {
  SimEngine.boot({ ambient: 0 });
  SimClock.stop();
  const authorization = new MqttAuthorization();
  const server = http.createServer();
  const wss = attachWebSocket(server, SimEngine, OcppClient, ModbusBus, authorization);
  t.after(() => {
    authorization.finish('cancelled', 'Fim do teste');
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close();
    cleanup();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  let ws = new WebSocket(url);
  await once(ws, 'open');
  const waitMessage = (socket, predicate) => new Promise(resolve => {
    const listener = raw => {
      const message = JSON.parse(raw);
      if (predicate(message)) { socket.off('message', listener); resolve(message); }
    };
    socket.on('message', listener);
  });
  const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));
  const start = async stationId => {
    let next = waitMessage(ws, m => m.type === 'authorization' && m.data.status === 'waiting');
    send('start-session', { stationId, vehicle: vehicles[stationId - 1], startSoc: .2 });
    await next;
    next = waitMessage(ws, m => m.type === 'authorization' && m.data.status === 'approved');
    send('mqtt-command', { command: 'LIGAR' });
    return (await next).data.sessionId;
  };
  const firstId = await start(1);
  const secondId = await start(2);
  assert.equal(SiteModel.sessions.length, 2);
  let next = waitMessage(ws, m => m.type === 'authorization' && m.data.status === 'waiting');
  send('start-session', { stationId: 3, vehicle: vehicles[2] });
  await next;
  next = waitMessage(ws, m => m.type === 'authorization' && m.data.status === 'cancelled');
  send('cancel-authorization');
  await next;
  assert.equal(SiteModel.sessions.length, 2);
  next = waitMessage(ws, m => m.type === 'authorization' && m.data.status === 'error');
  send('start-session', { stationId: 1, vehicle: vehicles[0] });
  // Indisponibilidade é verificada novamente no recebimento da autorização.
  send('mqtt-command', { command: 'LIGAR' });
  await next;
  assert.equal(SiteModel.sessions.length, 2);
  ws.close();
  await once(ws, 'close');
  assert.ok(SimEngine.getUserSession(firstId));
  assert.ok(SimEngine.getUserSession(secondId));
  ws = new WebSocket(url);
  next = waitMessage(ws, m => m.type === 'snapshot');
  const restored = await next;
  assert.equal(restored.data.sessions.length, 2);
  next = waitMessage(ws, m => m.type === 'snapshot' && m.data.sessions.length === 1);
  send('stop-session', { sessionId: firstId, reason: 'Local' });
  await next;
  assert.equal(SimEngine.getUserSession(firstId), null);
  assert.ok(SimEngine.getUserSession(secondId));
});

test('acompanhamento consulta a sessão escolhida e encerra somente seu identificador', () => {
  const sent = [];
  const makeSession = (id, soc) => ({ id, soc, vehicle: vehicles[0], evse: { commandedA: 16 }, socTarget: .8, energyGridKWh: 2, energyBatteryKWh: 1.8, elapsedSim: 60, cost: 3, powerKW: 3.6, currentA: 16, status: 'charging' });
  const first = makeSession('first', .25);
  const second = makeSession('second', .6);
  const window = { SimClient: { snapshot: { sessions: [first, second], userSession: second }, onSnapshot() {}, send: (type, payload) => { sent.push({ type, payload }); return true; } } };
  vm.runInNewContext(readFileSync(new URL('../../js/charging.js', import.meta.url), 'utf8'), { window });
  const charging = window.ChargingSimulator;
  charging.selectSession('first');
  assert.equal(charging.getSessionData().batteryLevel, 25);
  charging.selectSession('second');
  assert.equal(charging.getSessionData().batteryLevel, 60);
  charging.stopSession();
  assert.equal(sent.at(-1).payload.sessionId, 'second');
  window.SimClient.send = () => false;
  assert.equal(charging.stopSession(), null, 'sem confirmação local de encerramento se desconectado');
});

test('botões encerram uma recarga antiga ou concluída e continuam funcionando na próxima estação', () => {
  const elements = new Map();
  const document = {
    querySelectorAll: () => [],
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', style: {}, disabled: false,
        handlers: {}, classList: { add() {}, remove() {} },
        addEventListener(event, callback) { this.handlers[event] = callback; }
      });
      return elements.get(id);
    }
  };
  const makeSession = (id, stationId, status) => ({ id, evseId: stationId,
    evse: { stationId, commandedA: 16 }, vehicle: vehicles[0], status,
    soc: .8, socTarget: .8, energyGridKWh: 3, energyBatteryKWh: 2.7,
    elapsedSim: 120, cost: 4, powerKW: 0, currentA: 0, rateSegments: []
  });
  const earlier = makeSession('earlier', 3, 'finished');
  const later = makeSession('later', 2, 'charging');
  const physical = makeSession('physical', 1, 'charging');
  const sent = [], relays = [];
  const window = {
    addEventListener() {},
    SimClient: { connected: true, snapshot: { sessions: [earlier, later, physical] },
      onSnapshot() {}, send(type, payload) { sent.push({ type, payload }); return this.connected; }
    },
    StationManager: { selectedStationId: null,
      getSelectedStation() { return { id: this.selectedStationId, name: `Estação ${this.selectedStationId}` }; },
      updateStationStatus() {}
    },
    MqttBridge: { aplicarComandoRele: command => relays.push(command) },
    PricingEngine: { formatCurrency: value => String(value) },
    PaymentController: { cancelPayment() {} }
  };
  const context = vm.createContext({ window, document });
  for (const file of ['charging.js', 'app.js']) vm.runInContext(readFileSync(new URL(`../../js/${file}`, import.meta.url), 'utf8'), context);
  const app = window.App;
  app.showScreen = screen => { app.currentScreen = screen; };
  for (const name of ['renderMqttControls', 'updateDemandBanner', 'updateSiteStrip', 'renderSegments', 'renderStations', 'updateStationTariff', 'cancelAuthorization', 'cancelarPix']) app[name] = () => {};
  window.ChargingSimulator.onUpdate(() => app.renderSessionEndControls());
  app.bindEvents();
  // Visitar outra sessão não libera nem encerra a anterior.
  app.openMonitoring('later');
  app.returnToStations();
  assert.equal(sent.length, 0);
  app.openMonitoring('earlier');
  const top = document.getElementById('btn-stop-charge');
  const bottom = document.getElementById('btn-end-charge');
  assert.equal(top.disabled, false, 'recarga concluída na estação 3 pode ser liberada');
  assert.equal(top.textContent, 'Ver resumo e liberar estação');
  top.handlers.click();
  assert.equal(sent.at(-1).payload.sessionId, 'earlier');
  assert.equal(relays.length, 0, 'estação simulada não corta o relé físico');
  assert.equal(top.disabled, true);
  window.SimClient.snapshot.sessions = [later, physical];
  app.returnToStations();
  app.openMonitoring('later');
  assert.equal(top.disabled, false, 'encerramento anterior não bloqueia outra sessão');
  bottom.handlers.click();
  assert.equal(sent.at(-1).payload.sessionId, 'later');
  window.SimClient.snapshot.sessions = [physical];
  app.returnToStations();
  app.openMonitoring('physical');
  window.SimClient.connected = false;
  app.renderSessionEndControls();
  assert.equal(top.disabled, true);
  assert.equal(bottom.disabled, true);
  window.SimClient.connected = true;
  app.renderSessionEndControls();
  assert.equal(top.disabled, false, 'reconexão reabilita a sessão selecionada');
  top.handlers.click();
  assert.equal(sent.at(-1).payload.sessionId, 'physical');
  assert.deepEqual(relays, ['DESLIGAR']);
});
