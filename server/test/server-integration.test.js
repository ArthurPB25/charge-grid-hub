import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));

test('servidor completo: assets, isolamento de arquivos, JSON, estimativas e PDF', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'chargegrid-api-'));
  const history = join(dir, 'history.json'); writeFileSync(history, '[]');
  const child = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, PORT: '0', AI_PROVIDER: 'rules',
    MP_ACCESS_TOKEN: 'TEST-substitua-pelo-seu-token', TOTEM_HISTORY_FILE: history, SEMS_IMPORT_FILE: join(dir, 'missing.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); unlinkSync(history); rmdirSync(dir); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend não iniciou')), 10000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = /Servidor do ChargeGrid Hub rodando em http:\/\/localhost:(\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`Backend encerrou: ${code}`)); } });
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await t.test('totem, admin e todos os assets locais respondem', async () => {
    assert.equal((await (await fetch(base + '/healthz')).json()).ok, true);
    for (const path of ['/', '/admin.html']) assert.equal((await fetch(base + path)).status, 200);
    const assets = [...new Set(['index.html', 'admin.html'].flatMap(file => [...readFileSync(join(root, file), 'utf8').matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(url => /^(css|js|data)\//.test(url))))];
    for (const asset of assets) assert.equal((await fetch(`${base}/${asset}`)).status, 200, asset);
    assert.ok(assets.length > 10);
  });
  await t.test('backend não publica credenciais, histórico ou fontes do servidor', async () => {
    for (const path of ['/.env', '/server/.env', '/server/server.js', '/server/storage/totem-sessions.json', '/server/storage/ollama/models', '/.git/config']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
  });
  await t.test('JSON inválido e parâmetros inválidos geram erro JSON, sem derrubar o servidor', async () => {
    const response = await fetch(base + '/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400); assert.ok((await response.json()).erro);
    assert.equal((await post('/api/estimate', { stationId: 999, vehicleId: 'dolphin' })).status, 400);
    assert.equal((await post('/api/estimate', { stationId: 2, vehicleId: 'dolphin', batteryLevel: 110 })).status, 400);
    assert.equal((await fetch(base + '/healthz')).status, 200);
  });
  await t.test('estimativa válida tem energia, duração e custo finitos', async () => {
    const result = await (await post('/api/estimate', { stationId: 2, vehicleId: 'dolphin', batteryLevel: 20, targetSoc: .8 })).json();
    for (const key of ['estimatedCost', 'estimatedEnergy', 'estimatedMinutes', 'rate']) assert.ok(Number.isFinite(result[key]) && result[key] > 0);
    assert.equal((await (await fetch(base + '/api/pix/saude')).json()).tokenConfigurado, false);
  });
  await t.test('relatórios hoje/semana/mês e PDFs funcionam sem Ollama, com fallback identificado', async () => {
    for (const period of ['today', 'week', 'month']) {
      const report = await (await post('/api/reports/generate', { period })).json();
      assert.equal(report.mode, 'rules'); assert.equal(report.metrics.sessions, 0);
      assert.equal(report.recommendations, undefined);
      const pdf = await fetch(`${base}/api/reports/${report.reportId}/pdf`);
      assert.equal(pdf.headers.get('content-type'), 'application/pdf');
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    }
    assert.equal((await post('/api/reports/generate', { period: 'invalid' })).status, 400);
    assert.equal((await fetch(base + '/api/reports/unknown/pdf')).status, 404);
  });
});
