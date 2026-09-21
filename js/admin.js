// js/admin.js

class AdminDashboard {
  constructor() {
    this.sections = ['overview', 'stations', 'sessions', 'billing', 'energy', 'pricing'];
    this.currentSection = 'overview';
    this.mockData = window.MockData || {};
    this.logs = [];
    // Último snapshot recebido do motor (que agora roda no servidor) — todas
    // as leituras ao vivo passam a ler daqui em vez de window.SiteModel etc.
    this.snapshot = null;
    this._booted = false;

    this.init();
  }

  init() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = themeToggle?.querySelector('.material-symbols-outlined');
    const savedTheme = localStorage.getItem('chargegrid-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if(themeIcon) themeIcon.textContent = savedTheme === 'dark' ? 'light_mode' : 'dark_mode';

    if(themeToggle) {
      themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('chargegrid-theme', next);
        if(themeIcon) themeIcon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
      });
    }

    // O painel conecta no mesmo motor que o tótem — agora uma única instância
    // rodando no servidor, não mais uma cópia local: uma sessão iniciada no
    // tótem aparece aqui, e uma estação colocada em manutenção aqui some do
    // tótem, os dois pelo mesmo WebSocket.
    window.SimClient.connect();
    window.DemoPanel.init();

    window.SimClient.onProtocol(msg => {
      if (msg.type === 'ocpp-frame') this.onOcppFrame(msg.data);
      else if (msg.type === 'modbus-write') this.onModbusWrite(msg.data);
    });

    this.bindEvents();
    this.renderContainers();

    window.SimClient.onSnapshot(snapshot => {
      this.snapshot = snapshot;

      if (!this._booted) {
        this._booted = true;
        this.renderOverview();
        this.renderStations();
        this.renderSessions();
        this.renderBilling();
        this.renderEnergy();
        this.renderPricing();
        this.switchSection('overview');
      }

      this.onSimTick(snapshot);
    });
  }

  /** Sessões já concluídas nesta simulação (reais, não mock), mais recente primeiro. */
  finishedSessions() {
    if (!this.snapshot) return [];
    return this.snapshot.sessionHistory
      .slice()
      .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  }

  sessionRowHtml(s, { withPayment } = {}) {
    const inicio = new Date(s.startedAt).toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const fim = new Date(s.finishedAt).toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const data = new Date(s.finishedAt).toLocaleDateString('pt-BR');
    if (withPayment) {
      return `
        <tr>
          <td>${s.id}</td>
          <td>Est. 0${s.evse.stationId}</td>
          <td>${s.vehicle.brand} ${s.vehicle.model}</td>
          <td>${data}</td>
          <td>${inicio} - ${fim}</td>
          <td>${s.energyGridKWh.toFixed(1)} kWh</td>
          <td>${window.PricingEngine.formatCurrency(s.cost)}</td>
          <td>PIX</td>
          <td><span class="badge success">concluída</span></td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${s.id}</td>
        <td>Estação 0${s.evse.stationId}</td>
        <td>${s.vehicle.brand} ${s.vehicle.model}</td>
        <td>${data} ${fim}</td>
        <td>${s.energyGridKWh.toFixed(1)} kWh</td>
        <td><span class="badge success">concluída</span></td>
      </tr>
    `;
  }

  /**
   * Único ponto de atualização periódica. Antes havia setInterval separados
   * para o relógio, para o progresso das baterias e para o log de protocolo,
   * cada um com o seu próprio ritmo.
   */
  onSimTick(snapshot) {
    this.updateClock();

    if (this.currentSection === 'stations') this.updateStationCards();
    if (this.currentSection === 'overview') this.updateOverviewLive(snapshot);
    if (this.currentSection === 'sessions') this.renderSessions();
    if (this.currentSection === 'billing') this.updateBillingLive();
    if (this.currentSection === 'energy') this.updateEnergyLive(snapshot);
    if (this.currentSection === 'pricing') this.updatePricingLive(snapshot);
  }

  updateBillingLive() {
    const rate = document.getElementById('billing-current-rate');
    if (rate) rate.textContent = window.PricingEngine.formatCurrency(window.PricingEngine.getCurrentRate()) + '/kWh';

    const receitaEl = document.getElementById('billing-receita');
    if (!receitaEl) return; // seção ainda não montada

    const { receita, energia, sessoes } = this.billingTotals();
    const ticket = sessoes ? receita / sessoes : 0;

    receitaEl.textContent = window.PricingEngine.formatCurrency(receita);
    document.getElementById('billing-energia').textContent = energia.toFixed(1) + ' kWh';
    document.getElementById('billing-sessoes').textContent = sessoes;
    document.getElementById('billing-ticket').textContent = window.PricingEngine.formatCurrency(ticket);
    document.getElementById('billing-kwh-medio').textContent = window.PricingEngine.formatCurrency(energia ? receita / energia : 0);
    document.getElementById('billing-pix').textContent = `${sessoes} de ${sessoes}`;

    this.renderBillingChart();
  }

  /** Relógio real do dispositivo — o mesmo que o tótem já mostra e que o
   * TariffEngine.getPosto() já usa por baixo (ver js/sim/tariff.js). O
   * relógio simulado (snapshot.clock.simDate) só governa a física da sessão
   * de carga, e não deve aparecer como "a hora agora" em lugar nenhum. */
  updateClock() {
    const relogio = document.getElementById('liveClock');
    if (relogio) relogio.textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false });

    const indicador = document.getElementById('peakIndicator');
    if (!indicador) return;
    const texto = indicador.querySelector('.indicator-text');
    const posto = this.snapshot ? this.snapshot.posto : window.TariffEngine.getPosto();

    // Três postos, e não mais apenas "pico" e "fora de pico".
    if (posto === 'ponta') {
      indicador.className = 'peak-indicator is-peak';
      texto.textContent = 'Horário de Ponta';
    } else if (posto === 'inter') {
      indicador.className = 'peak-indicator is-intermediate';
      texto.textContent = 'Intermediário';
    } else {
      indicador.className = 'peak-indicator is-offpeak';
      texto.textContent = 'Fora de Ponta';
    }
  }

  bindEvents() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const sectionId = e.currentTarget.getAttribute('data-section');
        this.switchSection(sectionId);
      });
    });
  }

  /** Quadro OCPP emitido pelo middleware do tótem. */
  onOcppFrame(frame) {
    if (frame.frame[0] !== 2) return;
    this.pushProtocolLog(
      'OCPP',
      `${frame.action} · conn ${frame.evseId || '-'}`,
      frame.pretty
    );
  }

  /** Escrita Modbus feita pelo Controle Dinâmico de Demanda. */
  onModbusWrite(write) {
    this.pushProtocolLog(
      'MODBUS',
      `FC06 slave ${write.slaveId} · 0x${write.addr.toString(16).toUpperCase().padStart(4, '0')} = ${write.value} A`,
      write.hex
    );
  }

  pushProtocolLog(tipo, texto, detalhe) {
    this.logs.push({
      tipo: tipo,
      texto: texto,
      detalhe: detalhe,
      hora: new Date().toLocaleTimeString('pt-BR', { hour12: false })
    });
    while (this.logs.length > 60) this.logs.shift();
    if (this.currentSection === 'pricing') this.renderProtocolLog();
  }

  switchSection(sectionId) {
    this.currentSection = sectionId;
    
    // Update nav UI
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('data-section') === sectionId) {
        item.classList.add('active');
        document.getElementById('pageTitle').textContent = item.textContent.trim();
      }
    });

    // Update section visibility
    document.querySelectorAll('.section').forEach(sec => {
      sec.classList.remove('active');
    });
    
    const secEl = document.getElementById(`sec-${sectionId}`);
    if (secEl) {
      secEl.classList.add('active');
      // Re-render charts if needed to fix canvas size issues when hidden
      if(sectionId === 'overview') this.renderOverviewChart();
      if(sectionId === 'sessions') this.renderSessions();
      if(sectionId === 'billing') { this.renderBillingChart(); this.updateBillingLive(); }
      if(sectionId === 'energy') this.updateEnergyLive();
      if(sectionId === 'pricing') { this.updatePricingLive(); this.renderProtocolLog(); }
    }
  }

  renderContainers() {
    const container = document.getElementById('contentContainer');
    container.innerHTML = this.sections.map(sec => `<div id="sec-${sec}" class="section"></div>`).join('');
  }

  // --- OVERVIEW ---
  renderOverview() {
    const sec = document.getElementById('sec-overview');

    const html = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Sessões Hoje</div>
          <div class="kpi-value" id="kpi-sessions">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Energia Fornecida</div>
          <div class="kpi-value" id="kpi-energy">0.0 <span style="font-size:1rem">kWh</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Faturamento</div>
          <div class="kpi-value" id="kpi-revenue">R$ 0,00</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Taxa de Ocupação</div>
          <div class="kpi-value" id="kpi-occupancy">0%</div>
        </div>
      </div>

      <div class="dashboard-row">
        <div class="card-panel">
          <h2 class="card-title">Desempenho Semanal (kWh)</h2>
          <div class="chart-container">
            <canvas id="overviewChart"></canvas>
          </div>
        </div>
        <div class="card-panel">
          <h2 class="card-title">Status em Tempo Real</h2>
          <div class="status-grid" id="miniStationGrid">
            ${this.snapshot.evses.map(e => this.getMiniStationCard(e)).join('')}
          </div>
        </div>
      </div>
      
      <div class="card-panel">
        <h2 class="card-title">Últimas Sessões</h2>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Estação</th><th>Veículo</th><th>Data</th><th>Energia</th><th>Status</th>
              </tr>
            </thead>
            <tbody id="overview-last-sessions"></tbody>
          </table>
        </div>
      </div>
    `;
    sec.innerHTML = html;
    this.updateOverviewKpis();
    this.updateOverviewLastSessions();
  }

  updateOverviewLastSessions() {
    const body = document.getElementById('overview-last-sessions');
    if (!body) return;
    const sessoes = this.finishedSessions().slice(0, 5);
    body.innerHTML = sessoes.length
      ? sessoes.map(s => this.sessionRowHtml(s)).join('')
      : `<tr><td colspan="6" style="color:var(--color-text-secondary)">Nenhuma sessão concluída ainda nesta simulação.</td></tr>`;
  }

  /** KPIs acumulados de verdade desde que o servidor subiu, não um mock fixo. */
  updateOverviewKpis() {
    const t = this.snapshot.today;
    const sessoes = document.getElementById('kpi-sessions');
    const energia = document.getElementById('kpi-energy');
    const faturamento = document.getElementById('kpi-revenue');
    const ocupacao = document.getElementById('kpi-occupancy');
    if (!sessoes) return;

    sessoes.textContent = t.sessions;
    energia.innerHTML = t.energyKWh.toFixed(1) + ' <span style="font-size:1rem">kWh</span>';
    faturamento.textContent = window.PricingEngine.formatCurrency(t.revenue);
    ocupacao.textContent = Math.round(this.snapshot.site.occupancy * 100) + '%';
  }

  getMiniStationCard(evse) {
    const cadastro = (this.mockData.stations || []).find(s => s.id === evse.stationId) || {};
    const sessao = this.snapshot.sessions.find(s => s.evseId === evse.id && s.status !== 'finished');
    const limitado = sessao && evse.commandedA < evse.iMax && evse.commandedA > 0;

    let badgeClass = 'success';
    let statusText = 'Livre';
    let estado = 'available';
    let details = `${evse.maxPowerKW.toFixed(1)} kW • ${evse.connector}`;

    if (evse.status === 'Unavailable') {
      badgeClass = 'danger';
      statusText = 'Manutenção';
      estado = 'maintenance';
    } else if (sessao && sessao.status === 'suspended') {
      badgeClass = 'danger';
      statusText = 'Suspenso';
      estado = 'maintenance';
      details = `${sessao.vehicle.model} • aguardando folga na rede`;
    } else if (sessao) {
      badgeClass = limitado ? 'warning' : 'primary';
      statusText = limitado ? 'Limitado' : 'Em uso';
      estado = 'charging';
      details = `${sessao.vehicle.model} • ${(sessao.soc * 100).toFixed(0)}% • ${sessao.powerKW.toFixed(1)} kW (${evse.commandedA} A)`;
    }

    return `
      <div class="status-card ${estado}">
        <div class="status-header">
          <div class="status-name">${cadastro.name || 'Estação ' + evse.stationId}</div>
          <div class="badge ${badgeClass}">${statusText}</div>
        </div>
        <div class="status-details">${details}</div>
      </div>
    `;
  }

  updateOverviewLive() {
    this.updateOverviewKpis();
    this.updateOverviewLastSessions();
    this.renderOverviewChart();
    const grid = document.getElementById('miniStationGrid');
    if (!grid) return;
    grid.innerHTML = this.snapshot.evses.map(e => this.getMiniStationCard(e)).join('');
  }

  renderOverviewChart() {
    const canvas = document.getElementById('overviewChart');
    if(!canvas || !this.snapshot) return;
    const ctx = canvas.getContext('2d');
    // Últimos dias simulados que já fecharam + o dia em andamento — dados
    // reais desta execução, sem preencher com uma semana inventada.
    const dias = this.snapshot.dailyHistory || [];
    const stats = [...dias.slice(-6), { date: this.currentDayKey(), energy: this.snapshot.today.energyKWh }]
      .map(d => ({ date: d.date, energy: d.energy != null ? d.energy : d.energyKWh }));

    const cw = canvas.parentElement.clientWidth;
    const ch = canvas.parentElement.clientHeight;
    canvas.width = cw;
    canvas.height = ch;

    ctx.clearRect(0, 0, cw, ch);

    const maxVal = Math.max(...stats.map(s => s.energy), 1) * 1.2;
    const barWidth = 40;
    const spacing = (cw - (barWidth * stats.length)) / (stats.length + 1);

    stats.forEach((stat, i) => {
      const h = (stat.energy / maxVal) * (ch - 40);
      const x = spacing + (i * (barWidth + spacing));
      const y = ch - 20 - h;

      // Gradient
      // Vermelho da marca, e não o laranja de uma paleta antiga que destoava
      // de todo o resto da interface.
      const grad = ctx.createLinearGradient(0, y, 0, ch - 20);
      grad.addColorStop(0, '#E4032E');
      grad.addColorStop(1, 'rgba(228, 3, 46, 0.2)');

      ctx.fillStyle = grad;
      
      // Rounded bar top
      ctx.beginPath();
      ctx.moveTo(x, ch - 20);
      ctx.lineTo(x, y + 5);
      ctx.quadraticCurveTo(x, y, x + 5, y);
      ctx.lineTo(x + barWidth - 5, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + 5);
      ctx.lineTo(x + barWidth, ch - 20);
      ctx.fill();

      // Label
      ctx.fillStyle = '#8E8EA8';
      ctx.font = '12px Inter';
      ctx.textAlign = 'center';
      const dateStr = stat.date.split('-').slice(1).join('/');
      ctx.fillText(dateStr, x + barWidth/2, ch - 5);
    });
  }

  // --- STATIONS ---
  renderStations() {
    const sec = document.getElementById('sec-stations');
    sec.innerHTML = `
      <div class="stations-detail-grid" id="stationsGrid">
        <!-- Rendered in updateStationCards -->
      </div>
    `;
    this.updateStationCards();
  }

  /**
   * Cartões alimentados pelo estado elétrico real de cada ponto de recarga:
   * corrente comandada, potência entregue e estado de carga vêm do motor de
   * simulação, não de um contador incrementado na tela.
   */
  updateStationCards() {
    const grid = document.getElementById('stationsGrid');
    if (!grid) return;

    grid.innerHTML = this.snapshot.evses.map(evse => {
      const cadastro = (this.mockData.stations || []).find(s => s.id === evse.stationId) || {};
      const sessao = this.snapshot.sessions.find(s => s.evseId === evse.id && s.status !== 'finished');
      const limitado = sessao && evse.commandedA < evse.iMax && evse.commandedA > 0;

      let rotulo = 'DISPONÍVEL';
      let estiloBadge = 'success';
      if (evse.status === 'Unavailable') { rotulo = 'MANUTENÇÃO'; estiloBadge = 'danger'; }
      else if (sessao && sessao.status === 'suspended') { rotulo = 'SUSPENSO'; estiloBadge = 'danger'; }
      else if (limitado) { rotulo = 'LIMITADO'; estiloBadge = 'warning'; }
      else if (sessao) { rotulo = 'CARREGANDO'; estiloBadge = 'primary'; }

      let conteudo = `<p>${evse.maxPowerKW.toFixed(1)} kW · ${evse.connector} · ${evse.phases === 3 ? 'trifásico' : 'monofásico'} ${evse.voltage} V</p>`;

      if (evse.status === 'Unavailable') {
        conteudo += `<p style="color:var(--color-danger)">Falha de comunicação no módulo AC</p>`;
      } else if (sessao) {
        conteudo += `
          <div class="battery-progress">
            <div class="battery-bar" style="width: ${(sessao.soc * 100).toFixed(1)}%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:0.85rem">
            <span>${sessao.vehicle.brand} ${sessao.vehicle.model}</span>
            <span>${(sessao.soc * 100).toFixed(1)}% / ${(sessao.socTarget * 100).toFixed(0)}%</span>
          </div>
          <div class="station-metrics">
            <span>Potência<strong>${sessao.powerKW.toFixed(2)} kW</strong></span>
            <span>Corrente<strong${limitado ? ' class="limited"' : ''}>${evse.commandedA} A${limitado ? ` (de ${evse.iMax})` : ''}</strong></span>
            <span>Energia<strong>${sessao.energyGridKWh.toFixed(2)} kWh</strong></span>
            <span>Parcial<strong>${window.PricingEngine.formatCurrency(sessao.cost)}</strong></span>
          </div>
        `;
      } else {
        conteudo += `<p style="color:var(--color-text-secondary)">Sem veículo conectado · corrente liberada ${evse.commandedA} A</p>`;
      }

      return `
        <div class="station-card-lg">
          <header>
            <h3>${cadastro.name || 'Estação ' + evse.stationId}</h3>
            <span class="badge ${estiloBadge}">${rotulo}</span>
          </header>
          <div style="color:var(--color-text-secondary); font-size:0.9rem; margin-bottom: 16px;">
            ${cadastro.location || '—'} · escravo Modbus ${evse.slaveId}
          </div>
          ${conteudo}
          <button class="btn-toggle" onclick="window.dashboard.toggleStationStatus(${evse.id})">
            ${evse.status === 'Unavailable' ? 'Reativar ponto' : 'Colocar em manutenção'}
          </button>
        </div>
      `;
    }).join('');
  }

  /**
   * Tira o ponto de operação ou devolve à operação. A mutação em si acontece
   * no servidor (SimEngine.toggleStation) — este comando só pede; o efeito
   * aparece no próximo snapshot (até 250ms depois), via onSimTick.
   */
  toggleStationStatus(evseId) {
    window.SimClient.send('admin:toggle-station', { evseId });
  }

  // --- SESSIONS ---
  renderSessions() {
    const sec = document.getElementById('sec-sessions');
    if (!sec || !this.snapshot) return;
    const sessoes = this.finishedSessions();
    sec.innerHTML = `
      <div class="card-panel">
        <h2 class="card-title">Histórico de Sessões</h2>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Estação</th><th>Veículo</th><th>Data</th><th>Início/Fim</th><th>Energia</th><th>Valor</th><th>Pagamento</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${sessoes.length
                ? sessoes.map(s => this.sessionRowHtml(s, { withPayment: true })).join('')
                : `<tr><td colspan="9" style="color:var(--color-text-secondary)">Nenhuma sessão concluída ainda nesta simulação.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- BILLING ---
  /** Soma dias já fechados (dailyHistory) + o dia simulado em andamento (today) — tudo real. */
  billingTotals() {
    const dias = (this.snapshot && this.snapshot.dailyHistory) || [];
    const hoje = (this.snapshot && this.snapshot.today) || { sessions: 0, energyKWh: 0, revenue: 0 };
    const receita = dias.reduce((a, d) => a + d.revenue, 0) + hoje.revenue;
    const energia = dias.reduce((a, d) => a + d.energyKWh, 0) + hoje.energyKWh;
    const sessoes = dias.reduce((a, d) => a + d.sessions, 0) + hoje.sessions;
    return { receita, energia, sessoes };
  }

  renderBilling() {
    const sec = document.getElementById('sec-billing');
    const { receita, energia, sessoes } = this.billingTotals();
    const ticket = sessoes ? receita / sessoes : 0;
    // O tótem só aceita Pix — não há outro meio de pagamento no fluxo real,
    // então essa linha é sempre 100%, e isso é o dado verdadeiro, não um mock.
    const porPix = sessoes;

    sec.innerHTML = `
      <div class="dashboard-row">
        <div class="card-panel">
          <h2 class="card-title">Faturamento Diário (R$)</h2>
          <div class="chart-container">
            <canvas id="billingChart"></canvas>
          </div>
        </div>

        <!-- A coluna da direita do grid ficava vazia, deixando um vão no layout -->
        <div class="card-panel">
          <h2 class="card-title">Consolidado do período</h2>
          <div class="tariff-breakdown">
            <div class="tariff-row">
              <span class="label">Receita acumulada</span>
              <span class="value" id="billing-receita">${window.PricingEngine.formatCurrency(receita)}</span>
            </div>
            <div class="tariff-row">
              <span class="label">Energia faturada</span>
              <span class="value" id="billing-energia">${energia.toFixed(1)} kWh</span>
            </div>
            <div class="tariff-row">
              <span class="label">Sessões concluídas</span>
              <span class="value" id="billing-sessoes">${sessoes}</span>
            </div>
            <div class="tariff-row kind-subtotal">
              <span class="label">Ticket médio</span>
              <span class="value" id="billing-ticket">${window.PricingEngine.formatCurrency(ticket)}</span>
            </div>
            <div class="tariff-row">
              <span class="label">Receita média por kWh</span>
              <span class="value" id="billing-kwh-medio">${window.PricingEngine.formatCurrency(energia ? receita / energia : 0)}</span>
            </div>
            <div class="tariff-row">
              <span class="label">Pagamentos via Pix</span>
              <span class="value" id="billing-pix">${porPix} de ${sessoes}</span>
            </div>
            <div class="tariff-row kind-total">
              <span class="label">Preço praticado agora</span>
              <span class="value" id="billing-current-rate">${window.PricingEngine.formatCurrency(window.PricingEngine.getCurrentRate())}/kWh</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /** Chave "AAAA-MM-DD" do dia simulado corrente, no mesmo formato de dailyHistory. */
  currentDayKey() {
    const d = new Date(this.snapshot.clock.simDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  renderBillingChart() {
    const canvas = document.getElementById('billingChart');
    if(!canvas || !this.snapshot) return;
    const ctx = canvas.getContext('2d');
    // Dias simulados que já fecharam, mais o dia em andamento — sem inventar
    // histórico: o gráfico começa vazio e cresce conforme a simulação roda.
    const dias = this.snapshot.dailyHistory || [];
    const stats = [...dias, { date: this.currentDayKey(), revenue: this.snapshot.today.revenue }];

    const cw = canvas.parentElement.clientWidth;
    const ch = canvas.parentElement.clientHeight;
    canvas.width = cw;
    canvas.height = ch;

    ctx.clearRect(0, 0, cw, ch);

    if (stats.length < 2) {
      ctx.fillStyle = '#8E8EA8';
      ctx.font = '13px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('Ainda não há um dia simulado completo de histórico.', cw / 2, ch / 2);
      return;
    }

    const maxVal = Math.max(...stats.map(s => s.revenue), 1) * 1.2;
    const pts = stats.map((s, i) => {
      const x = 40 + (i * ((cw - 80) / (stats.length - 1)));
      const y = ch - 30 - ((s.revenue / maxVal) * (ch - 60));
      return {x, y, s};
    });

    // Draw Line & Gradient
    ctx.beginPath();
    ctx.moveTo(pts[0].x, ch - 30);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length-1].x, ch - 30);
    
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, 'rgba(0, 214, 143, 0.4)');
    grad.addColorStop(1, 'rgba(0, 214, 143, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach((p, i) => {
      if(i > 0) {
        const prev = pts[i-1];
        const cpX = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(cpX, prev.y, cpX, p.y, p.x, p.y);
      }
    });
    ctx.strokeStyle = '#00D68F';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw dots
    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI*2);
      ctx.fillStyle = '#00D68F';
      ctx.fill();
      ctx.strokeStyle = '#16162A';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = '#8E8EA8';
      ctx.font = '11px Inter';
      ctx.textAlign = 'center';
      const dateStr = p.s.date.split('-').slice(1).join('/');
      ctx.fillText(dateStr, p.x, ch - 10);
      
      ctx.fillStyle = '#F0F0F5';
      ctx.fillText('R$'+p.s.revenue.toFixed(0), p.x, p.y - 12);
    });
  }

  // --- ENERGIA ---
  renderEnergy() {
    const sec = document.getElementById('sec-energy');
    sec.innerHTML = `
      <div class="kpi-grid" id="energyKpis"></div>

      <div class="card-panel">
        <h2 class="card-title">Curva do dia e demanda contratada</h2>
        <div class="chart-container" style="height:280px">
          <canvas id="energyChart"></canvas>
        </div>
        <div class="site-legend" style="margin-top:12px">
          <span><i style="background:var(--color-text-muted)"></i> Consumo do prédio</span>
          <span><i style="background:var(--color-success)"></i> Geração solar</span>
          <span><i style="background:var(--color-primary)"></i> Recarga de veículos</span>
          <span><i style="background:var(--color-danger)"></i> Demanda contratada</span>
        </div>
      </div>

      <div class="card-panel">
        <h2 class="card-title">Alocação de potência por ponto</h2>
        <div id="energyAllocation"></div>
      </div>
    `;
    this.updateEnergyLive(this.snapshot);
  }

  updateEnergyLive(snapshot) {
    const snap = snapshot || this.snapshot;
    const kpis = document.getElementById('energyKpis');
    if (!kpis || !snap) return;

    const d = snap.demand;
    const estadoRotulo = {
      NORMAL: 'Normal', ATENCAO: 'Atenção', LIMITANDO: 'Limitando', SUSPENSO: 'Suspendendo'
    }[d.state];

    const cartoes = [
      { label: 'Demanda agora', valor: d.measuredKW.toFixed(1) + ' kW', nota: `limite ${d.limitKW.toFixed(1)} kW` },
      { label: 'Projeção da janela de 15 min', valor: d.projectedWindowKW.toFixed(1) + ' kW', nota: `${(d.windowProgress * 100).toFixed(0)}% da janela decorrida` },
      { label: 'Folga para recarga', valor: d.availableKW.toFixed(1) + ' kW', nota: 'após servir o prédio' },
      { label: 'Geração solar', valor: snap.site.solarKW.toFixed(1) + ' kW', nota: snap.site.surplusKW > 0.1 ? `${snap.site.surplusKW.toFixed(1)} kW de excedente` : 'totalmente autoconsumida' },
      { label: 'Controle de demanda', valor: estadoRotulo, nota: snap.site.demoPeak ? 'pico de consumo simulado ativo' : 'operação normal' }
    ];

    kpis.innerHTML = cartoes.map(c => `
      <div class="kpi-card">
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${c.valor}</div>
        <div class="kpi-trend">${c.nota}</div>
      </div>
    `).join('');

    const aloc = document.getElementById('energyAllocation');
    if (aloc) {
      aloc.innerHTML = snap.evses.map(evse => {
        const sessao = snap.sessions.find(s => s.evseId === evse.id && s.status !== 'finished');
        const suspensa = sessao && sessao.status === 'suspended';
        const limitado = sessao && !suspensa && evse.commandedA < evse.iMax;

        // A barra representa potência realmente alocada. Um ponto livre ou em
        // manutenção tem corrente liberada mas não consome nada — mostrá-lo
        // cheio daria a impressão de uma carga que não existe.
        const pct = sessao && !suspensa ? (evse.commandedA / evse.iMax) * 100 : 0;
        const classe = suspensa ? 'suspended' : (limitado ? 'limited' : '');

        let corrente;
        if (evse.status === 'Unavailable') corrente = 'manutenção';
        else if (!sessao) corrente = 'livre';
        else if (suspensa) corrente = 'suspenso';
        else corrente = `${evse.commandedA} / ${evse.iMax} A`;

        return `
          <div class="alloc-row${sessao ? '' : ' idle'}">
            <span class="alloc-name">Est. 0${evse.stationId}</span>
            <div class="alloc-bar">
              <div class="alloc-fill ${classe}" style="width:${Math.max(0, Math.min(100, pct))}%"></div>
            </div>
            <span class="alloc-value">${corrente}</span>
            <span class="alloc-power">${sessao ? sessao.powerKW.toFixed(2) + ' kW' : '—'}</span>
          </div>
        `;
      }).join('');
    }

    this.renderEnergyChart();
  }

  /** Curva de 24 h do estabelecimento contra o limite contratado. */
  renderEnergyChart() {
    const canvas = document.getElementById('energyChart');
    if (!canvas || !canvas.parentElement.clientWidth) return;

    const ctx = canvas.getContext('2d');
    const cw = canvas.parentElement.clientWidth;
    const ch = canvas.parentElement.clientHeight;
    canvas.width = cw;
    canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);

    const margem = { esq: 44, dir: 12, topo: 14, base: 26 };
    const larg = cw - margem.esq - margem.dir;
    const alt = ch - margem.topo - margem.base;
    const escala = window.SiteConfig.contractedDemandKW * 1.15;
    const x = h => margem.esq + (h / 24) * larg;
    const y = kw => margem.topo + alt - (kw / escala) * alt;

    // Eixo de referência em kW
    ctx.strokeStyle = 'rgba(142,142,168,0.20)';
    ctx.fillStyle = '#8E8EA8';
    ctx.font = '10px Inter';
    ctx.lineWidth = 1;
    for (let kw = 0; kw <= escala; kw += 25) {
      ctx.beginPath();
      ctx.moveTo(margem.esq, y(kw));
      ctx.lineTo(cw - margem.dir, y(kw));
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(kw + ' kW', margem.esq - 6, y(kw) + 3);
    }

    const amostra = (curva, h) => {
      const hh = ((h % 24) + 24) % 24;
      const i = Math.floor(hh);
      const frac = hh - i;
      const a = curva[i];
      const b = curva[(i + 1) % 24];
      return a + (b - a) * frac;
    };

    // Consumo do prédio, como área preenchida
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    for (let h = 0; h <= 24; h += 0.25) ctx.lineTo(x(h), y(amostra(window.SiteConfig.baseLoadByHour, h)));
    ctx.lineTo(x(24), y(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(142,142,168,0.22)';
    ctx.fill();

    // Geração solar
    ctx.beginPath();
    for (let h = 0; h <= 24; h += 0.25) {
      const py = y(amostra(window.SiteConfig.solarByHour, h));
      if (h === 0) ctx.moveTo(x(h), py); else ctx.lineTo(x(h), py);
    }
    ctx.strokeStyle = '#00B074';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Demanda contratada
    const limiteKW = this.snapshot.site.limitKW;
    ctx.beginPath();
    ctx.setLineDash([6, 5]);
    ctx.moveTo(margem.esq, y(limiteKW));
    ctx.lineTo(cw - margem.dir, y(limiteKW));
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // Instante atual e leitura do medidor
    const agora = this.snapshot.clock.hourFloat;
    ctx.beginPath();
    ctx.moveTo(x(agora), margem.topo);
    ctx.lineTo(x(agora), margem.topo + alt);
    ctx.strokeStyle = 'rgba(228,3,46,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x(agora), y(this.snapshot.demand.measuredKW), 5, 0, Math.PI * 2);
    ctx.fillStyle = '#E4032E';
    ctx.fill();

    // Horas no eixo
    ctx.fillStyle = '#8E8EA8';
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 4) ctx.fillText(String(h).padStart(2, '0') + 'h', x(h), ch - 8);
  }

  // --- TARIFAÇÃO E PROTOCOLO ---
  renderPricing() {
    const sec = document.getElementById('sec-pricing');
    sec.innerHTML = `
      <div class="dashboard-row">
        <div class="card-panel">
          <h2 class="card-title">Composição do preço agora</h2>
          <div class="tariff-breakdown" id="pricingBreakdown"></div>

          <h2 class="card-title" style="margin-top:28px">Postos da Tarifa Branca</h2>
          <div class="timeline-bar" id="postoTimeline"></div>
          <!-- Rótulos equidistantes: as faixas são posicionadas pelo horário
               real, então marcos irregulares (17h, 18h, 21h) distribuídos por
               igual apontariam para o lugar errado da barra. -->
          <div class="timeline-labels">
            <span>00h</span><span>04h</span><span>08h</span><span>12h</span><span>16h</span><span>20h</span><span>24h</span>
          </div>
          <p class="timeline-note" id="postoNote"></p>
        </div>

        <div class="card-panel">
          <h2 class="card-title">Tráfego de protocolo (OCPP / Modbus)</h2>
          <div class="terminal" id="protocolLogs"></div>
        </div>
      </div>
    `;
    this.updatePricingLive();
    this.renderProtocolLog();
  }

  /** Preço vigente aberto linha a linha, e a faixa horária do dia. */
  updatePricingLive() {
    const alvo = document.getElementById('pricingBreakdown');
    if (!alvo) return;

    alvo.innerHTML = window.PricingEngine.getBreakdown().map(linha => {
      const valor = linha.kind === 'factor'
        ? `× ${linha.factor.toFixed(3)}`
        : `${linha.value < 0 ? '−' : ''}R$ ${Math.abs(linha.value).toFixed(4)}`;
      return `
        <div class="tariff-row kind-${linha.kind}">
          <span class="label">${linha.label}</span>
          <span class="value">${valor}</span>
        </div>
      `;
    }).join('');

    const timeline = document.getElementById('postoTimeline');
    if (timeline && this.snapshot) {
      const util = this.snapshot.clock.isWeekday;
      timeline.innerHTML = window.TariffEngine.postosDoDia(util).map(faixa => `
        <div class="timeline-band band-${faixa.posto}"
             style="left:${(faixa.from / 24) * 100}%; width:${((faixa.to - faixa.from) / 24) * 100}%"></div>
      `).join('') +
      `<div class="timeline-now" style="left:${(this.snapshot.clock.hourFloat / 24) * 100}%"></div>`;
    }

    const nota = document.getElementById('postoNote');
    if (nota && this.snapshot) {
      nota.textContent = this.snapshot.clock.isWeekday
        ? 'Dia útil: ponta das 18h às 21h, intermediário nas horas adjacentes.'
        : 'Fim de semana: tarifa fora-ponta durante as 24 horas.';
    }
  }

  /** Terminal alimentado pelo tráfego real emitido pelo motor. */
  renderProtocolLog() {
    const term = document.getElementById('protocolLogs');
    if (!term) return;

    term.innerHTML = this.logs.slice(-50).map(l => `
      <p title="${(l.detalhe || '').replace(/"/g, '&quot;')}">
        <span class="log-time">[${l.hora}]</span>
        <span class="log-src">[${l.tipo}]</span>
        <span class="log-msg">${l.texto}</span>
      </p>
    `).join('');

    term.scrollTop = term.scrollHeight;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new AdminDashboard();
});
