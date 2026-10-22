import { dayKey } from './totem-history.js';

const round = value => Math.round(value * 100) / 100;
export function managementInsights(context, snapshot = {}) {
  const { start, end } = context.period, m = context.metrics;
  const daily = new Map(), hours = new Map(), seen = new Set();
  for (const row of snapshot.operations?.sessionHistory || []) {
    if (row.ambient || seen.has(row.id) || !Number.isFinite(Date.parse(row.finishedAt))) continue;
    seen.add(row.id);
    const date = dayKey(row.finishedAt);
    if (date < start || date > end) continue;
    const bucket = daily.get(date) || { date, sessions: 0, energyKWh: 0 };
    bucket.sessions++; bucket.energyKWh += Number.isFinite(row.energyGridKWh) ? Math.max(0, row.energyGridKWh) : 0; daily.set(date, bucket);
    if (Number.isFinite(Date.parse(row.startedAt))) {
      const hour = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(row.startedAt));
      hours.set(hour, (hours.get(hour) || 0) + 1);
    }
  }
  const days = [];
  for (let day = new Date(start + 'T12:00:00Z'); day.toISOString().slice(0,10) <= end; day.setUTCDate(day.getUTCDate()+1)) {
    const date = day.toISOString().slice(0,10), row = daily.get(date) || {date,sessions:0,energyKWh:0};
    days.push({...row, energyKWh:round(row.energyKWh)});
  }
  const busiest = [...hours].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  const tips = [];
  const tip = (id,title,basis,action,limits,factIds) => tips.push({id,title,basis,action,limits,factIds});
  if (m.interrupted > 0) tip('early-endings','Entenda os encerramentos antes da meta',
    `${m.interrupted} de ${m.sessions} recargas encerraram antes da meta de bateria.`,
    'Registre o motivo do encerramento e peça um retorno breve ao cliente. Use esse registro para decidir se é preciso melhorar a orientação no totem.',
    'Os dados não indicam a causa. Não é possível atribuir o encerramento a defeito, preço ou falta de potência.', ['interrupted','sessions']);
  if (m.suspendedMinutes > 0) tip('pauses','Acompanhe quando ocorrem as pausas',
    `As recargas encerradas acumularam ${round(m.suspendedMinutes)} minutos simulados em pausa.`,
    'Compare os horários de pausa com o consumo do estabelecimento e planeje uma observação da operação nesses horários.',
    'Pausas são simuladas. Esse dado sozinho não justifica aumentar a demanda contratada ou comprar equipamentos.', ['suspension']);
  if (busiest && m.sessions >= 3 && busiest[1] >= 2) tip('busy-window','Prepare a orientação no horário mais movimentado',
    `${busiest[1]} das recargas encerradas começaram na faixa das ${busiest[0]}h.`,
    'Deixe as instruções de uso visíveis e confira se há apoio ao cliente nessa faixa. Observe mais dias antes de mudar a escala de atendimento.',
    'A contagem inclui apenas sessões encerradas; não mede fila, ocupação de toda a hora ou clientes que desistiram.', ['busy-hour','sessions']);
  if (m.unknownTargets > 0) tip('complete-records','Complete os registros de bateria',
    `${m.unknownTargets} registros não têm bateria e meta válidas para comparação.`,
    'Padronize o registro da bateria de chegada e da meta para comparar a conclusão dos atendimentos.',
    'Registros incompletos não devem ser contados como sucesso ou falha.', ['completed-target']);
  if (m.sessions > 0) tip('reconcile','Confira separadamente os pagamentos recebidos',
    'O relatório apresenta valores calculados pelas recargas do simulador.',
    'Compare o extrato dos provedores de pagamento com os pedidos atendidos antes de usar esses valores como faturamento.',
    'O custo estimado da energia não é a cobrança fixa de R$1 nem comprovação de receita ou lucro.', ['cost','sessions']);
  if (!m.semsRecords) tip('sems-data','Atualize a base GoodWe do período',
    'Não há registros SEMS+ importados com encerramento neste período.',
    'Confira a data da última importação e atualize os registros do portal, mantendo-os separados dos dados simulados.',
    'Ausência de importação não significa ausência de consumo, geração solar ou uso do equipamento.', ['sems']);
  if (!m.sessions) tip('collect-history','Forme uma base antes de avaliar o atendimento',
    'Não há recargas encerradas no período selecionado.',
    'Acompanhe os próximos atendimentos ou selecione um período com registros para comparar o uso ao longo dos dias.',
    'Sem registros, não é possível concluir que há pouca procura, falha de atendimento ou necessidade de investimento.', ['sessions']);
  return { tips, chart:'energy', charts: {
    energy:{title:'Energia por dia',unit:'kWh estimados',description:'Energia das sessões encerradas em cada dia. Dados simulados; não inclui a importação GoodWe.',
      items:days.map(d=>({label:d.date,value:d.energyKWh}))},
    completion:{title:'Como terminaram as recargas',unit:'recargas',description:'Bateria simulada comparada à meta. Encerrar antes da meta não identifica o motivo.',
      items:[{label:'Meta atingida',value:m.completedTarget},{label:'Antes da meta',value:m.interrupted},{label:'Sem informação',value:m.unknownTargets}]},
    hours:{title:'Horários de início',unit:'inícios registrados',description:'Horário de início das sessões já encerradas. Não representa fila ou demanda não atendida.',
      items:[...hours].sort((a,b)=>a[0].localeCompare(b[0])).map(([hour,value])=>({label:hour+'h',value}))}
  }};
}

export function selectManagementTips(management, selection) {
  return { ...management, chart:selection?.chart || 'energy',
    tips:selection ? selection.tipIds.map(id=>management.tips.find(t=>t.id===id)).filter(Boolean) : management.tips.slice(0,3) };
}
