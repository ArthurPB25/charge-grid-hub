import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { validSessionConfig } from './sim/validation.js';
const { vehicles } = createRequire(import.meta.url)('../data/mock-data.js');

// Presentation-only evidence from a trusted group's app, not bank verification.
export function candidateTapApproval(data = {}) {
  const clean = v => typeof v === 'string' && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v);
  if (!['nsu', 'aut', 'card_brand'].every(k => clean(data[k]) && data[k].trim())) return false;
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(data.nsu) || !/^[a-z\d]{1,40}$/i.test(data.aut)) return false;
  if (['warning', 'error', 'error_message', 'error_code', 'cancelled', 'canceled'].some(k => data[k] != null && data[k] !== '' && data[k] !== false && data[k] !== 'false')) return false;
  if (data.success != null && ![true, 'true'].includes(data.success)) return false;
  if (data.status != null && !['approved', 'success', 'successful', 'paid', 'completed'].includes(data.status)) return false;
  return true;
}

export function attachTapDemoRoutes(app, { engine, enabled = false, now = Date.now }) {
  const orders = new Map(), keys = new Map(), usedNsu = new Map();
  let beforeStart = () => {};
  const ttl = 10 * 60 * 1000;
  const fault = (message, status = 400) => Object.assign(new Error(message), { status });
  const update = order => { if (order.state === 'pending' && now() >= order.expiresAt) order.state = 'expired'; return order; };
  const publicOrder = o => ({ id: o.id, code: o.code, state: update(o).state, stationId: o.config.stationId,
    vehicle: `${o.config.vehicle.brand} ${o.config.vehicle.model}`, amountCents: 100, method: o.method,
    expiresAt: o.expiresAt, sessionId: o.sessionId || null, message: o.message || null, evidence: 'local-callback-demo' });
  const available = id => engine.snapshot().evses.find(e => e.stationId === id)?.status === 'Available';
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
  app.get('/api/tap-demo/health', (req, res) => res.json({ enabled, amountCents: 100, evidence: 'local-callback-demo' }));
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
    if ([...orders.values()].some(o => update(o).state === 'pending' && o.config.stationId === p.stationId)) throw fault('Já existe um pedido pendente para esta estação.', 409);
    let code;
    do { code = randomBytes(4).toString('hex').toUpperCase(); } while ([...orders.values()].some(o => o.code === code));
    const order = { id: randomUUID(), code, config, method: p.method, key, fingerprint,
      browserToken: randomBytes(24).toString('hex'), state: 'pending', createdAt: now(), expiresAt: now() + ttl };
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
    if (order.state !== 'pending') return res.json(publicOrder(order));
    if (!candidateTapApproval(data)) {
      order.state = 'not-confirmed'; order.message = 'Pagamento não confirmado pelo retorno local. Nenhuma recarga foi iniciada.';
      return res.json(publicOrder(order));
    }
    const nsu = data.nsu.toLowerCase();
    if (usedNsu.has(nsu)) throw fault('Este retorno já foi utilizado.', 409);
    if (!available(order.config.stationId)) {
      order.state = 'blocked'; order.message = 'Estação indisponível. Confira o pagamento com o operador; não pague novamente.';
      return res.json(publicOrder(order));
    }
    beforeStart(order);
    const session = engine.startUserSession(order.config);
    if (!session) throw fault('Não foi possível iniciar a recarga. Consulte o operador.', 409);
    order.state = 'released'; order.sessionId = session.id; order.nsu = nsu;
    usedNsu.set(nsu, order.id);
    engine._notify();
    res.json(publicOrder(order));
  }));
  app.post('/api/tap-demo/orders/:id/ready', route((req, res) => {
    const order = lookup(req.params.id, req.get('X-Tap-Token'), true);
    if (order.state !== 'pending' || !available(order.config.stationId)) throw fault('Pedido expirado, encerrado ou estação indisponível. Não inicie o pagamento.', 409);
    res.json(publicOrder(order));
  }));
  return { setBeforeStart(fn) { beforeStart = fn; }, canWatch(id, token) { try { return lookup(id, token).state === 'pending'; } catch { return false; } } };
}
