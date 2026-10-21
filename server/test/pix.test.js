import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { attachPixRoutes, normalizePixStatus } from '../pix.js';

const checkout = { stationId: 2, vehicleId: 'dolphin', startSoc: .2, targetSoc: .8 };
const session = { stationId: 2, vehicle: { id: 'dolphin' }, startSoc: .2, targetSoc: .8 };
const valid = { valor: .01, checkout };
const provider = (overrides = {}) => ({ id: 'ORDER-TEST', status: 'action_required', total_amount: '12.35',
  transactions: { payments: [{ payment_method: { qr_code: 'TEST-PIX', qr_code_base64: 'TEST-IMAGE' } }] }, ...overrides });
async function fixture(t, fetchImpl, config = { MP_ACCESS_TOKEN: 'TEST-FAKE-NOT-A-CREDENTIAL', MP_SANDBOX: 'true' }) {
  const app = express(); app.use(express.json());
  const gateway = attachPixRoutes(app, { config, engine: { estimate: value => value.stationId === 2 && value.targetSoc <= 1 ? { estimatedCost: 12.345 } : null }, fetchImpl });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const create = (body = valid, key = 'test-request-00000001') => fetch(`${url}/api/pix/criar-cobranca`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body)
  });
  return { gateway, create, url };
}

test('Pix recusa valores, checkout, e-mail e identificador inválidos antes de contatar o provedor', async t => {
  let calls = 0;
  const { create } = await fixture(t, async () => { calls++; throw new Error('Não deve ser chamado'); });
  for (const valor of [null, '5', true, 0, -.01, NaN, Infinity, .001, 100001]) assert.equal((await create({ valor })).status, 400);
  assert.equal((await create({ valor: 5, email: 'inválido' })).status, 400);
  assert.equal((await create(valid, '')).status, 400);
  assert.equal((await create(valid, 'short')).status, 400);
  assert.equal((await create({ ...valid, checkout: { ...checkout, targetSoc: 9 } })).status, 400);
  assert.equal(calls, 0);
});

test('duplo clique e retry usam uma cobrança; servidor fixa R$1 independentemente da estimativa', async t => {
  let calls = 0; let request;
  const { create } = await fixture(t, async (url, options) => {
    calls++; request = options;
    assert.equal(url, 'https://api.mercadopago.com/v1/orders');
    return { ok: true, json: async () => provider() };
  });
  const results = await Promise.all([create(), create()]);
  const first = await results[0].json();
  assert.deepEqual(await results[1].json(), first);
  assert.equal(first.amount, 1);
  assert.equal(first.paymentId, 'ORDER-TEST');
  assert.equal(calls, 1);
  assert.equal(JSON.parse(request.body).total_amount, '1.00');
  assert.equal(request.headers['X-Idempotency-Key'], 'test-request-00000001');
  assert.equal((await create({ ...valid, valor: 30 })).status, 409);
  assert.equal(calls, 1);
});

test('erro de rede preserva a idempotência para retry e não expõe detalhes internos', async t => {
  const requests = [];
  const { create } = await fixture(t, async (url, options) => {
    requests.push(options);
    if (requests.length === 1) throw new Error('segredo-do-provedor');
    return { ok: true, json: async () => provider() };
  });
  const failed = await create();
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes('segredo'));
  assert.equal((await create()).status, 200);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[0].headers['X-Idempotency-Key'], requests[1].headers['X-Idempotency-Key']);
});

test('Pix só libera a recarga correta, paga no valor correto e uma única vez', async t => {
  let status = 'action_required'; let total = '1.00';
  const { gateway, create, url } = await fixture(t, async path => ({ ok: true, json: async () => provider(path.endsWith('/ORDER-TEST') ? { status, status_detail: 'accredited', total_amount: total } : {}) }));
  await create();
  await assert.rejects(gateway.verify('ORDER-TEST', session), /ainda não confirmado/);
  status = 'processed'; total = '12.35';
  await assert.rejects(gateway.verify('ORDER-TEST', session), /ainda não confirmado/);
  total = '1.00';
  await assert.rejects(gateway.verify('ORDER-TEST', { ...session, stationId: 3 }), /não corresponde/);
  const consume = await gateway.verify('ORDER-TEST', session);
  consume(false); consume();
  assert.throws(() => consume(), /já utilizado/);
  await assert.rejects(gateway.verify('ORDER-TEST', session), /já foi utilizado/);
  assert.equal((await fetch(`${url}/api/pix/status/unknown`)).status, 404);
});

test('ausência de token, recusa e QR incompleto produzem erro explícito', async t => {
  const empty = await fixture(t, () => assert.fail('Não chamar provedor sem token'), {});
  assert.equal((await empty.create()).status, 503);
  const refused = await fixture(t, async () => ({ ok: false, json: async () => ({ secret: 'never-public' }) }));
  const response = await refused.create(); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('never-public'));
  const malformed = await fixture(t, async () => ({ ok: true, json: async () => ({ id: 'missing-qr' }) }));
  assert.equal((await malformed.create()).status, 502);
  assert.equal(normalizePixStatus({ status: 'expired' }), 'cancelled');
  assert.equal(normalizePixStatus({ status: 'processed', status_detail: 'accredited' }), 'approved');
  assert.equal(normalizePixStatus({ status: 'processed' }), 'pending');
});

test('Pix produção usa R$1, e-mail informado e não envia APRO de sandbox', async t => {
  let sent;
  const f = await fixture(t, async (url, options) => {
    sent = JSON.parse(options.body); return { ok: true, json: async () => provider() };
  }, { MP_ACCESS_TOKEN: 'FAKE-ONLY-FOR-TEST', MP_SANDBOX: 'false' });
  assert.equal((await f.create()).status, 400);
  assert.equal(sent, undefined);
  const r = await f.create({ ...valid, valor: 9999, email: 'payer@example.com' });
  assert.equal(r.status, 200); const data = await r.json();
  assert.equal(data.amount, 1); assert.equal(data.sandbox, false);
  assert.equal(sent.total_amount, '1.00');
  assert.equal(sent.transactions.payments[0].amount, '1.00');
  assert.deepEqual(sent.payer, { email: 'payer@example.com' });
  assert.equal((await f.create({ valor: 1, email: 'payer@example.com' }, 'missing-checkout-0001')).status, 400);
});
