import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import SimEngine, { SimClock, SiteModel } from '../sim/engine.js';
const { vehicles } = createRequire(import.meta.url)('../../data/mock-data.js');
function reset() { SimEngine.boot({ ambient: 0 }); SimClock.stop(); SiteModel.init(); }

test('estimativa rejeita estação inexistente, bateria/meta inválida e limite de potência sem sentido', () => {
  reset();
  const valid = { stationId: 2, vehicleId: vehicles[0].id, batteryLevel: 20, targetSoc: .8 };
  for (const patch of [{ stationId: 999 }, { batteryLevel: -1 }, { batteryLevel: 101 }, { batteryLevel: '20' }, { targetSoc: -1 }, { targetSoc: 2 }, { targetSoc: .1 }, { capKW: -3 }, { capKW: 0 }]) {
    assert.equal(SimEngine.estimate({ ...valid, ...patch }), null, JSON.stringify(patch));
  }
  const empty = SimEngine.estimate({ ...valid, batteryLevel: 80 });
  assert.equal(empty.estimatedEnergy, 0);
  assert.ok(Number.isFinite(SimEngine.estimate(valid).estimatedMinutes));
});

test('sessão rejeita capacidade zero e bateria/meta inválidas sem modificar estações', () => {
  reset();
  const config = { stationId: 2, vehicle: vehicles[0], startSoc: .2, targetSoc: .8 };
  for (const patch of [{ vehicle: { ...vehicles[0], batteryCapacity: 0 } }, { vehicle: {} }, { startSoc: -1 }, { startSoc: '0.2' }, { targetSoc: 2 }, { targetSoc: .1 }]) {
    assert.equal(SimEngine.startUserSession({ ...config, ...patch }), null);
    assert.equal(SiteModel.sessions.length, 0);
  }
});

test('último tick não entrega nem cobra energia além da meta, inclusive em 240x', () => {
  reset();
  const s = SimEngine.startUserSession({ stationId: 2, vehicle: vehicles[0], startSoc: .79, targetSoc: .8 });
  const expectedBattery = (.8 - .79) * vehicles[0].batteryCapacity;
  s.step(3600, 7.36, 2, 'fora');
  assert.equal(s.status, 'finished');
  assert.ok(Math.abs(s.soc - .8) < 1e-10);
  assert.ok(Math.abs(s.energyBatteryKWh - expectedBattery) < 1e-10);
  assert.ok(Math.abs(s.cost - s.energyGridKWh * s.lockedRate) < 1e-10);
  assert.ok(s.elapsedSim < 3600);
});

test('comandos inválidos do relógio não envenenam a data compartilhada', () => {
  reset();
  const before = SimClock.simDate.getTime();
  for (const args of [[NaN], [24], [-1], [12, 60], ['12'], [null]]) SimClock.setTime(...args);
  for (const n of [NaN, Infinity, '60']) SimClock.nudgeMinutes(n);
  for (const n of [NaN, Infinity, 0, -2, '60', 1000000]) SimClock.setSpeed(n);
  for (const n of [NaN, 7, -1, '6']) SimClock.setDayOfWeek(n);
  assert.equal(SimClock.simDate.getTime(), before);
  assert.ok(Number.isFinite(SimClock.speed));
});

test('tarifa usa São Paulo mesmo quando o servidor está em UTC; faixas respeitam limites', () => {
  const output = execFileSync(process.execPath, ['-e', `const tariff=require('./js/sim/tariff.js'); console.log(JSON.stringify([
    '2026-10-14T19:59:00Z','2026-10-14T20:00:00Z','2026-10-14T21:00:00Z','2026-10-15T00:00:00Z','2026-10-15T01:00:00Z','2026-10-17T22:00:00Z'
  ].map(d=>tariff.getPosto(new Date(d)))));`], { cwd: new URL('../../', import.meta.url), env: { ...process.env, TZ: 'UTC' } }).toString();
  assert.deepEqual(JSON.parse(output), ['fora', 'inter', 'ponta', 'inter', 'fora', 'fora']);
});

test('todos os oito carros nas quatro estações têm estimativas coerentes em diferentes baterias', () => {
  reset();
  for (const vehicle of vehicles) for (const stationId of [1, 2, 3, 4]) for (const batteryLevel of [8, 33, 62]) {
    const estimate = SimEngine.estimate({ stationId, vehicleId: vehicle.id, batteryLevel, targetSoc: .8 });
    assert.ok(estimate && estimate.estimatedMinutes > 0);
    assert.ok(Number.isFinite(estimate.estimatedCost));
    const expected = (.8 - batteryLevel / 100) * vehicle.batteryCapacity / .93;
    assert.ok(Math.abs(estimate.estimatedEnergy - expected) < 1e-8);
  }
});
