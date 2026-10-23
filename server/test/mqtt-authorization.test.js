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

function bridgeFixture(store = new Map()) {
  const client = new EventEmitter();
  client.connected = false;
  const published = [];
  client.subscribe = (topics, opts, cb) => cb(null, topics.map(topic => ({ topic, qos: 0 })));
  client.publish = (topic, payload, opts, cb) => { published.push({ topic, payload, opts }); cb?.(); };
  const window = { addEventListener() {}, localStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)} };
  const elements = new Map();
  const document = {
    querySelectorAll: () => [],
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', hidden: false });
      return elements.get(id);
    }
  };
  const context = vm.createContext({ window, document, console, setTimeout, clearTimeout, mqtt: { connect: () => client } });
  vm.runInContext(readFileSync(new URL('../../js/sim/mqtt-bridge.js', import.meta.url), 'utf8'), context);
  const bridge = window.MqttBridge;
  bridge.ativar();
  client.connected = true;
  client.emit('connect');
  return { client, published, bridge, window, context, document, store };
}

test('corte manual usa DESLIGAR no comando original com QoS1, sem confundir broker e confirmação do ESP', () => {
  const {client,published,bridge}=bridgeFixture();
  assert.equal(bridge.cortarCarga(),true);
  assert.equal(published.at(-1).topic,bridge.topicoComando);
  assert.equal(published.at(-1).payload,'DESLIGAR');
  assert.equal(published.at(-1).opts.qos,1);assert.equal(published.at(-1).opts.retain,false);
  assert.equal(bridge.snapshot().corte,'sent');
  client.emit('message',bridge.topicoStatus,Buffer.from('PARADO'),{retain:true});
  assert.equal(bridge.snapshot().corte,'sent','estado retido não confirma este corte');
  client.emit('message',bridge.topicoStatus,Buffer.from('PARADO'),{});
  assert.equal(bridge.snapshot().corte,'confirmed');
  const count=published.length;bridge.aplicarComandoRele('LIGAR');
  assert.equal(published.length,count,'retomada atrasada não religa após corte manual');
  bridge.autorizarCarga();assert.equal(published.at(-1).payload,'LIGAR');
  bridge.cortarCarga();
  assert.equal(bridge.prepararNovaRecarga(),true);
  bridge.aplicarComandoRele('LIGAR');assert.equal(published.at(-1).topic,bridge.topicoRele,'nova recarga InfiniteTap pode ligar após corte anterior enviado');
});

test('desligamento offline sobrevive ao recarregamento e é enviado ao reconectar; LIGAR não é enfileirado', () => {
  const first=bridgeFixture();first.client.connected=false;first.client.emit('close');
  assert.equal(first.bridge.cortarCarga(),false);assert.equal(first.published.length,0);
  assert.equal(first.bridge.snapshot().corte,'pending');assert.equal(first.store.get('chargegrid-esp-stop-pending'),'1');
  first.bridge.autorizarCarga();assert.equal(first.published.length,0);
  const next=bridgeFixture(first.store);
  assert.equal(next.published.length,1);assert.equal(next.published[0].payload,'DESLIGAR');
  assert.equal(next.store.has('chargegrid-esp-stop-pending'),false);
  assert.equal(next.bridge.snapshot().corte,'sent');
});

test('falha de publicação mantém corte e callback antigo não apaga novo pedido de desligamento', () => {
  const {client,bridge,store,published}=bridgeFixture();
  const callbacks=[];client.publish=(topic,payload,opts,cb)=>{published.push({topic,payload,opts});callbacks.push(cb);};
  bridge.cortarCarga();callbacks[0](new Error('offline'));
  assert.equal(bridge.snapshot().corte,'pending');assert.equal(store.get('chargegrid-esp-stop-pending'),'1');
  client.connected=false;client.emit('close');client.connected=true;client.emit('connect');
  const retry=callbacks.at(-1);assert.equal(callbacks.length,2);
  callbacks[0]();assert.equal(store.get('chargegrid-esp-stop-pending'),'1');
  retry();assert.equal(bridge.snapshot().corte,'sent');assert.equal(store.has('chargegrid-esp-stop-pending'),false);
});

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
    assert.deepEqual(states, [false]);
    handlers.message({ data: JSON.stringify({ type: 'snapshot', data: { sessions: [] } }) });
    handlers.close();
    assert.deepEqual(states, [false, true, false]);
  }
});

test('início pago: corte manual invalida callback atrasado e reconexão não repete LIGAR', async () => {
  const {client,bridge,published}=bridgeFixture(),callbacks=[];
  client.publish=(topic,payload,opts,cb)=>{published.push({topic,payload,opts});callbacks.push(cb);};
  const starting=bridge.iniciarCargaPaga(()=>true);
  assert.equal(published[0].topic,bridge.topicoComando);assert.equal(published[0].payload,'LIGAR');
  assert.equal(published[0].opts.qos,0);assert.equal(published[0].opts.retain,false);
  bridge.cortarCarga();callbacks[0]();
  await assert.rejects(starting,/início do ESP/);
  callbacks[1]();client.connected=false;client.emit('close');client.connected=true;client.emit('connect');
  assert.equal(published.filter(p=>p.payload==='LIGAR').length,1);
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
  app.returnToStations = () => opened++;
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
