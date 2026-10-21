import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import SimEngine, { SimClock, SiteModel, OcppClient, ModbusBus } from '../sim/engine.js';
import { attachWebSocket } from '../ws.js';
import { MqttAuthorization } from '../mqtt-authorization.js';
const { vehicles } = createRequire(import.meta.url)('../../data/mock-data.js');
const wait = (ws, predicate) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error('Resposta não recebida')); }, 2000);
  const listener = raw => { const msg = JSON.parse(raw); if (predicate(msg)) { clearTimeout(timeout); ws.off('message', listener); resolve(msg); } };
  ws.on('message', listener);
});
async function fixture(t, pix) {
  SimEngine.boot({ ambient: 0 }); SimClock.stop(); SiteModel.init();
  const server = http.createServer(); const authorization = new MqttAuthorization();
  const wss = attachWebSocket(server, SimEngine, OcppClient, ModbusBus, authorization, pix);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`); await once(ws, 'open');
  t.after(() => { authorization.cancel(ws); authorization.finish('cancelled', 'Fim do teste'); for (const client of wss.clients) client.terminate(); ws.terminate(); wss.close(); server.close(); SiteModel.init(); SimClock.stop(); });
  const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));
  const command = async (type, payload, predicate) => { const response = wait(ws, predicate); send(type, payload); return response; };
  return { ws, send, command, authorization };
}

test('WebSocket rejeita parâmetros inválidos e continua aceitando comandos válidos', async t => {
  const { command } = await fixture(t);
  const before = SimClock.simDate.getTime();
  for (const [type, payload] of [['demo:set-time', { hour: 'x' }], ['demo:set-speed', { speed: -1 }], ['demo:set-day', { dow: 100 }], ['demo:trigger-peak', { folga: 'x' }], ['demo:nudge', { minutes: null }], ['demo:set-time', []]]) {
    await command(type, payload, m => m.type === 'command-error');
  }
  assert.equal(SimClock.simDate.getTime(), before);
  await command('demo:set-speed', { speed: 1 }, m => m.type === 'snapshot' && m.data.clock.speed === 1);
  await command('demo:toggle-clock', {}, m => m.type === 'snapshot' && m.data.clock.running);
  await command('demo:toggle-clock', {}, m => m.type === 'snapshot' && !m.data.clock.running);
});

test('WebSocket usa o catálogo do servidor e recusa estação ocupada antes da autorização', async t => {
  const { command, authorization } = await fixture(t);
  const modified = { ...vehicles[0], brand: '<script>inválido</script>', batteryCapacity: 0, maxChargePower: { ac: 999 } };
  await command('start-session', { stationId: 2, vehicle: modified, startSoc: .2 }, m => m.type === 'authorization' && m.data.status === 'waiting');
  await command('mqtt-command', { command: 'LIGAR' }, m => m.type === 'authorization' && m.data.status === 'approved');
  assert.equal(SiteModel.sessions[0].vehicle.batteryCapacity, vehicles[0].batteryCapacity);
  assert.equal(SiteModel.sessions[0].vehicle.brand, 'BYD');
  await command('start-session', { stationId: 2, vehicle: vehicles[0] }, m => m.type === 'authorization' && m.data.status === 'error');
  assert.equal(authorization.pending, null);
});

test('Pix pendente não cria sessão e cancelamento invalida uma verificação atrasada', async t => {
  let finish;
  const { command, send, authorization } = await fixture(t, { verify: () => new Promise(resolve => { finish = resolve; }) });
  send('start-session', { stationId: 2, vehicle: vehicles[0], startSoc: .2, paymentMethod: 'pix', paymentId: 'pending' });
  await command('demo:set-speed', { speed: 1 }, m => m.type === 'snapshot');
  assert.equal(SiteModel.sessions.length, 0);
  send('cancel-authorization');
  await command('demo:set-speed', { speed: 1 }, m => m.type === 'snapshot');
  finish(() => {});
  await command('demo:set-speed', { speed: 2 }, m => m.type === 'snapshot' && m.data.clock.speed === 2);
  assert.equal(authorization.pending, null);
  assert.equal(SiteModel.sessions.length, 0);
});

test('Pix sem validador não é aceito como recarga paga', async t => {
  const { command } = await fixture(t);
  await command('start-session', { stationId: 2, vehicle: vehicles[0], paymentMethod: 'pix' }, m => m.type === 'authorization' && m.data.status === 'error');
  assert.equal(SiteModel.sessions.length, 0);
});

test('Pix verificado inicia automaticamente uma vez sem autorização MQTT', async t => {
  let used = false;
  const { command, authorization } = await fixture(t, { verify: async () => {
    if (used) throw new Error('Pagamento já utilizado');
    return (commit = true) => { if (used) throw new Error('Pagamento já utilizado'); if (commit) used = true; };
  } });
  const payload = { stationId: 2, vehicle: vehicles[0], startSoc: .2, targetSoc: .8, paymentMethod: 'pix', paymentId: 'test-approved' };
  const response = await command('start-session', payload, m => m.type === 'authorization' && m.data.status === 'approved');
  assert.ok(response.data.sessionId); assert.equal(used, true);
  assert.equal(authorization.pending, null); assert.equal(SiteModel.sessions.length, 1);
  await command('start-session', payload, m => m.type === 'authorization' && m.data.status === 'error');
  assert.equal(SiteModel.sessions.length, 1);
});
