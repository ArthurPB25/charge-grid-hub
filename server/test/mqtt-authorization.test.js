import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import WebSocket from 'ws';
import { MqttAuthorization } from '../mqtt-authorization.js';
import { attachWebSocket } from '../ws.js';
import SimEngine, { SimClock, SiteModel, OcppClient, ModbusBus } from '../sim/engine.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { vehicles } = require('../../data/mock-data.js');

test('aguarda LIGAR, ignora outro cliente e duplicatas', () => {
  const authorization = new MqttAuthorization();
  const states = [];
  let starts = 0;
  authorization.request('totem', 1, s => states.push(s.status), () => starts++);
  assert.equal(starts, 0);
  authorization.receive('outro', 'LIGAR');
  authorization.receive('totem', 'CARREGANDO');
  assert.equal(starts, 0);
  authorization.receive('totem', 'LIGAR');
  authorization.receive('totem', 'LIGAR');
  assert.equal(starts, 1);
  assert.deepEqual(states, ['waiting', 'approved']);
});

test('DESLIGAR, cancelamento e expiração impedem autorização posterior', async () => {
  for (const end of ['DESLIGAR', 'cancel', 'expire']) {
    const authorization = new MqttAuthorization({ timeoutMs: 10 });
    const states = [];
    let starts = 0;
    authorization.request('totem', 1, s => states.push(s.status), () => starts++);
    if (end === 'cancel') authorization.cancel('totem');
    else if (end === 'expire') await new Promise(resolve => setTimeout(resolve, 25));
    else authorization.receive('totem', end);
    authorization.receive('totem', 'LIGAR');
    assert.equal(starts, 0);
    assert.equal(states.at(-1), { DESLIGAR: 'denied', cancel: 'cancelled', expire: 'expired' }[end]);
  }
});

function bridgeFixture() {
  const client = new EventEmitter();
  client.connected = false;
  const published = [];
  client.subscribe = (topics, opts, cb) => cb(null, topics.map(topic => ({ topic, qos: 0 })));
  client.publish = (topic, payload, opts, cb) => { published.push({ topic, payload, opts }); cb?.(); };
  const window = { addEventListener() {} };
  const elements = new Map();
  const document = {
    querySelectorAll: () => [],
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', hidden: false });
      return elements.get(id);
    }
  };
  const context = vm.createContext({ window, document, console, mqtt: { connect: () => client } });
  vm.runInContext(readFileSync(new URL('../../js/sim/mqtt-bridge.js', import.meta.url), 'utf8'), context);
  const bridge = window.MqttBridge;
  bridge.ativar();
  client.connected = true;
  client.emit('connect');
  return { client, published, bridge, window, context, document };
}

test('HTML aberto por file usa backend local; acesso por IP conserva o host', () => {
  for (const hostname of ['', '192.168.1.20']) {
    let destination;
    const handlers = {};
    class FakeWebSocket {
      constructor(url) { destination = url; }
      addEventListener(name, fn) { handlers[name] = fn; }
    }
    const window = { location: { hostname } };
    const context = vm.createContext({ window, WebSocket: FakeWebSocket, console, setTimeout() {} });
    vm.runInContext(readFileSync(new URL('../../js/config.js', import.meta.url), 'utf8'), context);
    vm.runInContext(readFileSync(new URL('../../js/sim-client.js', import.meta.url), 'utf8'), context);
    const states = [];
    window.SimClient.onConnection(connected => states.push(connected));
    window.SimClient.connect();
    assert.equal(destination, `ws://${hostname || '127.0.0.1'}:3001/ws`);
    handlers.open();
    handlers.close();
    assert.deepEqual(states, [false, true, false]);
  }
});

test('ponte recebe texto puro; ignora retain, status e tópico interno de relé', () => {
  const { client, published, bridge } = bridgeFixture();
  const commands = [];
  bridge.onCommand(c => commands.push(c));
  const emit = (topic, message, packet = {}) => client.emit('message', topic, Buffer.from(message), packet);
  emit(bridge.topicoComando, 'LIGAR', { retain: true });
  emit(bridge.topicoStatus, 'CARREGANDO');
  emit(bridge.topicoRele, 'DESLIGAR');
  emit(bridge.topicoComando, 'INVALIDO');
  assert.deepEqual(commands, []);
  bridge.autorizarCarga();
  assert.equal(published.at(-1).payload, 'LIGAR');
  assert.deepEqual(commands, [], 'publicar não equivale a receber autorização');
  emit(bridge.topicoComando, 'LIGAR');
  emit(bridge.topicoComando, 'DESLIGAR');
  assert.deepEqual(commands, ['LIGAR', 'DESLIGAR']);
  bridge.aplicarComandoRele('DESLIGAR');
  assert.equal(published.at(-1).topic, bridge.topicoRele);
  client.connected = false;
  client.emit('close');
  const count = published.length;
  bridge.autorizarCarga();
  assert.equal(published.length, count, 'não enfileira LIGAR offline');
});

test('tela só avança após resposta do servidor e cancela a espera se MQTT cair', () => {
  const { client, bridge, window, context, document } = bridgeFixture();
  const sent = [];
  window.SimClient = { send: (type, payload) => { sent.push({ type, payload }); return true; } };
  window.StationManager = { getSelectedStation: () => ({ id: 1 }) };
  window.ChargingSimulator = { onUpdate() {}, startSession: () => true };
  vm.runInContext(readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8'), context);
  const app = window.App;
  app.selectedVehicle = vehicles[0];
  let opened = 0;
  app.openMonitoring = () => opened++;
  app.initMqttControls();
  app.startMonitoring();
  app.onAuthorization({ status: 'waiting' });
  bridge.autorizarCarga();
  assert.equal(opened, 0);
  client.emit('message', bridge.topicoComando, Buffer.from('LIGAR'), {});
  assert.equal(sent.at(-1).type, 'mqtt-command');
  assert.equal(opened, 0);
  app.onAuthorization({ status: 'approved' });
  assert.equal(opened, 1);
  app.startMonitoring();
  app.onAuthorization({ status: 'waiting' });
  client.connected = false;
  client.emit('close');
  assert.equal(sent.at(-1).type, 'cancel-authorization');
  assert.equal(app._awaitingAuthorization, false);
  assert.equal(document.getElementById('btn-retry-authorization').hidden, false);
});

test('WebSocket e motor: sem carga antes de LIGAR, DESLIGAR encerra e cancelar invalida espera', { timeout: 5000 }, async t => {
  SimEngine.boot({ ambient: 0 });
  SimClock.stop();
  const authorization = new MqttAuthorization();
  const server = http.createServer();
  const wss = attachWebSocket(server, SimEngine, OcppClient, ModbusBus, authorization);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    ws.terminate();
    wss.close();
    server.close();
    authorization.finish('cancelled', 'Fim do teste');
    SimClock.stop();
    if (SimEngine.userSession) SimEngine.stopUserSession();
  });
  await once(ws, 'open');
  const waitState = status => new Promise(resolve => {
    const listener = raw => {
      const msg = JSON.parse(raw);
      if (msg.type === 'authorization' && msg.data.status === status) {
        ws.off('message', listener);
        resolve(msg.data);
      }
    };
    ws.on('message', listener);
  });
  const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));
  let next = waitState('waiting');
  send('start-session', { stationId: 1, vehicle: vehicles[0], startSoc: 0.2, targetSoc: 0.8 });
  await next;
  assert.equal(SimEngine.userSession, null);
  assert.equal(SiteModel.getEvseByStation(1).status, 'Available');
  next = waitState('approved');
  send('mqtt-command', { command: 'LIGAR' });
  await next;
  assert.ok(SimEngine.userSession);
  next = waitState('stopped');
  send('mqtt-command', { command: 'DESLIGAR' });
  await next;
  assert.equal(SimEngine.userSession, null);
  next = waitState('waiting');
  send('start-session', { stationId: 1, vehicle: vehicles[0] });
  await next;
  next = waitState('cancelled');
  send('cancel-authorization');
  await next;
  assert.equal(authorization.pending, null);
});
