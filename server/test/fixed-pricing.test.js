import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Pricing from '../sim/smart-pricing.js';
import Engine, { SimClock, SiteModel, DemandController } from '../sim/engine.js';
const { vehicles } = createRequire(import.meta.url)('../../data/mock-data.js');

test('sem sessões a base usa a faixa; solar e restrição não alteram preço', () => {
  Engine.boot({ambient:0}); SimClock.stop(); SiteModel.init();
  const original = Pricing.posto;
  try {
    for (const [posto, expected] of [['fora',2],['inter',2.1],['ponta',2.24]]) {
      Pricing.posto = () => posto;
      for (let i=0;i<100;i++) {
        SiteModel.solarKW=i; SiteModel.baseLoadKW=100-i;
        DemandController.state=i%2?'LIMITANDO':'NORMAL';
        assert.equal(Pricing.currentPrice(),expected);
      }
    }
  } finally { Pricing.posto=original; SiteModel.init(); DemandController.init(); }
});

test('entrada de carros eleva o patamar em R$0,10 e preserva contratos anteriores', () => {
  Engine.boot({ambient:0});SimClock.stop();SiteModel.init();
  const original=Pricing.posto;
  try {
    Pricing.posto=()=> 'fora';
    const sessions=[];
    for(const [stationId,expected]of [[1,2],[2,2.1],[3,2.2],[4,2.3]]){
      const quote=Engine.estimate({stationId,vehicleId:vehicles[0].id,batteryLevel:20});
      assert.equal(quote.rate,expected); // Cotação não eleva o preço sozinha.
      if(sessions.length)assert.equal(Pricing.currentPrice(),sessions.at(-1).lockedRate);
      const session=Engine.startUserSession({stationId,vehicle:vehicles[0],startSoc:.2});sessions.push(session);
      assert.equal(session.lockedRate,expected);assert.equal(Engine.snapshot().price,expected);
      assert.equal(Engine.startUserSession({stationId,vehicle:vehicles[0],startSoc:.2}),null);
      assert.equal(Pricing.currentPrice(),expected);
    }
    for(let i=0;i<100;i++){
      SiteModel.solarKW=i;SiteModel.baseLoadKW=100-i;DemandController.state=i%2?'LIMITANDO':'NORMAL';
      Pricing.posto=()=>i%2?'fora':'ponta';assert.equal(Pricing.recompute(),2.3);assert.equal(Engine.snapshot().price,2.3);
    }
    for(const session of sessions){
      session.step(60,3,99,'ponta');
      assert.ok(Math.abs(session.cost-session.energyGridKWh*session.lockedRate)<1e-10);
    }
  } finally {Pricing.posto=original;SiteModel.init();DemandController.init();}
});

test('saídas e reposição de vaga não reduzem o patamar; só esvaziar todos os pontos o reinicia', () => {
  Engine.boot({ambient:0});SimClock.stop();SiteModel.init();
  const original=Pricing.posto;
  try {
    Pricing.posto=()=> 'fora';
    const a=Engine.startUserSession({stationId:1,vehicle:vehicles[0],startSoc:.2});
    const b=Engine.startUserSession({stationId:2,vehicle:vehicles[0],startSoc:.2});
    const c=Engine.startUserSession({stationId:3,vehicle:vehicles[0],startSoc:.2});
    Engine.stopUserSession('Local',c.id);assert.equal(Engine.snapshot().price,2.2);
    Engine.stopUserSession('Local',b.id);assert.equal(Engine.snapshot().price,2.2);
    const replacement=Engine.startUserSession({stationId:2,vehicle:vehicles[0],startSoc:.2});
    assert.equal(replacement.lockedRate,2.2);assert.equal(Engine.snapshot().price,2.2);
    Engine.stopUserSession('Local',replacement.id);assert.equal(Engine.snapshot().price,2.2);
    a.finish();assert.equal(Pricing.currentPrice(),2.2); // Resumo ainda ocupa estação1.
    Engine.stopUserSession('Local',a.id);assert.equal(Engine.snapshot().price,2);
    assert.equal(Engine.startUserSession({stationId:2,vehicle:vehicles[0],startSoc:.2}).lockedRate,2);
  } finally {Pricing.posto=original;SiteModel.init();}
});

test('sessão preserva preço aceito e nova faixa só aumenta o patamar na entrada seguinte', () => {
  Engine.boot({ambient:0});SimClock.stop();SiteModel.init();
  const original = Pricing.posto;
  try {
    Pricing.posto=()=> 'fora';
    const first=Engine.startUserSession({stationId:2,vehicle:vehicles[0],startSoc:.2});
    assert.equal(first.lockedRate,2);
    Pricing.posto=()=> 'ponta';
    for(let i=0;i<50;i++)assert.equal(Pricing.recompute(),2);
    const second=Engine.startUserSession({stationId:3,vehicle:vehicles[0],startSoc:.2});
    assert.equal(second.lockedRate,2.34);assert.equal(Pricing.currentPrice(),2.34);
    Pricing.posto=()=> 'fora';assert.equal(Pricing.recompute(),2.34);
    const third=Engine.startUserSession({stationId:4,vehicle:vehicles[0],startSoc:.2});
    assert.equal(third.lockedRate,2.44);assert.equal(Pricing.currentPrice(),2.44);
    first.step(60,3,2.24,'ponta');
    assert.ok(Math.abs(first.cost-first.energyGridKWh*2)<1e-10);
    assert.equal(Engine.snapshot().sessions.find(s=>s.id===first.id).lockedRate,2);
  } finally {Pricing.posto=original;SiteModel.init();}
});

test('carros pausados continuam contando para a tarifa e o gráfico explica o patamar mantido', () => {
  Engine.boot({ambient:0});SimClock.stop();SiteModel.init();const original=Pricing.posto;
  try {
    Pricing.posto=()=> 'fora';
    const a=Engine.startUserSession({stationId:2,vehicle:vehicles[0],startSoc:.2});a.step(1,0,2,'fora');
    assert.equal(a.status,'suspended');
    Engine.startUserSession({stationId:3,vehicle:vehicles[0],startSoc:.2});
    const rows=Engine.snapshot().priceBreakdown;
    assert.equal(rows.find(r=>r.kind==='total').value,2.1);
    assert.match(rows.find(r=>r.label.includes('Ocupação')).label,/2 veículo/);
  } finally {Pricing.posto=original;SiteModel.init();}
});
