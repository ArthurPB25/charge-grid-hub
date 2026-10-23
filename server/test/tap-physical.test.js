import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { attachTapDemoRoutes } from '../tap-demo.js';
import { attachWebSocket } from '../ws.js';
import { MqttAuthorization } from '../mqtt-authorization.js';
import SimEngine, { SimClock, SiteModel, OcppClient, ModbusBus } from '../sim/engine.js';

const require = createRequire(import.meta.url);
const { vehicles } = require('../../data/mock-data.js');

test('débito: pagamento sozinho não liga; Conectar aciona ESP legado por /comando e retry não recria sessão encerrada', { timeout: 10000 }, async t => {
  SimEngine.boot({ ambient: 0 }); SimClock.stop(); SiteModel.init();
  // Exercise the real handlers and protocol messages with an in-memory transport.
  // No listening socket, public broker or payment provider is used by this test.
  const routes = [];
  const app = Object.fromEntries(['get','post'].map(method => [method, (path, handler) => routes.push({method,path,handler})]));
  const tap = attachTapDemoRoutes(app, { engine: SimEngine, enabled: true });
  const server = new EventEmitter();
  const wss = attachWebSocket(server, SimEngine, OcppClient, ModbusBus, new MqttAuthorization(), null, tap);
  const ws = new EventEmitter(); ws.OPEN = ws.readyState = 1;
  let sim;
  ws.send = raw => queueMicrotask(() => sim?._onMessage(JSON.parse(raw)));
  wss.clients.add(ws); wss.emit('connection', ws);
  t.after(() => {
    ws.readyState = 3; ws.emit('close'); wss.clients.clear();
    wss.close(); SimClock.stop(); SiteModel.init();
  });
  const base = 'https://test.invalid';
  const localRequest = (path, body, headers = {}, method = 'post') => {
    for (const route of routes) {
      const keys = [];
      const pattern = route.path.replace(/:([a-z]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
      const match = path.match(new RegExp('^' + pattern + '$'));
      if (route.method !== method || !match) continue;
      let status = 200, response;
      const request = { body, params: Object.fromEntries(keys.map((key,i) => [key,match[i+1]])),
        get: name => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] };
      const result = { set() {}, status(value) { status = value; return this; }, json(value) { response = JSON.parse(JSON.stringify(value)); } };
      route.handler(request, result); return { status, body: response };
    }
    throw new Error('Rota de teste inexistente: ' + path);
  };
  const call = async (path, body, token, key) => {
    const response = localRequest('/api/tap-demo' + path, body,
      { ...(token ? { 'X-Tap-Token': token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) });
    assert.equal(response.status, 200); return response.body;
  };
  const order = await call('/orders', {
    stationId: 1, vehicleId: vehicles[0].id, startSoc: .2, targetSoc: .8, method: 'debit'
  }, null, randomUUID());
  const phone = await call('/claim', { code: order.code, handle: 'grupo' });
  const paid = await call(`/orders/${order.id}/result`, {
    order_id: order.id, handle: 'grupo', nsu: randomUUID(), aut: 'SIMULADO', card_brand: 'visa'
  }, phone.token);
  assert.equal(paid.state, 'paid'); assert.equal(SiteModel.sessions.length, 0);
  const unbound = localRequest(`/api/tap-demo/orders/${order.id}/connect`, {}, { 'X-Tap-Token': order.token });
  assert.equal(unbound.status, 409); assert.equal(SiteModel.sessions.length, 0);

  let energized = false, failStart = true;
  const mqttClient = new EventEmitter(), published = [], messages = [], elements = new Map(), store = new Map();
  mqttClient.connected = false;
  mqttClient.subscribe = (topics, options, done) => done(null, topics.map(topic => ({ topic, qos: 0 })));
  let resolveRelay; const relayPublished = new Promise(resolve => { resolveRelay = resolve; });
  mqttClient.publish = (topic, payload, options, done) => {
    published.push({ topic, payload });
    if (topic === 'meu_projeto/tomada/comando' && payload === 'LIGAR' && failStart) {
      failStart = false; done?.(new Error('Falha de envio simulada.')); return;
    }
    if (topic === 'meu_projeto/tomada/comando') energized = payload === 'LIGAR';
    done?.(); if (payload === 'LIGAR') resolveRelay();
  };
  const context = vm.createContext({
    window: { App: { showScreen() {}, showPaymentStep() {}, returnToStations: message => messages.push(message) },
      ChargeGridConfig: { wsUrl: 'wss://test.invalid/ws' },
      localStorage: { getItem: key => store.get(key), setItem: (key,value) => store.set(key,value), removeItem: key => store.delete(key) } },
    localStorage: { setItem: (key,value) => store.set(key,value), removeItem: key => store.delete(key) },
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, disabled: false }); return elements.get(id); } },
    mqtt: { connect: () => mqttClient }, location: { origin: base, hostname: 'test.invalid', port: '' },
    fetch: async (path, options) => {
      const result = localRequest(path, options.body ? JSON.parse(options.body) : undefined, options.headers, options.method?.toLowerCase() || 'get');
      return { status: result.status, ok: result.status === 200, json: async () => result.body };
    }, AbortSignal, console, clearTimeout, setTimeout, WebSocket: { OPEN: 1 }
  });
  for (const path of ['js/sim-client.js', 'js/sim/mqtt-bridge.js', 'js/tap-demo.js'])
    vm.runInContext(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), context);
  const bridge = context.window.MqttBridge;
  sim = context.window.SimClient;
  sim.ws = { readyState: 1, send: raw => queueMicrotask(() => ws.emit('message', raw)) }; sim.connected = true;
  bridge.ativar(); mqttClient.connected = true; mqttClient.emit('connect');
  assert.equal(bridge.conectado, true);
  sim.onRelay(command => bridge.aplicarComandoRele(command));
  const client = context.window.TapDemo;
  client.order = { ...order, ...paid, token: order.token };
  assert.equal(published.length, 0); assert.equal(energized, false);
  await client.connect();
  assert.equal(client.order.state, 'released'); assert.equal(energized, false);
  assert.equal(SiteModel.sessions.length, 1); assert.equal(messages.length, 0);
  const savedSession = client.order.sessionId;
  await client.poll(); assert.equal(client.order.sessionId, savedSession); assert.equal(energized, false);
  await client.connect();
  await relayPublished;
  const session = SimEngine.snapshot().sessions.find(session => session.evse.stationId === 1);
  assert.ok(session); assert.ok(session.currentA > 0);
  assert.equal(client.order, null); assert.equal(messages.length, 1);
  assert.ok(published.some(item => item.topic === 'meu_projeto/tomada/rele' && item.payload === 'LIGAR'));
  assert.equal(published.filter(item => item.topic === 'meu_projeto/tomada/comando' && item.payload === 'LIGAR').length, 2);
  assert.equal(energized, true, 'Conectar aciona o ESP legado com pagamento e sessão válidos.');
  assert.equal(SiteModel.sessions.length, 1);
  assert.equal(SiteModel.sessions[0].id, savedSession, 'Falha de envio usa a mesma sessão e o mesmo pagamento.');
  bridge.cortarCarga(); assert.equal(energized, false);
  SimEngine.stopUserSession('Local', session.id); SimEngine._notify();
  client.order = { ...order, state: 'released', sessionId: session.id };
  const count = published.filter(item => item.payload === 'LIGAR').length;
  await client.connect();
  assert.equal(published.filter(item => item.payload === 'LIGAR').length, count);
  assert.equal(energized, false); assert.equal(SiteModel.sessions.length, 0);

  const simulated = await call('/orders', {
    stationId: 2, vehicleId: vehicles[1].id, startSoc: .2, targetSoc: .8, method: 'credit'
  }, null, randomUUID());
  const secondPhone = await call('/claim', { code: simulated.code, handle: 'grupo' });
  const secondPaid = await call(`/orders/${simulated.id}/result`, {
    order_id: simulated.id, handle: 'grupo', nsu: randomUUID(), aut: 'SIMULADO2', card_brand: 'visa'
  }, secondPhone.token);
  client.order = { ...simulated, ...secondPaid, token: simulated.token };
  await client.connect();assert.equal(client.order,null);
  assert.equal(SiteModel.sessions.length,1);assert.equal(SiteModel.sessions[0].evse.stationId,2);
  assert.equal(published.filter(item=>item.payload==='LIGAR').length,count,'Estação simulada não liga o ESP físico.');
});

test('débito: MQTT desconectado preserva pagamento e impede início lógico e físico', async () => {
  const messages = [], published = [];
  const window = { App: { returnToStations: message => messages.push(message) },
    SimClient: { send: () => true } };
  const context = vm.createContext({ window, console,
    document: { getElementById: () => ({ textContent: '' }) },
    localStorage: { removeItem() {} }, clearTimeout() {},
    mqtt: { connect() { throw new Error('Não conectar a broker real.'); } } });
  vm.runInContext(readFileSync(new URL('../../js/sim/mqtt-bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../../js/tap-demo.js', import.meta.url), 'utf8'), context);
  const bridge = window.MqttBridge;
  bridge.client = { connected: false, publish: (...args) => published.push(args) };
  bridge.ativo = true; bridge.conectado = false;
  const client = window.TapDemo;
  client.order = { id: 'local-test-only', token: 'simulado', state: 'paid', stationId: 1 };
  let starts = 0;
  client.request = async () => { starts++; bridge.aplicarComandoRele('LIGAR'); return { state: 'released' }; };
  await client.connect();
  assert.equal(starts, 0); assert.equal(published.length, 0); assert.equal(client.order.state, 'paid');
  assert.equal(messages.length, 0);
});
