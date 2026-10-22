import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {once} from 'node:events';
import {CloudAdvisor,validateAdvice} from '../cloud-advisor.js';
import {buildReportContext,attachReportRoutes} from '../operational-reports.js';
import {managementInsights} from '../management-insights.js';
const start=new Date('2026-10-22T15:00:00Z'), access='administrative-test-access', key='fake-provider-key-no-real-requests';
const config={AI_PROVIDER:'ollama-cloud',OLLAMA_API_KEY:key,AI_ADMIN_KEY:access};
const snapshot=()=>({operations:{sessionHistory:[{id:'private-order-id',startedAt:'2026-10-22T12:00:00Z',finishedAt:'2026-10-22T13:00:00Z',energyGridKWh:5,cost:8,soc:.5,socTarget:.8,suspendedFor:60,payer_email:'private@example.com',nsu:'private-payment-nsu'}]}});
const input=()=>{const state=snapshot(),context=buildReportContext(state,'week',start);return [context,managementInsights(context,state)];};
const ok=()=>({ok:true,json:async()=>({done:true,message:{content:JSON.stringify({tipIds:['early-endings','pauses'],chart:'completion'})}})});

test('Cloud: consultar estado ou gerar dados não faz inferência; acesso inválido também não',async()=>{
  let calls=0;const advisor=new CloudAdvisor({config,fetchImpl:async()=>{calls++;return ok();},now:()=>start});
  assert.equal(advisor.status().ready,true);
  await advisor.select(...input());
  await assert.rejects(advisor.select(...input(),{requested:true,accessKey:'wrong'}),{code:'unauthorized'});
  assert.equal(calls,0);
});

test('Cloud: uma chamada curta com indicadores agregados; reaproveita sem repetir nem enviar dados privados',async()=>{
  let calls=0;
  const advisor=new CloudAdvisor({config,now:()=>start,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://ollama.com/api/chat');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+key);
    const body=JSON.parse(options.body);assert.equal(body.format,undefined);assert.equal(body.options.num_predict,180);assert.equal(body.think,false);
    for(const privateValue of ['private-order-id','private@example.com','private-payment-nsu'])assert.ok(!options.body.includes(privateValue));
    return ok();
  }});
  const first=await advisor.select(...input(),{requested:true,accessKey:access});assert.equal(first.cached,false);
  for(let i=0;i<8;i++)assert.equal((await advisor.select(...input(),{requested:true,accessKey:access})).cached,true);
  assert.equal((await advisor.select(...input())).cached,true);
  assert.equal(calls,1);assert.equal(advisor.status().usage.callsToday,1);
});

test('Cloud: limite persiste após reinício e entrada inválida não permite nova chamada',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cg-budget-')), file=path.join(folder,'usage.json');
  t.after(()=>{for(const name of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,name));fs.rmdirSync(folder);});
  let date=start,calls=0;
  const options={config:{...config,AI_DAILY_CALL_LIMIT:1},file,now:()=>date,fetchImpl:async()=>{calls++;return ok();}};
  await new CloudAdvisor(options).select(...input(),{requested:true,accessKey:access});
  await assert.rejects(new CloudAdvisor(options).select(...input(),{requested:true,accessKey:access}),{code:'daily-limit'});assert.equal(calls,1);
  date=new Date(start.getTime()+86400000);
  await new CloudAdvisor(options).select(...input(),{requested:true,accessKey:access});assert.equal(calls,2);
  fs.writeFileSync(file,'null');const broken=new CloudAdvisor(options);assert.equal(broken.status().reason,'usage-storage');
  assert.equal((await broken.select(...input())).selection,null);
  await assert.rejects(broken.select(...input(),{requested:true,accessKey:access}),{code:'usage-storage'});assert.equal(calls,2);
});

test('Cloud: erro ou cota esgotada não provoca repetição automática e também conta como tentativa',async()=>{
  for(const response of [{ok:false,status:429},{ok:false,status:401},{ok:true,json:async()=>({done:true,message:{content:'texto inválido'}})}]){
    let calls=0;const advisor=new CloudAdvisor({config,now:()=>start,fetchImpl:async()=>{calls++;return response;}});
    await assert.rejects(advisor.select(...input(),{requested:true,accessKey:access}));
    await assert.rejects(advisor.select(...input(),{requested:true,accessKey:access}),{code:'cooldown'});
    assert.equal(calls,1);assert.equal(advisor.status().usage.callsToday,1);
  }
});

test('Cloud: bloqueia dicas inventadas, duplicadas, texto livre e gráfico fora do catálogo',()=>{
  const [,management]=input();
  for(const value of [{tipIds:['buy-equipment'],chart:'energy'},{tipIds:['pauses','pauses'],chart:'energy'},
    {tipIds:['pauses'],chart:'profit'},{tipIds:['pauses'],chart:'energy',summary:'lucro garantido'},{tipIds:[],chart:'energy'}])
    assert.throws(()=>validateAdvice(value,management.tips));
});

test('Cloud: pedidos simultâneos não duplicam a consulta; só novos dados históricos invalidam o cache',async()=>{
  let release,calls=0;
  const advisor=new CloudAdvisor({config,now:()=>start,fetchImpl:async()=>{calls++;await new Promise(resolve=>{release=resolve;});return ok();}});
  const first=advisor.select(...input(),{requested:true,accessKey:access});
  await assert.rejects(advisor.select(...input(),{requested:true,accessKey:access}),{code:'busy'});
  release();await first;assert.equal(calls,1);
  const volatile=snapshot();volatile.site={surplusKW:99};volatile.demand={availableKW:80};
  const context=buildReportContext(volatile,'week',start);
  assert.equal((await advisor.select(context,managementInsights(context,volatile),{requested:true,accessKey:access})).cached,true);
  const changed=snapshot();changed.operations.sessionHistory[0].energyGridKWh=8;
  const updated=buildReportContext(changed,'week',start);
  assert.equal((await advisor.select(updated,managementInsights(updated,changed))).selection,null);
  assert.equal(calls,1);
});

test('Cloud: configuração incompleta ou falha ao persistir impede requisição',async t=>{
  let calls=0;
  for(const overrides of [{OLLAMA_API_KEY:''},{AI_ADMIN_KEY:'short'},{AI_DAILY_CALL_LIMIT:0}]){
    const advisor=new CloudAdvisor({config:{...config,...overrides},now:()=>start,fetchImpl:async()=>{calls++;return ok();}});
    assert.equal(advisor.status().ready,false);
    await assert.rejects(advisor.select(...input(),{requested:true,accessKey:access}));
  }
  const file=path.join(os.tmpdir(),'cg-not-a-directory-'+process.pid+'-'+Date.now());
  fs.writeFileSync(file,'obstacle');t.after(()=>fs.unlinkSync(file));
  const advisor=new CloudAdvisor({config,file:path.join(file,'usage.json'),now:()=>start,fetchImpl:async()=>{calls++;return ok();}});
  await assert.rejects(advisor.select(...input(),{requested:true,accessKey:access}),{code:'usage-storage'});
  assert.equal(calls,0);
});

test('gráficos e dicas se apoiam no histórico; retrato ao vivo não é usado como demanda do período',()=>{
  const [context,management]=input();
  assert.equal(management.charts.energy.items.reduce((s,x)=>s+x.value,0),context.metrics.energyKWh);
  assert.equal(management.charts.completion.items.reduce((s,x)=>s+x.value,0),context.metrics.sessions);
  assert.ok(management.tips.find(t=>t.id==='early-endings').limits.includes('não indicam a causa'));
  const empty=managementInsights(buildReportContext({},'today',start),{});
  assert.ok(empty.tips.some(t=>t.id==='collect-history'));assert.ok(!empty.tips.some(t=>t.id==='busy-window'));
  const bad=snapshot();bad.operations.sessionHistory[0].energyGridKWh=Infinity;
  const badContext=buildReportContext(bad,'today',start);
  assert.equal(managementInsights(badContext,bad).charts.energy.items[0].value,0);
});

test('Cloud API: botões sem IA e PDF não gastam; uma análise autorizada usa cache e mantém controle isolado',async t=>{
  let calls=0;
  const app=express();app.use(express.json());
  attachReportRoutes(app,{engine:{snapshot},config,now:()=>start,fetchImpl:async()=>{calls++;return ok();}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const generate=(useAi,code)=>fetch(base+'/api/reports/generate',{method:'POST',headers:{'Content-Type':'application/json',...(code?{'X-Report-Key':code}:{})},body:JSON.stringify({period:'week',useAi})});
  const status=await(await fetch(base+'/api/reports/status')).json();assert.equal(status.cloud,true);assert.ok(!JSON.stringify(status).includes(key));
  const basic=await(await generate(false)).json();assert.equal(calls,0);assert.ok(basic.management.charts);
  assert.equal((await generate(true,'wrong')).status,403);assert.equal(calls,0);
  const ai=await(await generate(true,access)).json();assert.equal(ai.mode,'ai');assert.equal(ai.provider,'Ollama Cloud');assert.equal(calls,1);
  assert.deepEqual(ai.management.tips.map(t=>t.id),['early-endings','pauses']);assert.equal(ai.management.chart,'completion');
  const pdf=await fetch(base+`/api/reports/${ai.reportId}/pdf`);assert.equal(pdf.status,200);assert.equal(calls,1);
  assert.equal((await(await generate(true,access)).json()).cached,true);assert.equal(calls,1);
  assert.ok(!JSON.stringify(ai).includes(key));
});
