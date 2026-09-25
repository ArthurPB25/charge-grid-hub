/**
 * Backend do ChargeGrid Hub.
 *
 * Duas responsabilidades nesta mesma porta:
 * 1) Pix real via Mercado Pago — o Access Token nunca pode aparecer no
 *    navegador, então a chamada passa por aqui.
 * 2) O motor de simulação (js/sim/* portado para server/sim/*), rodando como
 *    uma única instância persistente. Totem e admin conectam por WebSocket
 *    (/ws) e recebem o mesmo estado ao vivo, em vez de cada um rodar sua
 *    própria simulação isolada como acontecia antes.
 *
 * Frontend, API e WebSocket compartilham a mesma porta para hospedagem.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import SimEngine, { OcppClient, ModbusBus } from './sim/engine.js';
import { attachWebSocket } from './ws.js';
import { MqttAuthorization } from './mqtt-authorization.js';
import { TotemHistory } from './totem-history.js';
import { readSemsImport } from './sems-import.js';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(cors());
app.use(express.json());

// Publish only browser assets: never expose .env, storage or backend sources.
app.get('/healthz', (req, res) => res.json({ ok: true }));
for (const folder of ['css', 'js', 'data']) {
  app.use('/' + folder, express.static(fileURLToPath(new URL('../' + folder + '/', import.meta.url)), { dotfiles: 'deny', index: false }));
}
app.get(['/', '/index.html'], (req, res) => res.sendFile(fileURLToPath(new URL('../index.html', import.meta.url))));
app.get('/admin.html', (req, res) => res.sendFile(fileURLToPath(new URL('../admin.html', import.meta.url))));

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
// A API antiga (/v1/payments) rejeita as credenciais desta conta com
// "Unauthorized use of live credentials" mesmo sendo um token de teste — a
// aplicação só está habilitada para a API nova de Orders. Ver
// HARDWARE-E-PAGAMENTO.md para o diagnóstico completo.
const MP_API = 'https://api.mercadopago.com/v1/orders';
const PORT = process.env.PORT || 3001;
// Em sandbox, o Mercado Pago aprova automaticamente um pagamento Pix cujo
// payer.first_name seja exatamente "APRO" — é um valor mágico documentado
// só para testes. Desligue isso (MP_SANDBOX=false no .env) ao usar um token
// de produção de verdade, senão essa string vai junto como nome do pagador.
const SANDBOX = process.env.MP_SANDBOX !== 'false';

function tokenConfigurado() {
  return Boolean(MP_ACCESS_TOKEN) && !MP_ACCESS_TOKEN.includes('substitua-pelo-seu-token');
}

// Traduz o vocabulário da API de Orders (processed/action_required/expired)
// para o vocabulário que o front-end já entende (approved/pending/...).
function normalizarStatus(dados) {
  if (dados.status === 'processed' && dados.status_detail === 'accredited') return 'approved';
  if (dados.status === 'expired') return 'cancelled';
  if (dados.status === 'cancelled') return 'cancelled';
  return 'pending';
}

/**
 * Cria uma cobrança Pix real (em modo de teste, se MP_SANDBOX não for "false").
 * Body esperado: { valor: number, descricao?: string, email?: string }
 */
app.post('/api/pix/criar-cobranca', async (req, res) => {
  if (!tokenConfigurado()) {
    return res.status(500).json({
      erro: 'MP_ACCESS_TOKEN não configurado. Copie server/.env.example para server/.env e preencha com o seu token de teste do Mercado Pago.'
    });
  }

  const { valor, descricao, email } = req.body || {};
  const valorNumero = Number(valor);
  if (!valorNumero || valorNumero <= 0) {
    return res.status(400).json({ erro: 'Informe "valor" maior que zero, em reais (ex: 12.50).' });
  }
  const valorFormatado = valorNumero.toFixed(2);

  try {
    const resposta = await fetch(MP_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        // Evita que uma cobrança seja criada duas vezes se o pedido for
        // reenviado (ex: usuário clicou duas vezes, ou houve retry de rede).
        'X-Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        type: 'online',
        external_reference: `chargegrid-${Date.now()}`,
        total_amount: valorFormatado,
        payer: {
          email: email || 'motorista@chargegrid.demo',
          ...(SANDBOX ? { first_name: 'APRO' } : {})
        },
        transactions: {
          payments: [{
            amount: valorFormatado,
            payment_method: { id: 'pix', type: 'bank_transfer' }
          }]
        }
      })
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      return res.status(resposta.status).json({
        erro: 'O Mercado Pago recusou a cobrança.',
        detalhe: dados.message || dados
      });
    }

    const pagamento = dados.transactions && dados.transactions.payments && dados.transactions.payments[0];
    const pix = pagamento && pagamento.payment_method;
    if (!pix) {
      return res.status(502).json({ erro: 'Resposta do Mercado Pago sem dados de Pix.', detalhe: dados });
    }

    res.json({
      paymentId: dados.id,
      status: normalizarStatus(dados),
      qrCode: pix.qr_code,           // string "copia e cola"
      qrCodeBase64: pix.qr_code_base64, // imagem do QR pronta, em base64
      ticketUrl: pix.ticket_url
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao falar com o Mercado Pago.', detalhe: err.message });
  }
});

/**
 * Consulta se uma cobrança já foi paga. O totem chama isso periodicamente
 * (polling) enquanto mostra o QR Code na tela.
 */
app.get('/api/pix/status/:id', async (req, res) => {
  if (!tokenConfigurado()) {
    return res.status(500).json({ erro: 'MP_ACCESS_TOKEN não configurado.' });
  }

  try {
    const resposta = await fetch(`${MP_API}/${encodeURIComponent(req.params.id)}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      return res.status(resposta.status).json({ erro: 'Não foi possível consultar a cobrança.', detalhe: dados });
    }

    res.json({ status: normalizarStatus(dados), statusDetail: dados.status_detail });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar status.', detalhe: err.message });
  }
});

app.get('/api/pix/saude', (req, res) => {
  res.json({ ok: true, tokenConfigurado: tokenConfigurado() });
});

/**
 * Estimativa de custo/tempo antes de existir uma sessão — chamada toda vez
 * que o motorista troca de veículo/estação na tela, ainda sem ter carregado.
 */
app.post('/api/estimate', (req, res) => {
  const resultado = SimEngine.estimate(req.body || {});
  if (!resultado) return res.status(400).json({ erro: 'stationId/vehicleId inválidos.' });
  res.json(resultado);
});

// Única inicialização do motor no processo inteiro — nada de boot por
// conexão: totem e admin só se conectam a essa instância já rodando.
SimEngine.totemHistory = new TotemHistory(process.env.TOTEM_HISTORY_FILE || fileURLToPath(new URL('./storage/totem-sessions.json', import.meta.url)));
SimEngine.semsImport = readSemsImport(process.env.SEMS_IMPORT_FILE || fileURLToPath(new URL('./storage/sems-import.json', import.meta.url)));
SimEngine.boot({ ambient: 0 });

const httpServer = app.listen(PORT, () => {
  console.log(`Servidor do ChargeGrid Hub rodando em http://localhost:${PORT}`);
  console.log(tokenConfigurado()
    ? 'Token do Mercado Pago encontrado.'
    : 'ATENÇÃO: MP_ACCESS_TOKEN não configurado — veja server/.env.example.');
});

const authorization = new MqttAuthorization();
attachWebSocket(httpServer, SimEngine, OcppClient, ModbusBus, authorization);
console.log(`Motor de simulação ativo — WebSocket em ws://localhost:${PORT}/ws`);
