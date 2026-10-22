import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { attachTapDemoRoutes, candidateTapApproval } from '../tap-demo.js';
import { createRequire } from 'node:module';
import SimEngine, { SimClock, SiteModel } from '../sim/engine.js';
const { vehicles } = createRequire(import.meta.url)('../../data/mock-data.js');
const checkout = { stationId: 2, vehicleId: vehicles[0].id, startSoc: .2, targetSoc: .8, method: 'debit' };
const evidence = (o, extra = {}) => ({ order_id: o.id, handle: 'grupo', nsu: randomUUID(), aut: 'A12345', card_brand: 'visa', ...extra });
async function fixture(t, enabled = true, realEngine = false, terminalKey = '', merchantHandle = '') {
  let time = Date.now(), starts = 0;
  const evses = [1, 2, 3, 4].map(stationId => ({ stationId, status: 'Available' }));
  let engine = { snapshot: () => ({ evses }), _notify() {}, startUserSession(config) {
    evses.find(e => e.stationId === config.stationId).status = 'Charging'; starts++; return { id: 'TOT-' + starts };
  } };
  if (realEngine) {
    SimEngine.boot({ ambient: 0 }); SimClock.stop(); SiteModel.init(); engine = SimEngine;
    t.after(() => { SiteModel.init(); SimClock.stop(); });
  }
  const app = express(); app.use(express.json());
  attachTapDemoRoutes(app, { engine, enabled, now: () => time, terminalKey, merchantHandle });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const call = async (path, body, token, key, terminalSecret) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tap-demo${path}`, {
      method: body == null ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
        ...(token ? { 'X-Tap-Token': token } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(terminalSecret ? { 'X-Tap-Terminal-Key': terminalSecret } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const create = async (p = checkout, key = randomUUID()) => (await call('/orders', p, null, key)).data;
  const claim = async order => (await call('/claim', { code: order.code, handle: 'grupo' })).data;
  return { call, create, claim, evses, starts: () => starts, advance: ms => { time += ms; } };
}

test('InfiniteTap demo: critérios locais recusam retorno vazio, erro, cancelamento e parâmetros inválidos', () => {
  const good = evidence({ id: 'x' }); assert.equal(candidateTapApproval(good), true);
  for (const p of [{}, { ...good, nsu: 'x' }, { ...good, aut: '' }, { ...good, warning: 'cancelado' },
    { ...good, status: 'cancelled' }, { ...good, status: 'unknown' }, { ...good, success: 'false' },
    { ...good, error_code: '0' }, { ...good, cancelled: 'true' }, { ...good, card_brand: '\nvisa' }]) assert.equal(candidateTapApproval(p), false);
});

test('InfiniteTap demo: R$1 canônico, pedido idempotente, celular exclusivo e liberação uma vez', async t => {
  const f = await fixture(t), key = randomUUID();
  const order = await f.create({ ...checkout, amountCents: 99999 }, key);
  assert.equal(order.amountCents, 100);
  assert.equal((await f.create({ ...checkout, amountCents: 99999 }, key)).id, order.id);
  assert.equal((await f.call('/orders', { ...checkout, stationId: 3 }, null, key)).status, 409);
  assert.equal((await f.call('/orders/' + order.id)).status, 404);
  const phone = await f.claim(order);
  assert.equal((await f.call(`/orders/${order.id}/ready`, {}, phone.token)).status, 200);
  assert.equal((await f.call('/claim', { code: order.code, handle: 'grupo' })).status, 409);
  const result = evidence(order);
  assert.equal((await f.call(`/orders/${order.id}/result`, result, order.token)).status, 404);
  assert.equal((await f.call(`/orders/${order.id}/result`, { ...result, handle: 'outro' }, phone.token)).status, 400);
  const released = await f.call(`/orders/${order.id}/result`, result, phone.token);
  assert.equal(released.data.state, 'paid'); assert.equal(f.starts(), 0);
  assert.equal((await f.call('/orders/' + order.id, null, order.token)).data.sessionId, null);
  assert.equal((await f.call('/orders/' + order.id + '/connect', {}, phone.token)).status, 404);
  const connections = await Promise.all(Array.from({length:10}, () => f.call('/orders/' + order.id + '/connect', {}, order.token)));
  assert.ok(connections.every(r => r.data.state === 'released')); assert.equal(f.starts(), 1);
  await f.call(`/orders/${order.id}/result`, result, phone.token); assert.equal(f.starts(), 1);
  assert.equal((await f.call('/orders/' + order.id, null, order.token)).data.sessionId, 'TOT-1');
  const second = await f.create({ ...checkout, stationId: 3 }), phone2 = await f.claim(second);
  assert.equal((await f.call(`/orders/${second.id}/result`, evidence(second, { nsu: result.nsu }), phone2.token)).status, 409);
  assert.equal(f.starts(), 1);
});

test('InfiniteTap demo: cancelamento/incompleto, prazo e estação ocupada não iniciam sessão', async t => {
  const f = await fixture(t);
  const order = await f.create(), phone = await f.claim(order);
  assert.equal((await f.call(`/orders/${order.id}/result`, { order_id: order.id, handle: 'grupo' }, phone.token)).data.state, 'not-confirmed');
  assert.equal((await f.call(`/orders/${order.id}/result`, evidence(order), phone.token)).data.state, 'not-confirmed');
  const cancel = await f.create(), p2 = await f.claim(cancel);
  await f.call(`/orders/${cancel.id}/cancel`, {}, cancel.token);
  assert.equal((await f.call(`/orders/${cancel.id}/ready`, {}, p2.token)).status, 409);
  assert.equal((await f.call(`/orders/${cancel.id}/result`, evidence(cancel), p2.token)).data.state, 'cancelled');
  const expire = await f.create(), p3 = await f.claim(expire); f.advance(600001);
  assert.equal((await f.call(`/orders/${expire.id}/result`, evidence(expire), p3.token)).data.state, 'expired');
  const busy = await f.create(), p4 = await f.claim(busy); f.evses[1].status = 'Charging';
  assert.equal((await f.call(`/orders/${busy.id}/result`, evidence(busy), p4.token)).data.state, 'blocked');
  assert.equal(f.starts(), 0);
});

test('InfiniteTap demo: desativado por padrão e reserva entre pedidos pendentes', async t => {
  const off = await fixture(t, false); assert.equal((await off.call('/health')).data.enabled, false);
  assert.equal((await off.call('/orders', checkout, null, randomUUID())).status, 503);
  const on = await fixture(t); await on.create();
  assert.equal((await on.call('/orders', checkout, null, randomUUID())).status, 409);
});

test('InfiniteTap demo: retorno aguarda Conectar no totem antes de iniciar o motor compartilhado', async t => {
  const f = await fixture(t, true, true);
  const order = await f.create(), phone = await f.claim(order);
  const released = await f.call(`/orders/${order.id}/result`, evidence(order), phone.token);
  assert.equal(released.data.state, 'paid');
  assert.equal(SiteModel.sessions.length, 0);
  const connected = await f.call('/orders/' + order.id + '/connect', {}, order.token);
  released.data.sessionId = connected.data.sessionId;
  const session = SimEngine.snapshot().sessions.find(s => s.id === released.data.sessionId);
  assert.equal(session.evse.stationId, 2); assert.equal(session.vehicle.id, checkout.vehicleId);
  assert.equal(session.paymentMethod, 'tap-demo'); assert.equal(session.paymentAmount, 1);
  assert.equal(session.paymentEvidence, 'local-callback-demo');
  assert.equal(SiteModel.sessions.length, 1);
  await f.call(`/orders/${order.id}/result`, evidence(order), phone.token);
  assert.equal(SiteModel.sessions.length, 1);
});

test('InfiniteTap demo: NSU não pode ser reutilizado mudando a caixa do UUID', async t => {
  const f = await fixture(t), a = await f.create(), pa = await f.claim(a);
  const nsu = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
  await f.call(`/orders/${a.id}/result`, evidence(a, { nsu }), pa.token);
  const b = await f.create({ ...checkout, stationId: 3 }), pb = await f.claim(b);
  assert.equal((await f.call(`/orders/${b.id}/result`, evidence(b, { nsu: nsu.toUpperCase() }), pb.token)).status, 409);
  assert.equal(f.starts(), 0);
});

test('pagamento não liga carga: Conectar exige pagamento, token do totem e estação livre', async t => {
  const f = await fixture(t), order = await f.create(), phone = await f.claim(order);
  const connect = token => f.call(`/orders/${order.id}/connect`, {}, token);
  assert.equal((await connect(order.token)).status, 409);
  assert.equal(f.starts(), 0);
  await f.call(`/orders/${order.id}/result`, evidence(order), phone.token);
  assert.equal(f.starts(), 0);
  assert.equal((await connect(phone.token)).status, 404);
  f.advance(600001);
  assert.equal((await f.call('/orders/' + order.id, null, order.token)).data.state, 'paid');
  assert.equal((await f.call('/orders', checkout, null, randomUUID())).status, 409);
  f.evses[1].status = 'Charging';
  assert.equal((await connect(order.token)).status, 409); assert.equal(f.starts(), 0);
  f.evses[1].status = 'Available';
  assert.equal((await connect(order.token)).data.state, 'released'); assert.equal(f.starts(), 1);
});

test('InfiniteTap demo: recuperar claim exige a mesma chave secreta e conta', async t => {
  const f = await fixture(t), order = await f.create(), claimKey = randomUUID();
  const body = { code: order.code, handle: 'grupo', claimKey };
  const results = await Promise.all(Array.from({ length: 10 }, () => f.call('/claim', body)));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(new Set(results.map(r => r.data.token)).size, 1);
  for (const patch of [{ claimKey: randomUUID() }, { claimKey: undefined }, { handle: 'outro' }]) {
    assert.equal((await f.call('/claim', { ...body, ...patch })).status, 409);
  }
  assert.equal((await f.call('/claim', { ...body, claimKey: 'short' })).status, 400);
  await f.call(`/orders/${order.id}/cancel`, {}, order.token);
  assert.equal((await f.call('/claim', body)).status, 404);
});

test('InfiniteTap demo: claim legado continua exclusivo e recuperação expirada é recusada', async t => {
  const f = await fixture(t), old = await f.create(); await f.claim(old);
  assert.equal((await f.call('/claim', { code: old.code, handle: 'grupo', claimKey: randomUUID() })).status, 409);
  const fresh = await f.create({ ...checkout, stationId: 3 });
  const body = { code: fresh.code, handle: 'grupo', claimKey: randomUUID() };
  await f.call('/claim', body); f.advance(600001);
  assert.equal((await f.call('/claim', body)).status, 404);
});

test('celular fixo: autenticação, fila, recuperação e exclusividade sem cobrar ao receber', async t => {
  const secret='a'.repeat(64), f=await fixture(t,true,false,secret);
  const a=await f.create(),b=await f.create({...checkout,stationId:3});
  const body={deviceKey:randomUUID(),handle:'grupo'};
  const next=(payload=body,key=secret)=>f.call('/terminal/next',payload,null,null,key);
  assert.equal((await next(body,'b'.repeat(64))).status,401);
  assert.equal((await next({...body,deviceKey:'short'})).status,400);
  const results=await Promise.all(Array.from({length:20},()=>next()));
  assert.ok(results.every(r=>r.status===200&&r.data.order.id===a.id));
  assert.equal(new Set(results.map(r=>r.data.order.token)).size,1);
  const phone=results[0].data.order;
  assert.notEqual(phone.token,a.token);assert.equal(f.starts(),0);
  assert.equal((await next({...body,deviceKey:randomUUID()})).status,409);
  assert.equal((await next({...body,handle:'outra'})).status,409);
  assert.equal((await f.call('/claim',{code:a.code,handle:'grupo'})).status,409);
  await f.call(`/orders/${a.id}/result`,evidence(a),phone.token);
  assert.equal((await next()).data.order.id,b.id);assert.equal(f.starts(),0);
  await f.call(`/orders/${b.id}/cancel`,{},b.token);
  assert.equal((await next()).data.order,null);
});

test('celular fixo: configuração ausente, expirados e pedidos de outros celulares', async t => {
  const body={deviceKey:randomUUID(),handle:'grupo'},secret='c'.repeat(64);
  const off=await fixture(t);
  assert.equal((await off.call('/terminal/next',body,null,null,secret)).status,503);
  const f=await fixture(t,true,false,secret),a=await f.create();await f.claim(a);
  assert.equal((await f.call('/terminal/next',body,null,null,secret)).data.order,null);
  await f.create({...checkout,stationId:3});f.advance(600001);
  assert.equal((await f.call('/terminal/next',body,null,null,secret)).data.order,null);
  assert.equal(f.starts(),0);
});

test('celular fixo: somente a conta recebedora configurada pode assumir um pedido', async t => {
  const secret = 'a'.repeat(64), f = await fixture(t, true, false, secret, 'grupo'), order = await f.create();
  assert.equal((await f.call('/terminal/next', {deviceKey:randomUUID(),handle:'outra'},null,null,secret)).status,403);
  assert.equal((await f.call('/claim', {code:order.code,handle:'outra'})).status,403);
  assert.equal((await f.call('/terminal/next', {deviceKey:randomUUID(),handle:'grupo'},null,null,secret)).data.order.id,order.id);
  assert.equal(f.starts(),0);
});
