window.OperationalReports = {
  report: null,
  init(section) {
    this.section = section;
    section.innerHTML = `
      <div class="card-panel report-intro">
        <div class="report-eyebrow"><span class="material-symbols-outlined" aria-hidden="true">insights</span> ANÁLISE DA OPERAÇÃO</div>
        <h2>Entenda os dados da operação.</h2>
        <p>Recargas, energia, valores calculados e situação das estações, com as fontes de cada informação.</p>
        <div class="report-controls">
          <label for="report-period">Período<select id="report-period"><option value="today">Hoje</option><option value="week" selected>Últimos 7 dias</option><option value="month">Últimos 30 dias</option></select></label>
          <button class="report-generate" id="report-generate">Gerar relatório</button>
          <button class="btn-outline" id="report-download" hidden>Baixar PDF</button>
        </div>
        <p id="report-provider" class="report-muted">Verificando conexão com o assistente…</p>
        <p id="report-status" role="status" aria-live="polite"></p>
      </div>
      <div id="report-result" aria-busy="false">
        <div class="card-panel report-empty"><span class="material-symbols-outlined" aria-hidden="true">assignment</span><h3>Seu relatório começa pelos dados</h3><p>Escolha o período para consultar a análise dos registros e baixar o PDF.</p></div>
      </div>`;
    section.querySelector('#report-generate').addEventListener('click', () => this.generate());
    section.querySelector('#report-download').addEventListener('click', () => this.download());
    this.checkProvider();
  },
  async checkProvider() {
    const label = this.section.querySelector('#report-provider');
    try {
      const response = await fetch(`${window.ChargeGridConfig.apiOrigin}/api/reports/status`);
      if (!response.ok) throw new Error();
      const status = await response.json();
      label.textContent = status.ready ? `Ollama (${status.model}) organiza os dados · análise calculada pelo sistema · sem cobrança de API.` :
        status.reason === 'missing-model' ? `O modelo ${status.model} ainda não foi baixado no computador do servidor. Você pode gerar uma análise por regras.` :
        status.reason === 'disabled' ? 'IA local desativada · análise por regras disponível.' :
        status.reason === 'invalid-config' ? 'Configure um modelo local do Ollama. Análise por regras disponível.' :
        'Ollama desconectado · abra o Ollama no computador do servidor. Análise por regras disponível.';
    } catch { label.textContent = 'Não foi possível verificar a configuração. Confira a conexão com o servidor.'; }
  },
  async generate() {
    if (this.loading) return;
    const button = this.section.querySelector('#report-generate');
    const period = this.section.querySelector('#report-period');
    const status = this.section.querySelector('#report-status');
    const result = this.section.querySelector('#report-result');
    this.loading = true;
    this.report = null;
    this.section.querySelector('#report-download').hidden = true;
    result.replaceChildren(this.node('p', 'Preparando a análise do período selecionado…'));
    button.disabled = period.disabled = true;
    button.textContent = 'Preparando relatório…';
    status.textContent = 'Calculando os indicadores e organizando os dados. A IA local pode levar até um minuto.';
    result.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`${window.ChargeGridConfig.apiOrigin}/api/reports/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: period.value }), signal: AbortSignal.timeout(70000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.erro || 'Falha ao gerar o relatório.');
      this.report = data;
      this.render(data);
      this.section.querySelector('#report-download').hidden = false;
      status.textContent = data.cached ? 'Dados atualizados. A organização dos indicadores foi reutilizada da última geração.' : 'Relatório pronto. Confira a análise e os dados utilizados abaixo.';
    } catch (err) {
      status.textContent = err.name === 'TimeoutError' ? 'O relatório demorou mais que o esperado. Tente novamente.' : err.message || 'Não foi possível gerar o relatório. Tente novamente.';
    } finally {
      this.loading = false;
      button.disabled = period.disabled = false;
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
    meta.append(this.node('span', report.mode === 'ai' ? 'Análise do sistema · dados organizados com IA local' : 'Análise do sistema · organização padrão', 'report-mode'));
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
