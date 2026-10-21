import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../js/tap-demo.js', import.meta.url), 'utf8');
function setup() {
  const messages = [], store = new Map(), timers = [];
  const context = { window: { App: { returnToStations: msg => messages.push(msg) }, SimClient: { send() {} } },
    localStorage: { removeItem: k => store.delete(k) }, document: { getElementById: () => ({ textContent: '' }) }, clearTimeout() {}, setTimeout(fn) { timers.push(fn); }, AbortSignal };
  vm.runInNewContext(source, context);
  const client = context.window.TapDemo; client.order = { id: 'order', token: 'secret' };
  return { client, messages, timers, context };
}
test('InfiniteTap totem: liberação volta às estações e elimina o pedido pendente', async () => {
  const { client, messages } = setup(); client.request = async () => ({ state: 'released' });
  await client.poll(); assert.equal(client.order, null); assert.equal(messages.length, 1); assert.match(messages[0], /Recarga iniciada/);
});
test('InfiniteTap totem: consulta atrasada após cancelar não substitui o resultado atual', async () => {
  const { client, messages } = setup(); let finish;
  client.request = () => new Promise(resolve => { finish = resolve; });
  const pending = client.poll(); client.forget(); finish({ state: 'released' }); await pending;
  assert.equal(messages.length, 0);
});
test('InfiniteTap totem: retorno não confirmado nunca exibe recarga iniciada', async () => {
  const { client, messages } = setup(); client.request = async () => ({ state: 'not-confirmed', message: 'Pagamento não confirmado' });
  await client.poll(); assert.equal(client.order, null); assert.deepEqual(messages, ['Pagamento não confirmado']);
});

test('InfiniteTap totem: 404 após reinício encerra acompanhamento e orienta conferir pagamento', async () => {
  const { client, messages, timers } = setup();
  client.request = async () => { throw Object.assign(new Error('Pedido inexistente'), { status: 404 }); };
  await client.poll();
  assert.equal(client.order, null); assert.equal(timers.length, 0);
  assert.match(messages[0], /não cancela nem estorna/); assert.match(messages[0], /InfinitePay/);
});

test('InfiniteTap totem: cancelar pedido inexistente permite sair sem prometer estorno', async () => {
  const { client, messages } = setup();
  client.request = async () => { throw Object.assign(new Error('Pedido inexistente'), { status: 404 }); };
  await client.cancel(); assert.equal(client.order, null); assert.equal(messages.length, 1);
  assert.match(messages[0], /não cancela nem estorna/);
});

test('InfiniteTap totem: falha transitória conserva pedido e reconsulta; cancelar não rejeita sem tratamento', async () => {
  const { client, messages, timers } = setup();
  client.request = async () => { throw Object.assign(new Error('Servidor indisponível'), { status: 503 }); };
  await client.poll(); await client.cancel();
  assert.equal(client.order.id, 'order'); assert.equal(timers.length, 1); assert.equal(messages.length, 0);
});

test('InfiniteTap totem: erro atrasado de pedido anterior não remove o atual', async () => {
  for (const action of ['poll', 'cancel']) {
    const { client, messages } = setup(); let fail;
    client.request = () => new Promise((resolve, reject) => { fail = reject; });
    const pending = client[action](); client.forget(); client.order = { id: 'new', token: 'new-token' };
    fail(Object.assign(new Error('Pedido inexistente'), { status: 404 })); await pending;
    assert.equal(client.order.id, 'new'); assert.equal(messages.length, 0);
  }
});

test('InfiniteTap totem: request preserva status HTTP para distinguir pedido perdido de queda de rede', async () => {
  const { client, context } = setup();
  context.fetch = async () => ({ ok: false, status: 404, json: async () => ({ erro: 'Pedido inexistente' }) });
  await assert.rejects(client.request('/orders/missing'), e => e.status === 404 && e.message === 'Pedido inexistente');
});
