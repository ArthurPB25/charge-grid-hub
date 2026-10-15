const API = 'https://api.mercadopago.com/v1/orders';
export function normalizePixStatus(data) {
  if (data.status === 'processed' && data.status_detail === 'accredited') return 'approved';
  if (['expired', 'cancelled', 'rejected', 'failed'].includes(data.status)) return 'cancelled';
  return 'pending';
}
const checkoutKey = value => JSON.stringify([value?.stationId, value?.vehicleId, value?.startSoc, value?.targetSoc]);
const failure = (message, status = 502) => Object.assign(new Error(message), { status });

/** Injectable gateway: tests never use credentials or create real payments. */
export function attachPixRoutes(app, { engine, config = process.env, fetchImpl = fetch, now = () => Date.now() }) {
  const token = config.MP_ACCESS_TOKEN;
  const configured = Boolean(token) && !token.includes('substitua-pelo-seu-token');
  const requests = new Map();
  const payments = new Map();
  async function call(path, options = {}) {
    if (!configured) throw failure('MP_ACCESS_TOKEN não configurado.', 503);
    try {
      const response = await fetchImpl(`${API}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers } });
      const data = await response.json();
      if (!response.ok) throw failure('O Mercado Pago recusou a operação. Confira a configuração e tente novamente.');
      return data;
    } catch (error) {
      if (error.status) throw error;
      throw failure('Não foi possível consultar o Mercado Pago. Tente novamente; a mesma solicitação não gera outra cobrança.');
    }
  }
  app.post('/api/pix/criar-cobranca', async (req, res) => {
    try {
      const { valor, email, checkout } = req.body || {};
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < .01 || valor > 100000 ||
          (email != null && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
        throw failure('Informe um valor válido em reais e um e-mail válido, se fornecido.', 400);
      }
      const key = req.get('Idempotency-Key');
      if (typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) throw failure('Identificador da solicitação inválido.', 400);
      const fingerprint = JSON.stringify({ valor, email: email || null, checkout: checkoutKey(checkout) });
      let entry = requests.get(key);
      if (entry && entry.fingerprint !== fingerprint) throw failure('Esta solicitação já pertence a outra cobrança.', 409);
      if (!entry) {
        for (const [id, saved] of requests) if (now() - saved.createdAt > 24 * 3600000 && !saved.pending) {
          requests.delete(id);
          if (saved.result) payments.delete(saved.result.paymentId);
        }
        if (requests.size >= 500) throw failure('Limite temporário de cobranças atingido. Tente novamente mais tarde.', 503);
        let amount = valor;
        if (checkout != null) {
          if (typeof checkout !== 'object' || !Number.isFinite(checkout.startSoc) || !Number.isFinite(checkout.targetSoc)) throw failure('Dados da recarga inválidos.', 400);
          if (engine.snapshot && engine.snapshot().evses.find(e => e.stationId === checkout.stationId)?.status !== 'Available') throw failure('A estação não está disponível para esta recarga.', 409);
          const estimate = engine.estimate({ stationId: checkout.stationId, vehicleId: checkout.vehicleId,
            batteryLevel: checkout.startSoc * 100, targetSoc: checkout.targetSoc });
          if (!estimate || estimate.estimatedCost < .01) throw failure('Não foi possível estimar esta recarga.', 400);
          amount = Number(estimate.estimatedCost.toFixed(2));
        }
        entry = { fingerprint, amount, checkout: checkout ? structuredClone(checkout) : null, createdAt: now(), result: null, pending: null, used: false };
        requests.set(key, entry);
      }
      if (!entry.result) {
        if (!entry.pending) {
          const amount = entry.amount.toFixed(2);
          entry.pending = call('', { method: 'POST', headers: { 'X-Idempotency-Key': key }, body: JSON.stringify({
            type: 'online', external_reference: `chargegrid-${key}`, total_amount: amount,
            payer: { email: email || 'motorista@chargegrid.demo', ...(config.MP_SANDBOX !== 'false' ? { first_name: 'APRO' } : {}) },
            transactions: { payments: [{ amount, payment_method: { id: 'pix', type: 'bank_transfer' } }] }
          }) }).then(data => {
            const pix = data.transactions?.payments?.[0]?.payment_method;
            if (!data.id || !pix?.qr_code || !pix?.qr_code_base64) throw failure('Resposta do Mercado Pago sem QR Code válido.');
            entry.result = { paymentId: String(data.id), status: normalizePixStatus(data), amount: entry.amount,
              qrCode: pix.qr_code, qrCodeBase64: pix.qr_code_base64 };
            payments.set(entry.result.paymentId, entry);
            return entry.result;
          }).finally(() => { entry.pending = null; });
        }
        await entry.pending;
      }
      res.json(entry.result);
    } catch (error) { res.status(error.status || 502).json({ erro: error.message }); }
  });
  app.get('/api/pix/status/:id', async (req, res) => {
    try {
      if (!payments.has(req.params.id)) throw failure('Cobrança não encontrada nesta execução do servidor.', 404);
      const data = await call(`/${encodeURIComponent(req.params.id)}`);
      res.json({ status: normalizePixStatus(data), statusDetail: data.status_detail });
    } catch (error) { res.status(error.status || 502).json({ erro: error.message }); }
  });
  app.get('/api/pix/saude', (req, res) => res.json({ ok: true, tokenConfigurado: configured }));
  return {
    async verify(paymentId, session) {
      const entry = payments.get(paymentId);
      const checkout = { stationId: session.stationId, vehicleId: session.vehicle?.id,
        startSoc: session.startSoc, targetSoc: session.targetSoc ?? .8 };
      if (!entry || !entry.checkout || entry.used || checkoutKey(entry.checkout) !== checkoutKey(checkout)) throw failure('O Pix não corresponde a esta recarga ou já foi utilizado.', 400);
      const data = await call(`/${encodeURIComponent(paymentId)}`);
      if (normalizePixStatus(data) !== 'approved' || Number(data.total_amount) !== entry.amount) throw failure('Pagamento ainda não confirmado para esta recarga.', 409);
      return (commit = true) => { if (entry.used) throw failure('Pagamento já utilizado.', 409); if (commit) entry.used = true; };
    }
  };
}
