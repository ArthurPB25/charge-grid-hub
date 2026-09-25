import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { TotemHistory, dayKey } from '../totem-history.js';
import { readSemsImport } from '../sems-import.js';
import SimEngine, { SimClock, SiteModel } from '../sim/engine.js';
const require = createRequire(import.meta.url);
const { vehicles } = require('../../data/mock-data.js');

function temporaryFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chargegrid-history-'));
  const file = path.join(dir, 'history.json');
  t.after(() => { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); });
  return file;
}

test('persiste somente sessões do totem, sem duplicar e usando datas reais', t => {
  const file = temporaryFile(t);
  const history = new TotemHistory(file);
  const record = { id: 'TOT-test', ambient: false, actualStartedAt: '2026-09-25T01:00:00Z', actualFinishedAt: '2026-09-25T02:00:00Z', energyGridKWh: 2.5, cost: 4, paymentMethod: 'demo' };
  history.add({ ...record, id: 'ambient', ambient: true });
  history.add(record);
  history.add(record);
  const restored = new TotemHistory(file);
  const snapshot = restored.snapshot(new Date('2026-09-25T02:30:00Z'));
  assert.equal(snapshot.sessionHistory.length, 1);
  assert.equal(snapshot.today.date, '2026-09-24');
  assert.equal(snapshot.today.sessions, 1);
  assert.equal(snapshot.today.pixReported, 0);
  assert.equal(snapshot.today.energyKWh, 2.5);
  assert.equal(snapshot.sessionHistory[0].energySource, 'simulation');
  assert.equal(dayKey(record.actualFinishedAt), '2026-09-24');
});

test('encerramento manual, automático e manutenção entram no histórico uma única vez', () => {
  SimEngine.boot({ ambient: 0 });
  SimClock.stop();
  SimEngine.totemHistory = new TotemHistory();
  const config = { stationId: 1, vehicle: vehicles[0], startSoc: .2, targetSoc: .8, paymentMethod: 'demo' };
  try {
    const manual = SimEngine.startUserSession(config);
    SimEngine.stopUserSession('Remote');
    SimEngine.stopUserSession('Local');
    assert.equal(SimEngine.totemHistory.records.length, 1);
    assert.equal(SimEngine.totemHistory.records[0].id, manual.id);
    const automatic = SimEngine.startUserSession({ ...config, targetSoc: .20001 });
    SimEngine._tick(15, SimClock.simDate);
    assert.equal(automatic.status, 'finished');
    SimEngine.stopUserSession();
    assert.equal(SimEngine.totemHistory.records.length, 2);
    SimEngine.startUserSession(config);
    SimEngine.toggleStation(1);
    assert.equal(SimEngine.userSession, null);
    assert.equal(SimEngine.totemHistory.records.length, 3);
    assert.equal(SiteModel.getEvse(1).status, 'Unavailable');
  } finally {
    SimClock.stop();
    if (SimEngine.userSession) SimEngine.stopUserSession();
  }
});

test('importação SEMS tem fonte, instante de consulta e total sem duplicatas', t => {
  const file = temporaryFile(t);
  assert.equal(readSemsImport(file).status, 'not-configured');
  const record = { startedAtDisplay: '24/09/2026 18:09:09', finishedAtDisplay: '24/09/2026 22:22:45', energyKWh: 9.47 };
  fs.writeFileSync(file, JSON.stringify({ capturedAt: '2026-09-25T16:00:00Z', records: [record, record] }));
  const result = readSemsImport(file);
  assert.equal(result.status, 'imported');
  assert.equal(result.records.length, 1);
  assert.equal(result.totalEnergyKWh, 9.47);
  assert.equal(result.capturedAt, '2026-09-25T16:00:00Z');
  fs.writeFileSync(file, JSON.stringify({ capturedAt: '2026-09-25T16:00:00Z', records: [{ ...record, energyKWh: -1 }] }));
  assert.equal(readSemsImport(file).status, 'invalid-import');
});
