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
import { attachReportRoutes } from './operational-reports.js';
import { fileURLToPath } from 'node:url';
import { attachPixRoutes } from './pix.js';

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

const PORT = process.env.PORT || 3001;
const pix = attachPixRoutes(app, { engine: SimEngine });

/**
 * Estimativa de custo/tempo antes de existir uma sessão — chamada toda vez
 * que o motorista troca de veículo/estação na tela, ainda sem ter carregado.
 */
app.post('/api/estimate', (req, res) => {
  const resultado = SimEngine.estimate(req.body || {});
  if (!resultado) return res.status(400).json({ erro: 'stationId/vehicleId inválidos.' });
  res.json(resultado);
});

attachReportRoutes(app, { engine: SimEngine });
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError || error.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido na solicitação.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ erro: 'Solicitação muito grande.' });
  res.status(500).json({ erro: 'Não foi possível concluir a solicitação.' });
});

// Única inicialização do motor no processo inteiro — nada de boot por
// conexão: totem e admin só se conectam a essa instância já rodando.
SimEngine.totemHistory = new TotemHistory(process.env.TOTEM_HISTORY_FILE || fileURLToPath(new URL('./storage/totem-sessions.json', import.meta.url)));
SimEngine.semsImport = readSemsImport(process.env.SEMS_IMPORT_FILE || fileURLToPath(new URL('./storage/sems-import.json', import.meta.url)));
SimEngine.boot({ ambient: 0 });

const httpServer = app.listen(PORT, () => {
  console.log(`Servidor do ChargeGrid Hub rodando em http://localhost:${httpServer.address().port}`);
  console.log(Boolean(process.env.MP_ACCESS_TOKEN) && !process.env.MP_ACCESS_TOKEN.includes('substitua-pelo-seu-token')
    ? 'Token do Mercado Pago encontrado.'
    : 'ATENÇÃO: MP_ACCESS_TOKEN não configurado — veja server/.env.example.');
});

const authorization = new MqttAuthorization();
attachWebSocket(httpServer, SimEngine, OcppClient, ModbusBus, authorization, pix);
console.log(`Motor de simulação ativo — WebSocket em ws://localhost:${PORT}/ws`);
