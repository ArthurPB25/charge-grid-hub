window.OperationalReports = {
  report: null,
  init(section) {
    this.section = section;
    section.innerHTML = `
      <div class="card-panel report-intro">
        <div class="report-eyebrow"><span class="material-symbols-outlined" aria-hidden="true">insights</span> ANÁLISE DA OPERAÇÃO</div>
        <h2>Da operação à próxima decisão.</h2>
        <p>Veja o uso ao longo dos dias, entenda os resultados das recargas e encontre ações para acompanhar no estabelecimento.</p>
        <div class="report-controls">
          <label for="report-period">Período<select id="report-period"><option value="today">Hoje</option><option value="week" selected>Últimos 7 dias</option><option value="month">Últimos 30 dias</option></select></label>
          <button class="report-generate" id="report-generate">Gerar relatório</button>
          <button class="btn-outline" id="report-ai" hidden>Priorizar dicas com IA</button>
          <button class="btn-outline" id="report-download" hidden>Baixar PDF</button>
        </div>
        <form id="report-access" class="report-access" hidden>
          <label for="report-access-code">Acesso do responsável<input id="report-access-code" type="password" minlength="16" maxlength="256" autocomplete="off" required placeholder="Código administrativo da IA"></label>
          <button class="report-generate" type="submit">Confirmar análise</button>
          <button class="btn-outline" type="button" id="report-access-cancel">Cancelar</button>
          <small>Use o código administrativo fornecido ao responsável pelo estabelecimento.</small>
        </form>
        <p id="report-provider" class="report-muted">Verificando conexão com o assistente…</p>
        <p id="report-status" role="status" aria-live="polite"></p>
      </div>
      <div id="report-result" aria-busy="false">
        <div class="card-panel report-empty"><span class="material-symbols-outlined" aria-hidden="true">assignment</span><h3>Seu relatório começa pelos dados</h3><p>Escolha o período para consultar a análise dos registros e baixar o PDF.</p></div>
      </div>`;
    section.querySelector('#report-generate').addEventListener('click', () => this.generate());
    section.querySelector('#report-ai').addEventListener('click', () => this.generate(true));
    section.querySelector('#report-access').addEventListener('submit', event=>{
      event.preventDefault();const field=section.querySelector('#report-access-code');
      this.aiAccessKey=field.value;field.value='';section.querySelector('#report-access').hidden=true;this.generate(true);
    });
    section.querySelector('#report-access-cancel').addEventListener('click',()=>{
      section.querySelector('#report-access-code').value='';section.querySelector('#report-access').hidden=true;
    });
    section.querySelector('#report-download').addEventListener('click', () => this.download());
    this.checkProvider();
  },
  async checkProvider() {
    const label = this.section.querySelector('#report-provider');
    try {
      const response = await fetch(`${window.ChargeGridConfig.apiOrigin}/api/reports/status`);
      if (!response.ok) throw new Error();
      const status = await response.json();
      this.cloudReady=Boolean(status.cloud&&status.ready);
      this.section.querySelector('#report-ai').hidden=!this.cloudReady;
      if(status.cloud) {
        label.textContent=status.ready ? `Modo econômico: IA somente sob demanda. Limite do servidor: ${status.usage.dailyLimit} análises novas por dia; ${status.usage.callsToday} tentativa(s) hoje. Consultar gráficos, repetir uma análise recente e baixar PDF não consome uma nova chamada. Esse controle não representa o saldo da conta Ollama.`
          : 'IA online aguardando ativação. Gráficos, indicadores e dicas do sistema já estão disponíveis.';
        return;
      }
      label.textContent = status.ready ? `Ollama (${status.model}) organiza os dados · análise calculada pelo sistema · sem cobrança de API.` :
        status.reason === 'missing-model' ? `O modelo ${status.model} ainda não foi baixado no computador do servidor. Você pode gerar uma análise por regras.` :
        status.reason === 'disabled' ? 'IA local desativada · análise por regras disponível.' :
        status.reason === 'invalid-config' ? 'Configure um modelo local do Ollama. Análise por regras disponível.' :
        'Ollama desconectado · abra o Ollama no computador do servidor. Análise por regras disponível.';
    } catch { label.textContent = 'Não foi possível verificar a configuração. Confira a conexão com o servidor.'; }
  },
  async generate(useAi=false) {
    if (this.loading) return;
    if(useAi && !this.aiAccessKey) {
      this.section.querySelector('#report-access').hidden=false;
      this.section.querySelector('#report-access-code').focus();return;
    }
    const button = this.section.querySelector('#report-generate');
    const period = this.section.querySelector('#report-period');
    const status = this.section.querySelector('#report-status');
    const result = this.section.querySelector('#report-result');
    const aiButton=this.section.querySelector('#report-ai');
    this.loading = true;
    this.report = null;
    this.section.querySelector('#report-download').hidden = true;
    result.replaceChildren(this.node('p', 'Preparando a análise do período selecionado…'));
    button.disabled = period.disabled = true;
    button.textContent = 'Preparando relatório…';
    aiButton.disabled=true;
    status.textContent = useAi ? 'Verificando análise recente antes de consultar a IA…' : 'Calculando indicadores, gráficos e dicas do período…';
    result.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`${window.ChargeGridConfig.apiOrigin}/api/reports/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json',...(useAi?{'X-Report-Key':this.aiAccessKey}:{}) }, body: JSON.stringify({ period: period.value,useAi }), signal: AbortSignal.timeout(70000)
      });
      const data = await response.json();
      if (!response.ok) {if(response.status===403)this.aiAccessKey=null;throw new Error(data.erro || 'Falha ao gerar o relatório.');}
      this.report = data;
      this.render(data);
      this.section.querySelector('#report-download').hidden = false;
      status.textContent = data.cached ? 'Dados atualizados. A análise recente foi reaproveitada, sem nova consulta à IA.' : 'Relatório pronto. Confira os gráficos e as dicas abaixo.';
    } catch (err) {
      status.textContent = err.name === 'TimeoutError' ? 'O relatório demorou mais que o esperado. Tente novamente.' : err.message || 'Não foi possível gerar o relatório. Tente novamente.';
      result.replaceChildren(this.node('p','O relatório não foi gerado. Confira a mensagem acima e tente novamente.'));
    } finally {
      this.loading = false;
      button.disabled = period.disabled = false;
      aiButton.disabled=false;
      button.textContent = 'Gerar relatório';
      result.setAttribute('aria-busy', 'false');
      this.checkProvider();
    }
  },
  node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  },
  evidence(parent, ids, facts) {
    const box = this.node('div', null, 'report-evidence');
    box.append(this.node('small', 'EVIDÊNCIAS'));
    for (const id of ids) {
      const fact = facts.find(f => f.id === id);
      if (fact) box.append(this.node('p', `${fact.label}: ${fact.value}`));
    }
    parent.append(box);
  },
  render(report) {
    const result = this.section.querySelector('#report-result');
    result.replaceChildren();
    const date = value => value.split('-').reverse().join('/');
    const meta = this.node('div', null, 'report-meta');
    meta.append(this.node('span', report.mode === 'ai' ? (report.provider==='Ollama Cloud'?'Prioridades selecionadas com IA':'Dados organizados com IA local') : 'Análise e dicas do sistema', 'report-mode'));
    meta.append(this.node('span', `${date(report.period.start)} a ${date(report.period.end)} · Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`));
    result.append(meta);
    if (report.warning) result.append(this.node('p', report.warning, 'report-notice'));
    const metrics = this.node('div', null, 'report-metrics');
    for (const id of ['sessions', 'energy', 'cost', 'sems']) {
      const fact = report.facts.find(f => f.id === id);
      const card = this.node('div', null, 'card-panel');
      card.append(this.node('span', fact.label), this.node('strong', fact.value), this.node('small', fact.source));
      metrics.append(card);
    }
    result.append(metrics);
    if(report.management) {
      const visual=this.node('div',null,'card-panel report-visual');
      visual.append(this.node('h2','O período em um olhar'));
      const choices=this.node('div',null,'report-chart-tabs'),chartArea=this.node('div',null,'report-chart-area');
      const showChart=key=>{
        chartArea.replaceChildren();
        for(const button of choices.children)button.setAttribute('aria-pressed',String(button.dataset.chart===key));
        const chart=report.management.charts[key];
        chartArea.append(this.node('h3',chart.title),this.node('p',chart.description,'report-muted'));
        const max=Math.max(1,...chart.items.map(item=>item.value));
        if(!chart.items.some(item=>item.value>0))chartArea.append(this.node('p','Ainda não há registros para este gráfico.','report-empty-chart'));
        else for(const item of chart.items){
          const row=this.node('div',null,'report-bar-row');
          const label=/^\d{4}-/.test(item.label)?item.label.slice(5).split('-').reverse().join('/'):item.label;
          row.append(this.node('span',label));
          const track=this.node('div',null,'report-bar-track'),bar=this.node('div',null,'report-bar-fill');
          bar.style.width=Math.max(0,Math.min(100,item.value/max*100))+'%';track.append(bar);track.setAttribute('aria-hidden','true');
          row.append(track,this.node('strong',`${item.value.toLocaleString('pt-BR',{maximumFractionDigits:1})} ${chart.unit}`));chartArea.append(row);
        }
      };
      for(const [key,chart]of Object.entries(report.management.charts)){
        const button=this.node('button',chart.title);button.type='button';button.dataset.chart=key;button.setAttribute('aria-pressed','false');
        button.addEventListener('click',()=>showChart(key));choices.append(button);
      }
      visual.append(choices,chartArea);result.append(visual);showChart(report.management.chart);
      const next=this.node('div',null,'card-panel report-next');
      next.append(this.node('h2',report.provider==='Ollama Cloud'&&report.mode==='ai'?'Dicas priorizadas pela IA':'Próximos passos para o estabelecimento'));
      if(report.analyzedAt)next.append(this.node('p',`Priorização feita em ${new Date(report.analyzedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}. Os indicadores abaixo foram recalculados agora.`,'report-muted'));
      for(const tip of report.management.tips){
        const item=this.node('article',null,'report-action');item.append(this.node('h3',tip.title));
        for(const [label,value]of [['O que os dados mostram',tip.basis],['O que você pode fazer',tip.action],['O que ainda precisa ser verificado',tip.limits]]){
          const p=this.node('p');p.append(this.node('strong',label),this.node('span',value));item.append(p);
        }
        this.evidence(item,tip.factIds,report.facts);next.append(item);
      }
      result.append(next);
    }
    const summary = this.node('div', null, 'card-panel');
    summary.append(this.node('h2', 'Análise dos registros'), this.node('p', report.summary));
    const observations = this.node('div', null, 'report-observations');
    for (const observation of report.observations) {
      const item = this.node('article');
      item.append(this.node('h3', observation.title), this.node('p', observation.analysis));
      this.evidence(item, observation.factIds, report.facts);
      observations.append(item);
    }
    summary.append(observations);
    result.append(summary);
    const sources = this.node('details', null, 'card-panel report-sources');
    sources.append(this.node('summary', 'Dados utilizados e limites da análise'));
    const list = this.node('ul');
    for (const gap of [...new Set([...report.limitations, ...report.gaps])]) list.append(this.node('li', gap));
    sources.append(list);
    for (const group of report.sections) {
      sources.append(this.node('h3', group.title));
      for (const id of group.factIds) {
        const fact = report.facts.find(f => f.id === id);
        if (!fact) continue;
        const item = this.node('p');
        item.append(this.node('strong', `${fact.label}: ${fact.value}`), this.node('small', fact.source));
        sources.append(item);
      }
    }
    result.append(sources);
  },
  async download() {
    const r = this.report;
    if (!r) return;
    if (this.downloading) return;
    const button = this.section.querySelector('#report-download');
    const status = this.section.querySelector('#report-status');
    this.downloading = true;
    button.disabled = true;
    button.textContent = 'Preparando PDF…';
    try {
      const pdfUrl = `${window.ChargeGridConfig.apiOrigin}/api/reports/${encodeURIComponent(r.reportId)}/pdf`;
      const response = await fetch(pdfUrl, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.erro || 'Não foi possível baixar o PDF.');
      }
      await response.arrayBuffer();
      const link = this.node('a');
      link.href = pdfUrl;
      link.download = `chargegrid-relatorio-${r.period.start}-${r.period.end}.pdf`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      status.textContent = 'PDF pronto. O download do relatório foi iniciado.';
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'O PDF demorou mais que o esperado. Tente baixar novamente.' : error.message;
    } finally {
      this.downloading = false;
      button.disabled = false;
      button.textContent = 'Baixar PDF';
    }
  }
};
