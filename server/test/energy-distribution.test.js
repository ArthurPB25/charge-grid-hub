import test from 'node:test';
import assert from 'node:assert/strict';
import SimEngine, { SimClock, SiteModel, DemandController } from '../sim/engine.js';

const vehicle = { id: 'energy-test', brand: 'Teste', model: 'AC', batteryCapacity: 60, maxChargePower: { ac: 7.36, dc: 50 } };
function setup(budget = 10) {
  SimEngine.boot({ ambient: 0 });
  SimClock.stop();
  SiteModel.init();
  SiteModel.baseLoadKW = SiteModel.limitKW() - budget;
  SiteModel.solarKW = 0;
  DemandController.init();
}
function start(stationId, options = {}) {
  return SimEngine.startUserSession({ stationId, vehicle, startSoc: .2, targetSoc: .8, ...options });
}
function safe() {
  const allocation = DemandController.snapshot().allocation;
  assert.ok(allocation.allocatedKW <= DemandController.headroomForEvKW() + 1e-8);
  assert.ok(SiteModel.totalMeterKW() <= SiteModel.limitKW() + 1e-8);
  return allocation;
}

test('chegada divide a potência imediatamente; encerramento devolve a potência sem cobrar energia extra', () => {
  setup();
  const first = start(1);
  assert.equal(first.powerKW, 7.36);
  const second = start(2);
  assert.ok(first.powerKW < 7.36);
  assert.equal(first.powerKW, second.powerKW);
  safe();
  const energy = second.energyGridKWh;
  SimEngine.stopUserSession('Local', first.id);
  assert.equal(second.powerKW, 7.36);
  assert.equal(second.energyGridKWh, energy);
  assert.equal(first.evse.commandedA, 0);
  safe();
});

test('redução de apenas 1 A e pico de consumo não aguardam histerese', () => {
  setup(7.36);
  const session = start(1);
  SiteModel.baseLoadKW += .23;
  SimEngine.rebalance();
  assert.equal(session.evse.commandedA, 31);
  SiteModel.baseLoadKW += .23;
  // Caminho normal de tick, sem immediate.
  const allocation = DemandController.allocate();
  assert.equal(session.evse.commandedA, 30);
  session.step(0, allocation.get(session), 1, 'fora-ponta');
  safe();
});

test('pausa quando não cabe a corrente mínima e retoma após liberar capacidade', () => {
  setup(1);
  const session = start(1);
  assert.equal(session.status, 'suspended');
  assert.equal(DemandController.state, 'SUSPENSO');
  assert.equal(session.powerKW, 0);
  SiteModel.baseLoadKW -= 8;
  SimEngine.rebalance();
  assert.equal(session.status, 'charging');
  assert.equal(session.powerKW, 7.36);
  safe();
});

test('respeita o limite do carro e repassa a sobra às outras recargas', () => {
  setup(10);
  const small = start(1, { vehicle: { ...vehicle, maxChargePower: { ac: 2, dc: 50 } } });
  const other = start(2);
  assert.equal(small.powerKW, 2);
  assert.equal(other.powerKW, 7.36);
  safe();
});

test('quatro estações repartem orçamento; falta de potência suspende parte delas', () => {
  setup(10);
  for (let id = 1; id <= 4; id++) start(id);
  assert.equal(safe().stations.filter(s => s.status === 'limited').length, 4);
  SiteModel.baseLoadKW = SiteModel.limitKW() - 3;
  SimEngine.rebalance();
  const allocation = safe();
  assert.equal(allocation.stations.filter(s => s.status === 'paused').length, 2);
  assert.equal(allocation.stations.filter(s => s.allocatedKW > 0).length, 2);
});

test('excedente solar alimenta os carros antes de importar energia da rede', () => {
  setup();
  SiteModel.baseLoadKW = 20;
  SiteModel.solarKW = 30;
  DemandController.init();
  start(1);
  assert.equal(SiteModel.totalMeterKW(), 0);
  start(2);
  assert.ok(Math.abs(SiteModel.totalMeterKW() - 4.72) < 1e-8);
  assert.equal(DemandController.headroomForEvKW(), SiteModel.limitKW() + 10);
  safe();
});

test('conclusão automática redistribui no mesmo tick e mantém a estação concluída sem potência', () => {
  setup(10);
  const first = start(1, { targetSoc: .2006 });
  const other = start(2);
  // Mantém a curva controlada para testar a conclusão, sem amostragem horária.
  const originalStep = SiteModel.step;
  SiteModel.step = () => {};
  try { SimEngine._tick(15, SimClock.simDate); }
  finally { SiteModel.step = originalStep; }
  assert.equal(first.status, 'finished');
  assert.equal(first.evse.status, 'Finishing');
  assert.equal(first.evse.commandedA, 0);
  assert.equal(other.powerKW, 7.36);
  assert.equal(safe().stations[0].allocatedKW, 0);
});
