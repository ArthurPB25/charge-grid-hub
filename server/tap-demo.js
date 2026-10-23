import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { validSessionConfig } from './sim/validation.js';
import { analyzeTapResult } from './tap-result.js';
import SmartPricing from './sim/smart-pricing.js';
const { vehicles } = createRequire(import.meta.url)('../data/mock-data.js');

// Presentation-only evidence from a trusted group's app, not bank verification.
export function candidateTapApproval(data = {}) {
  return analyzeTapResult(data).confirmed;
}

export function attachTapDemoRoutes(app, { engine, enabled = false, now = Date.now, terminalKey = process.env.TAP_TERMINAL_KEY || '', merchantHandle = process.env.TAP_TERMINAL_HANDLE || '' }) {
  const orders = new Map(), keys = new Map(), usedNsu = new Map();
  const terminalEnabled = /^[a-f0-9]{64}$/i.test(terminalKey);
  let terminalOwner = null, terminalHandle = null;
  const hash = value => createHash('sha256').update(value).digest('hex');
  let beforeStart = () => {};
  const ttl = 10 * 60 * 1000;
  const fault = (message, status = 400) => Object.assign(new Error(message), { status });
  const update = order => { if (order.state === 'pending' && now() >= order.expiresAt) order.state = 'expired'; return order; };
  const publicOrder = o => ({ id: o.id, code: o.code, state: update(o).state, stationId: o.config.stationId,
    vehicle: `${o.config.vehicle.brand} ${o.config.vehicle.model}`, amountCents: 100, method: o.method,
    expiresAt: o.expiresAt, sessionId: o.sessionId || null, message: o.message || null, diagnostic: o.diagnostic || null, lockedRate: o.config.lockedRate, evidence: 'local-callback-demo' });
  const available = id => engine.snapshot().evses.find(e => e.stationId === id)?.status === 'Available';
  const connectionOrder = order => {
    const result = publicOrder(order);
    if (order.config.stationId === 1 && order.sessionId) {
      const session = engine.snapshot().sessions?.find(s => s.id === order.sessionId && s.evse.stationId === 1);
      result.physical = { sessionId: order.sessionId, active: Boolean(session && session.status !== 'finished'),
        command: session && session.status !== 'finished' && session.evse.commandedA > 0 ? 'LIGAR' : 'DESLIGAR' };
    }
    return result;
  };
  const lookup = (id, token, phone = false) => {
    const order = orders.get(id);
    if (!order || !token || token !== (phone ? order.phoneToken : order.browserToken)) throw fault('Pedido não encontrado ou acesso inválido.', 404);
    return update(order);
  };
  const route = fn => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { if (!enabled) throw fault('Demonstração InfiniteTap desativada.', 503); fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
  };
  app.get('/api/tap-demo/health', (req, res) => res.json({ enabled, terminalEnabled, amountCents: 100, evidence: 'local-callback-demo' }));
  // Dedicated merchant phone: one-time secret, exclusive device, FIFO orders.
  // No provider call and no financial action happen while receiving an order.
  app.post('/api/tap-demo/terminal/next', route((req, res) => {
    const key = req.get('X-Tap-Terminal-Key') || '';
    if (!terminalEnabled) throw fault('Celular fixo ainda não configurado pelo operador.', 503);
    if (!/^[a-f0-9]{64}$/i.test(key) || !timingSafeEqual(Buffer.from(key.toLowerCase()), Buffer.from(terminalKey.toLowerCase()))) throw fault('Acesso ao celular fixo inválido.', 401);
    const { deviceKey, handle } = req.body || {};
    if (typeof deviceKey !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(deviceKey) || typeof handle !== 'string' || !/^[\w-]{1,100}$/.test(handle)) throw fault('Identificação do celular ou conta inválida.');
    if (merchantHandle && handle !== merchantHandle) throw fault('Conta diferente da configurada pelo estabelecimento.', 403);
    const owner = hash(deviceKey);
    if (terminalOwner && (terminalOwner !== owner || terminalHandle !== handle)) throw fault('Outro celular ou conta já está vinculado. Procure o operador.', 409);
    terminalOwner = owner; terminalHandle = handle;
    let order = [...orders.values()].find(o => o.terminalOwner === owner && update(o).state === 'pending');
    if (!order) order = [...orders.values()].find(o => update(o).state === 'pending' && !o.phoneToken && available(o.config.stationId));
    if (!order) return res.json({ order: null });
    if (!order.phoneToken) {
      order.handle = handle; order.phoneToken = randomBytes(24).toString('hex');
      order.terminalOwner = owner;
    }
    res.json({ order: { ...publicOrder(order), token: order.phoneToken } });
  }));
  app.post('/api/tap-demo/orders', route((req, res) => {
    const p = req.body || {}, key = req.get('Idempotency-Key');
    if (!/^[\w-]{16,100}$/.test(key || '') || !['debit', 'credit'].includes(p.method)) throw fault('Pedido inválido.');
    const vehicle = vehicles.find(v => v.id === p.vehicleId);
    const config = { stationId: p.stationId, vehicle, startSoc: p.startSoc, targetSoc: p.targetSoc, paymentMethod: 'tap-demo' };
    if (!validSessionConfig(config)) throw fault('Estação ou veículo inválido.');
    const fingerprint = JSON.stringify(config) + p.method;
    const prior = keys.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw fault('Solicitação já usada para outro pedido.', 409);
      return res.json({ ...publicOrder(prior), token: prior.browserToken });
    }
    for (const [id, order] of orders) if (now() - order.createdAt > 24 * 3600000) {
      orders.delete(id); keys.delete(order.key);
      if (order.nsu) usedNsu.delete(order.nsu);
    }
    if (orders.size >= 500) throw fault('Limite de pedidos de demonstração atingido.', 503);
    if (!available(p.stationId)) throw fault('Estação indisponível.', 409);
    if ([...orders.values()].some(o => ['pending', 'paid', 'review'].includes(update(o).state) && o.config.stationId === p.stationId)) throw fault('Já existe um pedido pendente para esta estação.', 409);
    let code;
    do { code = randomBytes(4).toString('hex').toUpperCase(); } while ([...orders.values()].some(o => o.code === code));
    const order = { id: randomUUID(), code, config, method: p.method, key, fingerprint,
      browserToken: randomBytes(24).toString('hex'), state: 'pending', createdAt: now(), expiresAt: now() + ttl };
    config.lockedRate = SmartPricing.quoteNextSession(); config.lockedPosto = SmartPricing.posto();
    orders.set(order.id, order); keys.set(key, order);
    res.json({ ...publicOrder(order), token: order.browserToken });
  }));
  app.get('/api/tap-demo/orders/:id', route((req, res) => res.json(publicOrder(lookup(req.params.id, req.get('X-Tap-Token'))))));
  app.post('/api/tap-demo/orders/:id/cancel', route((req, res) => {
    const order = lookup(req.params.id, req.get('X-Tap-Token'));
    if (order.state === 'pending') order.state = 'cancelled';
    res.json(publicOrder(order));
  }));
  app.post('/api/tap-demo/claim', route((req, res) => {
    const { code, handle, claimKey } = req.body || {};
    if (typeof code !== 'string' || !/^[A-F0-9]{8}$/.test(code) || typeof handle !== 'string' || !/^[\w-]{1,100}$/.test(handle)) throw fault('Código ou InfiniteTag inválidos.');
    if (merchantHandle && handle !== merchantHandle) throw fault('Conta diferente da configurada pelo estabelecimento.', 403);
    if (claimKey != null && (typeof claimKey !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(claimKey))) throw fault('Chave de conexão inválida.');
    const claimHash = claimKey ? createHash('sha256').update(claimKey).digest('hex') : null;
    const order = [...orders.values()].find(o => o.code === code);
    if (!order || update(order).state !== 'pending') throw fault('Código indisponível ou expirado.', 404);
    if (order.phoneToken) {
      if (claimHash && order.claimHash === claimHash && order.handle === handle) return res.json({ ...publicOrder(order), token: order.phoneToken });
      throw fault('Pedido já conectado a um celular. Não repita a cobrança.', 409);
    }
    order.claimHash = claimHash;
    order.handle = handle; order.phoneToken = randomBytes(24).toString('hex');
    res.json({ ...publicOrder(order), token: order.phoneToken });
  }));
  app.post('/api/tap-demo/orders/:id/result', route((req, res) => {
    const order = lookup(req.params.id, req.get('X-Tap-Token'), true);
    const data = req.body || {};
    if (data.order_id !== order.id || data.handle !== order.handle) throw fault('Retorno não corresponde ao pedido/conta.');
    if (!['pending', 'review'].includes(order.state)) return res.json(publicOrder(order));
    const result = analyzeTapResult(data);
    if (!result.confirmed) {
      order.state = 'review'; order.message = result.message; order.diagnostic = result.diagnostic;
      console.warn('InfiniteTap: retorno exige conferência', JSON.stringify({ orderId: order.id, ...result.diagnostic }));
      return res.json(publicOrder(order));
    }
    const nsu = data.nsu.toLowerCase();
    if (usedNsu.has(nsu)) throw fault('Este retorno já foi utilizado.', 409);
    if (!available(order.config.stationId)) {
      order.state = 'blocked'; order.message = 'Estação indisponível. Confira o pagamento com o operador; não pague novamente.';
      return res.json(publicOrder(order));
    }
    order.state = 'paid'; order.nsu = nsu; delete order.diagnostic;
    order.message = 'Pagamento recebido. Volte ao totem e toque em Conectar para iniciar a recarga.';
    usedNsu.set(nsu, order.id);
    res.json(publicOrder(order));
  }));
  app.post('/api/tap-demo/orders/:id/connect', route((req, res) => {
    const order = lookup(req.params.id, req.get('X-Tap-Token'));
    if (order.state === 'released') {
      if (order.config.stationId === 1 && connectionOrder(order).physical.active) beforeStart(order);
      return res.json(connectionOrder(order));
    }
    if (order.state !== 'paid') throw fault('Aguarde a confirmação do pagamento antes de conectar.', 409);
    if (!available(order.config.stationId)) throw fault('Estação indisponível. Procure o operador; não pague novamente.', 409);
    beforeStart(order);
    const session = engine.startUserSession(order.config);
    if (!session) throw fault('Não foi possível conectar. Procure o operador; não pague novamente.', 409);
    order.state = 'released'; order.sessionId = session.id;
    engine._notify();
    res.json(connectionOrder(order));
  }));
  app.post('/api/tap-demo/orders/:id/ready', route((req, res) => {
    const order = lookup(req.params.id, req.get('X-Tap-Token'), true);
    if (order.state !== 'pending' || !available(order.config.stationId)) throw fault('Pedido expirado, encerrado ou estação indisponível. Não inicie o pagamento.', 409);
    res.json(publicOrder(order));
  }));
  app.post('/api/tap-demo/orders/:id/close-review', route((req, res) => {
    const order = lookup(req.params.id, req.get('X-Tap-Token'), true);
    if (req.body?.checked !== true) throw fault('Confira a transação no InfinitePay antes de encerrar.', 409);
    if (order.state === 'not-confirmed') return res.json(publicOrder(order));
    if (order.state !== 'review') throw fault('Pedido não está aguardando conferência.', 409);
    order.state = 'not-confirmed';
    order.message = 'Acompanhamento encerrado pelo estabelecimento. Isso não cancela nem estorna um pagamento.';
    res.json(publicOrder(order));
  }));
  return { setBeforeStart(fn) { beforeStart = fn; }, canWatch(id, token) { try { return ['pending', 'paid', 'review', 'released'].includes(lookup(id, token).state); } catch { return false; } } };
}
