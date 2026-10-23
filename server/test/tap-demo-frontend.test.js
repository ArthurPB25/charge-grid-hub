import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../js/tap-demo.js', import.meta.url), 'utf8');
function setup() {
  const messages = [], store = new Map(), timers = [];
  const steps = [];
  const context = { window: { App: { returnToStations: msg => messages.push(msg), showScreen() {}, showPaymentStep: step => steps.push(step) }, SimClient: { send() {} } },
    localStorage: { removeItem: k => store.delete(k), setItem: (k,v) => store.set(k,v) }, document: { getElementById: () => ({ textContent: '' }) }, location: {origin:'https://example.com',hostname:'example.com'}, clearTimeout() {}, setTimeout(fn) { timers.push(fn); }, AbortSignal };
  vm.runInNewContext(source, context);
  const client = context.window.TapDemo; client.order = { id: 'order', token: 'secret' };
  return { client, messages, timers, context, steps, store };
}

test('InfiniteTap totem: pagamento avança à confirmação sem conectar; cliente conecta uma vez', async () => {
  const {client, messages, steps, store} = setup(), calls = [];
  client.request = async path => { calls.push(path); return {id:'order',state:path.endsWith('/connect')?'released':'paid',stationId:2,vehicle:'Carro'}; };
  await client.poll();
  assert.equal(steps.at(-1),'tap-confirmed'); assert.equal(messages.length,0);
  assert.equal(calls.length,1); assert.equal(client.order.token,'secret');
  assert.equal(JSON.parse(store.get('chargegrid-tap-order')).state,'paid');
  await Promise.all([client.connect(),client.connect()]);
  assert.equal(calls.filter(path=>path.endsWith('/connect')).length,1);
  assert.equal(client.order,null); assert.equal(messages.length,1);
});
test('InfiniteTap totem: liberação volta às estações e elimina o pedido pendente', async () => {
  const { client, messages } = setup(); client.request = async () => ({ state: 'released' });
  await client.poll(); assert.equal(client.order, null); assert.equal(messages.length, 1); assert.match(messages[0], /Recarga iniciada/);
});
test('InfiniteTap totem: consulta atrasada após cancelar não substitui o resultado atual', async () => {
  const { client, messages } = setup(); let finish;
  client.request = () => new Promise(resolve => { finish = resolve; });
  const pending = client.poll(); client.forget(); finish({ state: 'released' }); await pending;
  assert.equal(messages.length, 0);
});
test('InfiniteTap totem: retorno não confirmado nunca exibe recarga iniciada', async () => {
  const { client, messages } = setup(); client.request = async () => ({ state: 'not-confirmed', message: 'Pagamento não confirmado' });
  await client.poll(); assert.equal(client.order, null); assert.deepEqual(messages, ['Pagamento não confirmado']);
});

test('InfiniteTap totem: retorno incompleto mantém acompanhamento e aceita confirmação posterior', async () => {
  const {client,messages,timers,steps} = setup();
  let state = 'review';
  client.request = async () => ({state, message:'InfinitePay: falha na leitura', stationId:2,vehicle:'Carro'});
  await client.poll();
  assert.equal(client.order.state,'review'); assert.equal(messages.length,0); assert.equal(timers.length,1);
  assert.equal(steps.at(-1),'tap');
  state='paid'; await client.poll();
  assert.equal(client.order.state,'paid'); assert.equal(steps.at(-1),'tap-confirmed'); assert.equal(messages.length,0);
});

test('InfiniteTap totem: 404 após reinício encerra acompanhamento e orienta conferir pagamento', async () => {
  const { client, messages, timers } = setup();
  client.request = async () => { throw Object.assign(new Error('Pedido inexistente'), { status: 404 }); };
  await client.poll();
  assert.equal(client.order, null); assert.equal(timers.length, 0);
  assert.match(messages[0], /não cancela nem estorna/); assert.match(messages[0], /InfinitePay/);
});

test('InfiniteTap totem: cancelar pedido inexistente permite sair sem prometer estorno', async () => {
  const { client, messages } = setup();
  client.request = async () => { throw Object.assign(new Error('Pedido inexistente'), { status: 404 }); };
  await client.cancel(); assert.equal(client.order, null); assert.equal(messages.length, 1);
  assert.match(messages[0], /não cancela nem estorna/);
});

test('InfiniteTap totem: falha transitória conserva pedido e reconsulta; cancelar não rejeita sem tratamento', async () => {
  const { client, messages, timers } = setup();
  client.request = async () => { throw Object.assign(new Error('Servidor indisponível'), { status: 503 }); };
  await client.poll(); await client.cancel();
  assert.equal(client.order.id, 'order'); assert.equal(timers.length, 1); assert.equal(messages.length, 0);
});

test('InfiniteTap totem: erro atrasado de pedido anterior não remove o atual', async () => {
  for (const action of ['poll', 'cancel']) {
    const { client, messages } = setup(); let fail;
    client.request = () => new Promise((resolve, reject) => { fail = reject; });
    const pending = client[action](); client.forget(); client.order = { id: 'new', token: 'new-token' };
    fail(Object.assign(new Error('Pedido inexistente'), { status: 404 })); await pending;
    assert.equal(client.order.id, 'new'); assert.equal(messages.length, 0);
  }
});

test('InfiniteTap totem: request preserva status HTTP para distinguir pedido perdido de queda de rede', async () => {
  const { client, context } = setup();
  context.fetch = async () => ({ ok: false, status: 404, json: async () => ({ erro: 'Pedido inexistente' }) });
  await assert.rejects(client.request('/orders/missing'), e => e.status === 404 && e.message === 'Pedido inexistente');
});

test('InfiniteTap físico preserva pedido pago enquanto houver desligamento pendente e permite nova sessão depois', async () => {
  const {client,context,messages}=setup();let calls=0,ready=false;
  client.order={id:'paid',token:'secret',stationId:1,state:'paid'};
  const session={id:'session',status:'charging',evse:{stationId:1,commandedA:16}};
  Object.assign(context.window.SimClient,{connected:true,snapshot:{sessions:[session]},watchTapOrder:async()=>{},waitForTapSession:async()=>session});
  context.window.MqttBridge={ativar(){},prontoParaIniciarCarga:()=>ready,prepararNovaRecarga:()=>ready,iniciarCargaPaga:async permitted=>assert.equal(permitted(),true)};
  client.request=async()=>{calls++;return {state:'released',sessionId:session.id,physical:{active:true,command:'LIGAR'}};};
  await client.connect();assert.equal(calls,0);assert.equal(client.order.state,'paid');assert.equal(messages.length,0);
  ready=true;await client.connect();assert.equal(calls,1);assert.equal(client.order,null);assert.equal(messages.length,1);
});

test('InfiniteTap físico: ausência de potência conserva Conectar e nunca publica LIGAR', async () => {
  const {client,context,messages}=setup();let publishes=0;
  const session={id:'session',status:'suspended',evse:{stationId:1,commandedA:0}};
  client.order={id:'paid',token:'secret',stationId:1,state:'paid'};
  Object.assign(context.window.SimClient,{connected:true,snapshot:{sessions:[session]},watchTapOrder:async()=>{},waitForTapSession:async()=>session});
  context.window.MqttBridge={ativar(){},prontoParaIniciarCarga:()=>true,prepararNovaRecarga:()=>true,iniciarCargaPaga:async()=>{publishes++;}};
  client.request=async()=>({state:'released',sessionId:session.id,physical:{active:true,command:'DESLIGAR'}});
  await client.connect();assert.equal(publishes,0);assert.equal(messages.length,0);assert.equal(client.order.state,'released');
});

test('InfiniteTap físico: cancelamento enquanto aguarda vínculo impede envio atrasado ao backend', async () => {
  const {client,context,messages}=setup();let finish,calls=0;
  client.order={id:'paid',token:'secret',stationId:1,state:'paid'};
  context.window.MqttBridge={ativar(){},prontoParaIniciarCarga:()=>true,prepararNovaRecarga:()=>true};
  context.window.SimClient.watchTapOrder=()=>new Promise(resolve=>{finish=resolve;});
  client.request=async()=>{calls++;};
  const pending=client.connect();client.forget();finish();await pending;
  assert.equal(calls,0);assert.equal(messages.length,0);
});

test('InfiniteTap físico: restaurar sessão liberada conserva recuperação sem religar automaticamente', async () => {
  const {client,steps,store,messages}=setup();
  client.order={id:'paid',token:'secret',stationId:1,state:'released',sessionId:'session'};
  client.request=async()=>({...client.order});
  await client.poll();assert.equal(client.order.state,'released');assert.equal(steps.at(-1),'tap-confirmed');
  assert.equal(JSON.parse(store.get('chargegrid-tap-order')).token,'secret');assert.equal(messages.length,0);
});

test('InfiniteTap físico: consulta iniciada antes de Conectar não descarta pedido durante envio', async () => {
  const {client,messages}=setup();let finish;
  client.order={id:'paid',token:'secret',stationId:1,state:'paid'};
  client.request=()=>new Promise(resolve=>{finish=resolve;});
  const polling=client.poll();client.connecting=true;finish({state:'released'});await polling;
  assert.equal(client.order.state,'paid');assert.equal(messages.length,0);
});

test('vínculo do totem: aguarda resposta correspondente, rejeita queda e remove esperas', async () => {
  const window={},sent=[],timers=new Set();
  vm.runInNewContext(fs.readFileSync(new URL('../../js/sim-client.js',import.meta.url),'utf8'),{
    window,console,WebSocket:{OPEN:1},setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn)
  });
  const sim=window.SimClient;sim.connected=true;
  sim.ws={readyState:1,send:raw=>sent.push(JSON.parse(raw))};
  let done=false;const waiting=sim.watchTapOrder('paid','secret').then(()=>{done=true;});
  sim._onMessage({type:'tap-demo:watched',data:{id:'other',requestId:sent[0].payload.requestId}});
  await Promise.resolve();assert.equal(done,false);
  sim._onMessage({type:'tap-demo:watched',data:{id:'paid',requestId:sent[0].payload.requestId}});
  await waiting;assert.equal(sim._tapWatchRequests.size,0);assert.equal(timers.size,0);
  const interrupted=sim.watchTapOrder('paid','secret');sim._connectionChanged(false);
  await assert.rejects(interrupted,/desconectado/);assert.equal(timers.size,0);assert.equal(sim._tapWatchRequests.size,0);
  sim.connected=true;const expired=sim.watchTapOrder('paid','secret');[...timers][0]();
  await assert.rejects(expired,/não confirmou/);assert.equal(timers.size,0);assert.equal(sim._tapWatchRequests.size,0);
});

test('consulta do pagamento continua funcionando durante a criação inicial do pedido', async () => {
  const {client,steps}=setup();client.busy=true;
  client.request=async()=>({state:'paid',stationId:2,vehicle:'Carro'});
  await client.poll();assert.equal(client.order.state,'paid');assert.equal(steps.at(-1),'tap-confirmed');
});

test('queda de MQTT durante vínculo do totem não cria sessão nem perde pagamento', async () => {
  const {client,context}=setup();let ready=true,calls=0;
  client.order={id:'paid',token:'secret',stationId:1,state:'paid'};
  context.window.MqttBridge={ativar(){},prontoParaIniciarCarga:()=>ready,prepararNovaRecarga:()=>true};
  context.window.SimClient.watchTapOrder=async()=>{ready=false;};
  client.request=async()=>{calls++;};await client.connect();
  assert.equal(calls,0);assert.equal(client.order.state,'paid');
});
