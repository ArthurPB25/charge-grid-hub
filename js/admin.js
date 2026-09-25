// js/admin.js

class AdminDashboard {
  constructor() {
    this.sections = ['overview', 'stations', 'sessions', 'billing', 'energy', 'pricing'];
    this.currentSection = 'overview';
    this.stationCatalog = window.MockData || {};
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
    window.SimClient.onConnection(connected => {
      const notice = document.getElementById('admin-connection-status');
      notice.hidden = connected && this._booted;
      notice.textContent = connected ? 'Aguardando dados do servidor…' : 'Sem conexão com o servidor. Execute npm start na pasta chargegrid-hub/server. Os dados aparecerão quando a conexão for estabelecida.';
    });

    window.SimClient.onSnapshot(snapshot => {
      document.getElementById('admin-connection-status').hidden = true;
      const operations = snapshot.operations || { today: { sessions: 0, energyKWh: 0, revenue: 0 }, dailyHistory: [], sessionHistory: [] };
      this.snapshot = { ...snapshot, ...operations,
        sessions: snapshot.sessions.filter(s => !s.ambient),
        site: { ...snapshot.site, occupancy: snapshot.sessions.filter(s => !s.ambient && s.status !== 'finished').length / Math.max(1, snapshot.evses.length) }
      };

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

      this.onSimTick(this.snapshot);
    });
  }

  /** Operações concluídas do totem, com a mais recente primeiro. */
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
          <td>${s.paymentMethod === 'pix' ? 'Pix informado pelo totem' : 'Demonstração · sem cobrança'}</td>
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
    document.getElementById('billing-pix').textContent = `${this.finishedSessions().filter(s => s.paymentMethod === 'pix').length} de ${sessoes}`;

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
    container.innerHTML = '<div id="admin-connection-status" class="card-panel" role="status">Conectando ao servidor…</div>' + this.sections.map(sec => `<div id="sec-${sec}" class="section"></div>`).join('');
  }

  // --- OVERVIEW ---
  renderOverview() {
    const sec = document.getElementById('sec-overview');

    const html = `
      <div class="card-panel">
        <h2 class="card-title">Operações do totem</h2>
        <p>Sessões e horários registrados pelo sistema. Energia, potência e custo são estimativas até conectar a telemetria GoodWe. Pix informado não equivale a recebimento conciliado; inclui testes sandbox.</p>
        <p id="history-storage-status" role="status"></p>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Sessões Hoje</div>
          <div class="kpi-value" id="kpi-sessions">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Energia estimada</div>
          <div class="kpi-value" id="kpi-energy">0.0 <span style="font-size:1rem">kWh</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Valor calculado</div>
          <div class="kpi-value" id="kpi-revenue">R$ 0,00</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Ocupação do cadastro</div>
          <div class="kpi-value" id="kpi-occupancy">0%</div>
        </div>
      </div>

      <div class="dashboard-row">
        <div class="card-panel">
          <h2 class="card-title">Energia estimada por dia (kWh)</h2>
          <div class="chart-container">
            <canvas id="overviewChart"></canvas>
          </div>
        </div>
        <div class="card-panel">
          <h2 class="card-title">Estado das estações no totem</h2>
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
      : `<tr><td colspan="6" style="color:var(--color-text-secondary)">Nenhuma sessão do totem concluída ainda.</td></tr>`;
  }

  /** KPIs acumulados de verdade desde que o servidor subiu, não um mock fixo. */
  updateOverviewKpis() {
    const t = this.snapshot.today;
    const storage = document.getElementById('history-storage-status');
    if (storage) storage.textContent = this.snapshot.storageError ? 'Não foi possível salvar o histórico em disco. Os registros atuais estão apenas na memória.' : '';
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
    const cadastro = (this.stationCatalog.stations || []).find(s => s.id === evse.stationId) || {};
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
      const cadastro = (this.stationCatalog.stations || []).find(s => s.id === evse.stationId) || {};
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
        conteudo += `<p style="color:var(--color-danger)">Ponto colocado em manutenção pelo operador</p>`;
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
            <span>Potência estimada<strong>${sessao.powerKW.toFixed(2)} kW</strong></span>
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
        <h2 class="card-title">Histórico de sessões do totem</h2>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Estação</th><th>Veículo</th><th>Data</th><th>Início/Fim</th><th>Energia estimada</th><th>Valor calculado</th><th>Pagamento</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${sessoes.length
                ? sessoes.map(s => this.sessionRowHtml(s, { withPayment: true })).join('')
                : `<tr><td colspan="9" style="color:var(--color-text-secondary)">Nenhuma sessão do totem concluída ainda.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- BILLING ---
  /** Soma os valores calculados das sessões do totem, agrupados por data real. */
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
    // Pix informado pelo totem é separado da demonstração e não comprova recebimento.
    const porPix = this.finishedSessions().filter(s => s.paymentMethod === 'pix').length;

    sec.innerHTML = `
      <div class="dashboard-row">
        <div class="card-panel">
          <h2 class="card-title">Valores calculados por dia (R$)</h2>
          <div class="chart-container">
            <canvas id="billingChart"></canvas>
          </div>
        </div>

        <!-- A coluna da direita do grid ficava vazia, deixando um vão no layout -->
        <div class="card-panel">
          <h2 class="card-title">Consolidado do período</h2>
          <div class="tariff-breakdown">
            <div class="tariff-row">
              <span class="label">Valor calculado acumulado</span>
              <span class="value" id="billing-receita">${window.PricingEngine.formatCurrency(receita)}</span>
            </div>
            <div class="tariff-row">
              <span class="label">Energia estimada</span>
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
              <span class="label">Valor calculado por kWh</span>
              <span class="value" id="billing-kwh-medio">${window.PricingEngine.formatCurrency(energia ? receita / energia : 0)}</span>
            </div>
            <div class="tariff-row">
              <span class="label">Sessões com Pix informado</span>
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

  /** Data real do servidor, no fuso de São Paulo. */
  currentDayKey() {
    return this.snapshot.today.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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
      ctx.fillText('O gráfico será preenchido com as sessões do totem.', cw / 2, ch / 2);
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

  // --- TELEMETRIA GOODWE ---
  renderEnergy() {
    const sec = document.getElementById("sec-energy");
    const sems = this.snapshot.sems;
    if (sems?.status === 'imported') {
      const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      sec.innerHTML = `
        <div class="card-panel">
          <h2 class="card-title">GoodWe · ${escape(sems.stationName)}</h2>
          <p><span class="badge warning">Importação do SEMS+ · sem atualização automática</span></p>
          <p>Carregador ${escape(sems.deviceSn)} · Consulta em ${escape(new Date(sems.capturedAt).toLocaleString('pt-BR'))}.</p>
          <p>Estado observado na consulta: ${escape(sems.observedStatus)}. Esse estado não é uma leitura ao vivo.</p>
          <p>Os registros abaixo são do carregador e não são somados às estimativas do totem. Não há associação automática entre os dois históricos.</p>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Registros importados</div><div class="kpi-value">${sems.records.length}</div></div>
          <div class="kpi-card"><div class="kpi-label">Energia nos registros importados</div><div class="kpi-value">${sems.totalEnergyKWh.toFixed(2)} kWh</div></div>
          <div class="kpi-card"><div class="kpi-label">Potência ao vivo</div><div class="kpi-value">—</div><div class="kpi-trend">Integração automática pendente</div></div>
        </div>
        <div class="card-panel"><h2 class="card-title">Recargas registradas pelo SEMS+</h2>
          <p>Datas e horários conforme exibidos no portal. Esta importação contém os registros visíveis na consulta, não todo o histórico do equipamento.</p>
          <div class="table-responsive"><table class="data-table">
            <thead><tr><th>Início</th><th>Fim</th><th>Energia registrada</th></tr></thead>
            <tbody>${sems.records.map(r => `<tr><td>${escape(r.startedAtDisplay)}</td><td>${escape(r.finishedAtDisplay)}</td><td>${r.energyKWh.toFixed(2)} kWh</td></tr>`).join('')}</tbody>
          </table></div>
        </div>`;
      return;
    }
    sec.innerHTML = '<div class="card-panel"><h2 class="card-title">Carregador GoodWe · SEMS+</h2><p><span class="badge warning">Aguardando integração</span></p><p>A conexão com a conta SEMS+ ainda não foi configurada. Nenhuma medição do carregador está sendo recebida.</p><p>Potência, corrente, tensão, energia e estado do equipamento serão exibidos conforme a disponibilidade dos dados na integração.</p></div><div class="kpi-grid">' +
      ["Potência medida", "Corrente medida", "Tensão medida", "Energia medida"].map(label => '<div class="kpi-card"><div class="kpi-label">' + label + '</div><div class="kpi-value">—</div><div class="kpi-trend">Sem dados do SEMS+</div></div>').join("") + '</div>';
  }
  updateEnergyLive() {
    // Não substitui telemetria ausente por curvas artificiais.
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
          <h2 class="card-title">Protocolo simulado (OCPP / Modbus)</h2>
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
