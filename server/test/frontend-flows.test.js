import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const source = name => readFileSync(new URL(`../../js/${name}.js`, import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness() {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, { style: {}, classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {}, textContent: '', disabled: false }); return nodes.get(id); };
  const document = { getElementById: get, querySelectorAll: () => [] };
  const station = { id: 2, name: 'Estação 02' };
  const window = { addEventListener() {}, StationManager: { getSelectedStation: () => station }, TariffEngine: { getPosto: () => 'fora', postoLabel: () => 'Fora-ponta' },
    PricingEngine: { formatCurrency: value => String(value) } };
  const context = { window, document, crypto: { randomUUID }, AbortSignal, requestAnimationFrame: () => {}, console };
  vm.runInNewContext(source('payment'), context);
  vm.runInNewContext(source('app'), context);
  const app = window.App;
  app.selectedVehicle = { id: 'dolphin', batteryCapacity: 44.9, range: 291, year: 2025, brand: 'BYD', model: 'Dolphin' };
  app.arrivalSoc = .2; app.targetSoc = .8;
  get('pix-payer-email').value = 'payer@example.com';
  app._pixRequestKey = randomUUID();
  window.PaymentController.startPayment({ estimate: { estimatedCost: 20 } });
  return { app, window, nodes, get, context };
}

test('cancelar Pix durante a criação ignora a resposta atrasada e não inicia polling ou recarga', async () => {
  const h = harness(); const pending = deferred(); let polls = 0;
  h.window.PixClient = { criarCobranca: () => pending.promise, acompanharStatus: () => { polls++; } };
  const request = h.app.startRealPix();
  h.app.cancelarPix();
  pending.resolve({ paymentId: 'cancelled-order', qrCodeBase64: 'test', amount: 20 });
  await request;
  assert.equal(h.app._pixPaymentId, null);
  assert.equal(polls, 0);
  assert.equal(h.get('pix-content').style.display, 'none');
});

test('Pix envia R$1 e e-mail; estimativa da energia permanece separada', async () => {
  const h = harness(); let sent;
  h.window.PixClient = { criarCobranca: async value => { sent = value; return { paymentId: 'fixed', amount: 1, sandbox: false, qrCodeBase64: 'test' }; }, acompanharStatus: () => () => {} };
  await h.app.startRealPix();
  assert.equal(sent.valor, 1); assert.equal(sent.email, 'payer@example.com');
  assert.equal(h.window.PaymentController.orderData.estimate.estimatedCost, 20);
  assert.equal(h.get('pix-valor').textContent, '1');
  assert.match(h.get('pix-status').textContent, /real de R\$ 1,00/);
});

test('Pix não solicita cobrança sem e-mail válido', async () => {
  const h = harness(); let calls = 0;
  h.window.PixClient = { criarCobranca: async () => { calls++; } };
  for (const email of ['', 'invalido']) { h.get('pix-payer-email').value = email; await h.app.startRealPix(); }
  assert.equal(calls, 0);
});

test('clique repetido em Pix não duplica a requisição e não usa valor fictício sem estimativa', async () => {
  const h = harness(); const pending = deferred(); let calls = 0;
  h.window.PixClient = { criarCobranca: () => { calls++; return pending.promise; }, acompanharStatus: () => () => {} };
  const first = h.app.startRealPix(); await h.app.startRealPix();
  assert.equal(calls, 1);
  pending.resolve({ paymentId: 'one', qrCodeBase64: 'test', amount: 25 }); await first;
  assert.equal(h.get('pix-valor').textContent, '25');
  h.window.PaymentController.cancelPayment();
  await h.app.startRealPix(); assert.equal(calls, 1);
});

test('estimativa com retorno fora de ordem não sobrescreve a última seleção, inclusive A/B/A', async () => {
  const h = harness(); const a = h.app.selectedVehicle; const b = { ...a, id: 'other' };
  const requests = [deferred(), deferred(), deferred()]; let index = 0;
  h.window.PricingEngine.calculateEstimate = () => requests[index++].promise;
  const first = h.app.showVehicleInfo(a); h.app.selectedVehicle = b;
  const second = h.app.showVehicleInfo(b); h.app.selectedVehicle = a;
  const third = h.app.showVehicleInfo(a);
  const estimate = cost => ({ estimatedEnergy: 10, estimatedCost: cost, estimatedTime: '1h', rate: 1 });
  requests[2].resolve(estimate(30)); await third;
  requests[0].resolve(estimate(10)); await first;
  requests[1].resolve(estimate(20)); await second;
  assert.equal(h.get('calc-cost').textContent, '30');
});

test('pagamento espera a estimativa, preserva o método escolhido e trata indisponibilidade', async () => {
  const h = harness(); const pending = deferred();
  h.window.StationManager.getEstimate = () => pending.promise;
  const prepare = h.app.initPaymentScreen();
  assert.equal(h.app._paymentReady, false);
  h.window.PaymentController.selectMethod('pix');
  pending.resolve({ estimatedCost: 12 }); await prepare;
  assert.equal(h.app._paymentReady, true);
  assert.equal(h.window.PaymentController.selectedMethod, 'pix');
  assert.equal(h.get('btn-confirm-method').disabled, false);
  h.window.StationManager.getEstimate = async () => { throw new Error('offline'); };
  await h.app.initPaymentScreen();
  assert.equal(h.app._paymentReady, false);
  assert.equal(h.window.PaymentController.orderData, null);
  assert.match(h.get('method-summary-cost').textContent, /indisponível/);
});

test('consulta Pix recupera falha transitória e cancelamento silencia consultas em andamento', async () => {
  const timers = new Map(); let seq = 0;
  const window = { ChargeGridConfig: { apiOrigin: '' } };
  vm.runInNewContext(source('pix-client'), { window, AbortSignal,
    setTimeout: fn => { timers.set(++seq, fn); return seq; }, clearTimeout: key => timers.delete(key) });
  const client = window.PixClient; let calls = 0; let errors = 0; let approvals = 0;
  client.consultarStatus = async () => { if (++calls === 1) throw new Error('offline'); return { status: 'approved' }; };
  client.acompanharStatus('one', { onErro: () => { errors++; }, onStatus: () => { approvals++; } });
  const run = async () => { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn(); };
  await run(); assert.equal(errors, 1); assert.equal(timers.size, 1);
  await run(); assert.equal(approvals, 1); assert.equal(timers.size, 0);
  const pending = deferred(); client.consultarStatus = () => pending.promise;
  const cancel = client.acompanharStatus('two', { onErro: () => { errors++; } });
  const inFlight = run(); cancel(); pending.reject(new Error('offline')); await inFlight;
  assert.equal(errors, 1); assert.equal(timers.size, 0);
});

test('falha ao gerar novo relatório não mantém download de um período anterior', async () => {
  const h = harness();
  h.get('report-result').replaceChildren = () => {};
  h.get('report-result').setAttribute = () => {};
  h.get('report-period').value = 'today';
  h.context.fetch = async () => ({ ok: false, json: async () => ({ erro: 'offline' }) });
  h.context.document.createElement = () => ({});
  vm.runInNewContext(source('operational-reports'), h.context);
  const reports = h.window.OperationalReports;
  reports.report = { reportId: 'old' };
  reports.section = { querySelector: selector => h.get(selector.slice(1)) };
  reports.checkProvider = () => {};
  await reports.generate();
  assert.equal(reports.report, null);
  assert.equal(h.get('report-download').hidden, true);
  assert.equal(h.get('report-generate').disabled, false);
});

test('duração arredondada nunca mostra 1h 60min e valores inválidos têm fallback', () => {
  const window = {};
  vm.runInNewContext(source('pricing'), { window });
  assert.equal(window.PricingEngine.formatDuration(119.6), '2h');
  assert.equal(window.PricingEngine.formatDuration(59.6), '1h');
  assert.equal(window.PricingEngine.formatDuration(NaN), 'indisponível');
});

test('identificador de cobrança funciona em HTTP no tablet sem crypto.randomUUID', () => {
  const window = {};
  vm.runInNewContext(source('payment'), { window, crypto: { getRandomValues: array => array.fill(171) } });
  assert.match(window.PaymentController.createRequestId(), /^[\da-f]{32}$/);
});

test('totem desconectado não anuncia tarifa zero ou estações disponíveis', () => {
  const h = harness();
  h.window.SimClient = { connected: false, snapshot: { price: 2 } };
  h.app._availableStations = () => [1, 2];
  h.app.updateWelcomeScreen();
  assert.equal(h.get('welcome-count').textContent, '—');
  assert.equal(h.get('welcome-tariff-value').textContent, 'Indisponível');
  assert.equal(h.get('btn-start').disabled, true);
});

test('queda durante envio de comando não produz sucesso falso nem exceção na interface', () => {
  const window = {}; const WebSocket = { OPEN: 1 };
  vm.runInNewContext(source('sim-client'), { window, WebSocket, console });
  window.SimClient.ws = { readyState: 1, send() { throw new Error('offline'); } };
  window.SimClient.connected = true;
  assert.equal(window.SimClient.send('stop-session', { sessionId: 'test' }), false);
  assert.equal(window.SimClient.connected, false);
});

test('reconexão só libera operações quando chega um snapshot novo', () => {
  const window = { ChargeGridConfig: { wsUrl: 'ws://test' } }; const events = {};
  class Socket { static OPEN = 1; static CONNECTING = 0; readyState = 0; addEventListener(name, fn) { events[name] = fn; } }
  vm.runInNewContext(source('sim-client'), { window, WebSocket: Socket });
  const client = window.SimClient; client.connect(); client.connect();
  events.open(); assert.equal(client.connected, false);
  client._onMessage({ type: 'snapshot', data: { sessions: [] } });
  assert.equal(client.connected, true);
});
