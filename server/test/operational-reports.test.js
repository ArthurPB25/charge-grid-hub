import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildReportContext, localAnalysis, generateAiAnalysis, attachReportRoutes, validateArrangement, reportSections } from '../operational-reports.js';

const now = new Date('2026-10-05T15:00:00Z');
const record = (id, overrides = {}) => ({ id, source: 'totem', startedAt: '2026-10-05T13:00:00Z', finishedAt: '2026-10-05T14:00:00Z',
  energyGridKWh: 5, cost: 6, soc: .8, socTarget: .8, suspendedFor: 120, ...overrides });
const snapshot = () => ({ operations: { sessionHistory: [record('one'), record('two', { soc: .4 }), record('outside', { finishedAt: '2026-09-01T14:00:00Z' }), record('one'), record('ambient', { ambient: true })],
  sems: { status: 'imported', capturedAt: '2026-10-05T13:00:00Z', records: [{ startedAtDisplay: '05/10/2026 09:00:00', finishedAtDisplay: '05/10/2026 10:00:00', energyKWh: 30 }] } },
  sessions: [{ status: 'charging' }], demand: { availableKW: 9, allocation: { stations: [{ status: 'limited' }, { status: 'paused' }] } }, site: { surplusKW: 2 } });

test('calcula período de São Paulo, deduplica registros e separa SEMS de estimativas', () => {
  const context = buildReportContext(snapshot(), 'week', now);
  assert.deepEqual(context.period, { key: 'week', start: '2026-09-29', end: '2026-10-05', timezone: 'America/Sao_Paulo' });
  assert.equal(context.metrics.sessions, 2);
  assert.equal(context.metrics.energyKWh, 10);
  assert.equal(context.metrics.calculatedCost, 12);
  assert.equal(context.metrics.interrupted, 1);
  assert.equal(context.metrics.suspendedMinutes, 4);
  assert.equal(context.facts.find(f => f.id === 'sems').value, '30 kWh · 1 registro(s)');
  assert.ok(!JSON.stringify(context).includes('outside'));
  assert.ok(!JSON.stringify(context).includes('startedAtDisplay'));
});

test('limites de data usam calendário local e excluem o futuro', () => {
  const state = snapshot();
  state.operations.sessionHistory = [record('previous', { finishedAt: '2026-10-05T01:00:00Z' }), record('future', { finishedAt: '2026-10-06T15:00:00Z' }), record('bad', { finishedAt: 'invalid' })];
  assert.equal(buildReportContext(state, 'today', now).metrics.sessions, 0);
  assert.equal(buildReportContext(state, 'week', now).metrics.sessions, 1);
  assert.throws(() => buildReportContext(state, 'all', now));
});

const arrangement = context => Object.fromEntries(reportSections(context).map(s => [s.key, s.factIds]));

test('base vazia não inventa procura, falhas ou recomendações', () => {
  const analysis = localAnalysis(buildReportContext({}, 'today', now));
  assert.match(analysis.summary, /Não há recargas encerradas/);
  assert.equal(analysis.recommendations, undefined);
  assert.match(analysis.observations[0].analysis, /não permite concluir/);
  assert.match(analysis.observations[3].analysis, /não comprova falta/);
});

test('análise distingue encerramento antecipado, pausa histórica e retrato atual', () => {
  const context = buildReportContext(snapshot(), 'week', now);
  const analysis = localAnalysis(context);
  assert.equal(analysis.recommendations, undefined);
  assert.match(analysis.observations[0].analysis, /2 recarga.*10 kWh.*R\$.*12,00/s);
  assert.match(analysis.observations[1].analysis, /1 recarga.*atingiram.*1 encerraram.*4 minuto/s);
  assert.deepEqual(analysis.observations[1].factIds, ['completed-target', 'interrupted', 'suspension']);
  assert.match(analysis.observations[2].analysis, /não descreve todo o período/);
  assert.equal(context.metrics.semsEnergyKWh, 30);
  assert.equal(context.facts.find(f => f.id === 'average-cost').value.replace(/\s/g, ''), 'R$6,00');
});

test('Ollama organiza IDs de dados agregados e não escreve a análise nem modifica valores', async () => {
  const context = buildReportContext(snapshot(), 'week', now);
  const selected = arrangement(context);
  selected.period.reverse();
  let request;
  const output = await generateAiAnalysis(context, { fetchImpl: async (url, options) => {
    if (url.endsWith('/api/show')) return { ok: true, json: async () => ({}) };
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    request = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ done: true, message: { content: JSON.stringify(selected) } }) };
  } });
  assert.deepEqual(output, selected);
  assert.equal(request.stream, false);
  assert.equal(request.format.type, 'object');
  assert.equal(request.options.temperature, 0);
  const input = JSON.parse(request.messages[1].content);
  assert.deepEqual(input.facts, context.facts);
  assert.equal(request.format.properties.summary, undefined);
  assert.equal(request.format.properties.recommendations, undefined);
  assert.deepEqual(reportSections(context, output)[0].factIds, selected.period);
});

test('rejeita texto inventado, dados omitidos, duplicados e mistura de período com estado atual', async () => {
  const context = buildReportContext(snapshot(), 'week', now);
  const correct = arrangement(context);
  assert.throws(() => validateArrangement({ ...correct, summary: 'Falha no equipamento' }));
  assert.throws(() => validateArrangement({ ...correct, period: correct.period.slice(1) }));
  assert.throws(() => validateArrangement({ ...correct, current: [...correct.current.slice(1), correct.current[1]] }));
  const mixed = structuredClone(correct);
  [mixed.period[0], mixed.current[0]] = [mixed.current[0], mixed.period[0]];
  assert.throws(() => validateArrangement(mixed));
  assert.throws(() => validateArrangement({ ...correct, sems: ['invented'] }));
  for (const data of [{ done: false }, { done: true, message: { content: 'recusado' } }, { done: true, done_reason: 'length', message: { content: '{}' } }]) {
    await assert.rejects(generateAiAnalysis(context, { fetchImpl: async url => ({ ok: true, json: async () => url.endsWith('/api/show') ? {} : data }) }));
  }
});

async function serverFor(t, config = {}, fetchImpl, getNow = () => now) {
  const app = express();
  app.use(express.json());
  attachReportRoutes(app, { engine: { snapshot }, config, fetchImpl, now: getNow });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const generate = period => fetch(`${url}/api/reports/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period }) });
  return { url, generate };
}

test('API com IA desativada serve regras, valida período e reutiliza cache', async t => {
  const { url, generate } = await serverFor(t, { AI_PROVIDER: 'rules' });
  assert.equal((await (await fetch(`${url}/api/reports/status`)).json()).aiConfigured, false);
  assert.equal((await generate('__proto__')).status, 400);
  const report = await (await generate('week')).json();
  assert.equal(report.mode, 'rules');
  assert.match(report.warning, /sem modelo de IA/);
  assert.equal(report.cached, false);
  assert.equal((await (await generate('week')).json()).cached, true);
});

test('API trata erro do provedor com fallback identificado e não expõe credenciais', async t => {
  const { url, generate } = await serverFor(t, { OPENAI_API_KEY: 'secret-never-public' }, async () => ({ ok: false, status: 401 }));
  const status = await (await fetch(`${url}/api/reports/status`)).json();
  assert.equal(status.aiConfigured, true);
  assert.ok(!JSON.stringify(status).includes('secret'));
  const report = await (await generate('today')).json();
  assert.equal(report.mode, 'rules');
  assert.match(report.warning, /Ollama não está disponível/);
  assert.ok(!JSON.stringify(report).includes('secret'));
});

test('API marca análise real com IA e impede duas chamadas simultâneas ao provedor', async t => {
  let resolveResponse;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const { generate } = await serverFor(t, {}, async url => {
    if (url.endsWith('/api/show')) return { ok: true, json: async () => ({}) };
    started();
    await new Promise(resolve => { resolveResponse = resolve; });
    return { ok: true, json: async () => ({ done: true, message: { content: JSON.stringify(arrangement(buildReportContext(snapshot(), 'week', now))) } }) };
  });
  const first = generate('week');
  await startedPromise;
  assert.equal((await generate('today')).status, 429);
  resolveResponse();
  const report = await (await first).json();
  assert.equal(report.mode, 'ai');
  assert.equal(report.warning, null);
  assert.equal(report.provider, 'Ollama');
  assert.equal((await (await generate('week')).json()).cached, true);
});

test('não envia dados para hosts externos, modelos de nuvem ou modelos remotos', async () => {
  const context = buildReportContext(snapshot(), 'week', now);
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ remote_host: 'https://ollama.com' }) }; };
  await assert.rejects(generateAiAnalysis(context, { baseUrl: 'https://ollama.com', fetchImpl }));
  await assert.rejects(generateAiAnalysis(context, { model: 'qwen:cloud', fetchImpl }));
  assert.equal(calls, 0);
  await assert.rejects(generateAiAnalysis(context, { fetchImpl }));
  assert.equal(calls, 1);
});

test('modelo ausente não fica em cache e pode funcionar após o download; chave OpenAI é ignorada', async t => {
  let installed = false;
  const { url, generate } = await serverFor(t, { OPENAI_API_KEY: 'never-use-paid-api' }, async url => {
    assert.ok(url.startsWith('http://127.0.0.1:11434/'));
    return url.endsWith('/api/show') ? { ok: installed, status: installed ? 200 : 404, json: async () => ({}) } :
      { ok: true, json: async () => ({ done: true, message: { content: JSON.stringify(arrangement(buildReportContext(snapshot(), 'week', now))) } }) };
  });
  assert.equal((await (await fetch(`${url}/api/reports/status`)).json()).reason, 'missing-model');
  assert.match((await (await generate('week')).json()).warning, /ainda não foi baixado/);
  installed = true;
  assert.equal((await (await generate('week')).json()).mode, 'ai');
});

test('PDF é baixado pelo identificador do relatório original, sem chamar a IA novamente', async t => {
  let calls = 0;
  let date = now;
  const { url, generate } = await serverFor(t, {}, async path => {
    calls++;
    return path.endsWith('/api/show') ? { ok: true, json: async () => ({}) } :
      { ok: true, json: async () => ({ done: true, message: { content: JSON.stringify(arrangement(buildReportContext(snapshot(), 'week', now))) } }) };
  }, () => date);
  const report = await (await generate('week')).json();
  const afterGenerate = calls;
  const response = await fetch(`${url}/api/reports/${report.reportId}/pdf`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /chargegrid-relatorio-2026-09-29-2026-10-05\.pdf/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 2000);
  assert.equal(calls, afterGenerate);
  const cached = await (await generate('week')).json();
  assert.notEqual(cached.reportId, report.reportId);
  assert.equal(calls, afterGenerate);
  assert.equal((await fetch(`${url}/api/reports/unknown/pdf`)).status, 404);
  date = new Date(now.getTime() + 30 * 60 * 1000);
  const expired = await fetch(`${url}/api/reports/${report.reportId}/pdf`);
  assert.equal(expired.status, 404);
  assert.match((await expired.json()).erro, /novamente/);
});

test('botão salva o PDF do servidor com nome do período e restaura o estado', async () => {
  const context = buildReportContext(snapshot(), 'week', now);
  const report = { ...context, ...localAnalysis(context), reportId: 'generated-report', generatedAt: now.toISOString(), mode: 'rules', warning: 'Sem IA.' };
  let link;
  let clicked = false;
  const window = { ChargeGridConfig: { apiOrigin: 'http://localhost:3001' } };
  const button = {};
  const status = {};
  const document = { body: { appendChild: element => { link = element; } }, createElement: () => ({ click: () => { clicked = true; }, remove: () => {} }) };
  vm.runInNewContext(readFileSync(new URL('../../js/operational-reports.js', import.meta.url), 'utf8'), {
    window, document, Blob, AbortSignal,
    fetch: async url => { assert.equal(url, 'http://localhost:3001/api/reports/generated-report/pdf'); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; }
  });
  window.OperationalReports.report = report;
  window.OperationalReports.section = { querySelector: id => id === '#report-download' ? button : status };
  await window.OperationalReports.download();
  assert.equal(clicked, true);
  assert.equal(link.download, 'chargegrid-relatorio-2026-09-29-2026-10-05.pdf');
  assert.equal(link.href, 'http://localhost:3001/api/reports/generated-report/pdf');
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /download.*iniciado/);
});

test('relatório expirado informa erro e não baixa JSON com extensão PDF', async () => {
  const status = {};
  const button = {};
  const window = { ChargeGridConfig: { apiOrigin: '' } };
  vm.runInNewContext(readFileSync(new URL('../../js/operational-reports.js', import.meta.url), 'utf8'), {
    window, AbortSignal,
    fetch: async () => ({ ok: false, json: async () => ({ erro: 'Gere o relatório novamente.' }) }),
    URL: { createObjectURL: () => assert.fail('Não pode baixar erro como PDF') }
  });
  window.OperationalReports.report = { reportId: 'expired' };
  window.OperationalReports.section = { querySelector: id => id === '#report-download' ? button : status };
  await window.OperationalReports.download();
  assert.equal(status.textContent, 'Gere o relatório novamente.');
  assert.equal(button.disabled, false);
});

test('cache da organização não esconde sessões recém-encerradas no relatório', async t => {
  const state = snapshot();
  const app = express(); app.use(express.json());
  attachReportRoutes(app, { engine: { snapshot: () => state }, config: { AI_PROVIDER: 'rules' }, now: () => now });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const generate = async () => (await fetch(`http://127.0.0.1:${server.address().port}/api/reports/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'today' })
  })).json();
  const first = await generate();
  state.operations.sessionHistory.push(record('new'));
  const second = await generate();
  assert.equal(second.cached, true);
  assert.equal(second.metrics.sessions, first.metrics.sessions + 1);
  assert.equal(second.metrics.energyKWh, first.metrics.energyKWh + 5);
  assert.notEqual(second.reportId, first.reportId);
});

test('registro antigo sem bateria/meta não é classificado como meta atingida', () => {
  const state = snapshot();
  state.operations.sessionHistory = [record('legacy', { soc: undefined, socTarget: undefined })];
  const context = buildReportContext(state, 'today', now);
  assert.equal(context.metrics.completedTarget, 0);
  assert.equal(context.metrics.unknownTargets, 1);
  assert.match(localAnalysis(context).observations[1].analysis, /não está disponível para comparação/);
});
