window.App = {
  screens: ['welcome', 'stations', 'vehicle', 'payment', 'monitoring'],
  selectedVehicle: null,
  
  init() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = themeToggle?.querySelector('.material-symbols-outlined');
    const savedTheme = localStorage.getItem('chargegrid-theme') || '';
    if(savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    if(themeIcon) themeIcon.textContent = savedTheme === 'dark' ? 'dark_mode' : 'light_mode';

    if(themeToggle) {
      themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? '' : 'dark';
        if(next) document.documentElement.setAttribute('data-theme', next);
        else document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('chargegrid-theme', next);
        if(themeIcon) themeIcon.textContent = next === 'dark' ? 'dark_mode' : 'light_mode';
      });
    }

    // O motor de simulação roda no servidor (com duas sessões ambiente já em
    // curso, para o Controle Dinâmico de Demanda ter o que fazer) — aqui só
    // conectamos por WebSocket e recebemos o estado ao vivo.
    window.SimClient.connect();
    window.DemoPanel.init();

    window.StationManager.init();
    this.bindEvents();
    this.bindScrollCue();

    window.SimClient.onSnapshot(snapshot => this.onSimTick(snapshot));
    window.ChargingSimulator.onUpdate(data => {
      if (this.currentScreen === 'monitoring') this.updateMonitoringUI(data);
    });
    window.ChargingSimulator.bind();
    window.SimClient.onConnection(() => {
      if (this.currentScreen === 'welcome') this.updateWelcomeScreen();
      if (this.currentScreen === 'stations') this.renderStations();
      if (this.currentScreen === 'monitoring') this.renderSessionEndControls();
    });
    window.SimClient.onAuthorization(data => this.onAuthorization(data));
    this.initMqttControls();

    // Comandos automáticos usam outro tópico: suspender por demanda não
    // pode voltar pelo tópico de autorização e encerrar a sessão do usuário.
    window.SimClient.onRelay(command => {
      window.MqttBridge.aplicarComandoRele(command);
    });

    this.showScreen('welcome');
    this.updateWelcomeScreen();
    this.updateSimClock();
    window.TapDemo?.restore();
  },

  /** Relógio real do dispositivo, fixo na tela inteira — é o que explica pro
   * motorista por que a tarifa está mais alta ou mais baixa num dado
   * momento. A tarifa (TariffEngine.getPosto) segue esse mesmo horário real,
   * não o relógio acelerado que só governa a física da sessão de carga. */
  updateSimClock() {
    const el = document.getElementById('sim-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },

  /** Chamado a cada tick do relógio simulado. */
  onSimTick(snapshot) {
    this.updateSimClock();
    if (this.currentScreen === 'welcome') {
      this.updateWelcomeScreen();
      return;
    }
    // Uma estação que o admin coloca em manutenção enquanto o motorista está
    // navegando some da lista sem precisar voltar e entrar de novo na tela.
    // Só redesenha quando o conjunto de estações disponíveis realmente muda —
    // redesenhar a cada 250ms incondicionalmente derrubava o clique do
    // motorista se ele tocasse num cartão bem no instante de um tick.
    if (this.currentScreen === 'stations') {
      if (this.stationsAvailabilitySignature() !== this._lastStationsSignature) {
        this.renderStations();
      }
      this.updateStationSessions(snapshot);
      this.updateStationTariff();
      return;
    }
    if (this.currentScreen !== 'monitoring') return;
    if (!window.ChargingSimulator.getSnapshotSession(snapshot) && !this._summaryShown) {
      this.returnToStations('Esta sessão não está mais disponível. Confira o histórico no painel administrativo.');
      return;
    }
    this.updateDemandBanner(snapshot);
    this.updateSiteStrip(snapshot);
  },

  bindEvents() {
    // Welcome
    document.getElementById('btn-start').addEventListener('click', () => {
      this.returnToStations();
    });

    // Back buttons
    document.querySelectorAll('.btn-back').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.target;
        if (target === 'stations') {
          window.PaymentController.cancelPayment();
        }
        if (target === 'stations') this.returnToStations();
        else this.showScreen(target);
      });
    });

    // Stations -> Vehicle
    document.getElementById('btn-continue-payment').addEventListener('click', () => {
      if (!window.StationManager.getSelectedStation()) return;
      this.renderVehicles();
      this.showScreen('vehicle');
    });

    // Vehicle -> Payment
    const btnContinueVehicle = document.getElementById('btn-continue-vehicle');
    if (btnContinueVehicle) {
      btnContinueVehicle.addEventListener('click', () => {
        if (!this.selectedVehicle) return;
        this.initPaymentScreen();
        this.showScreen('payment');
      });
    }

    // Payment -> Cancel
    document.getElementById('btn-cancel-method')?.addEventListener('click', () => {
      window.PaymentController.cancelPayment();
      this.showScreen('stations');
    });

    // Payment method selection
    document.querySelectorAll('.payment-method-card').forEach(card => {
      card.addEventListener('click', (e) => {
        document.querySelectorAll('.payment-method-card').forEach(c => c.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
        window.PaymentController.selectMethod(e.currentTarget.dataset.method);
        const btn = document.getElementById('btn-confirm-method');
        if (btn) btn.disabled = !this._paymentReady;
      });
    });

    // Pix segue o fluxo real (Mercado Pago); débito/crédito continuam
    // declarados como pendentes — não sabemos ainda como aceitar maquininha.
    document.getElementById('btn-confirm-method')?.addEventListener('click', () => {
      if (!this._paymentReady || !window.PaymentController.orderData?.estimate) return;
      if (window.PaymentController.selectedMethod === 'pix') {
        this.startRealPix();
      } else {
        if (window.TapDemo) window.TapDemo.begin();
        else this.showPaymentPending();
      }
    });

    // Segue para a recarga sem processar pagamento, para fins de demonstração.
    document.getElementById('btn-skip-payment')?.addEventListener('click', () => {
      this.startMonitoring();
    });

    document.getElementById('btn-back-method')?.addEventListener('click', () => {
      this.showPaymentStep('method');
    });

    document.getElementById('btn-retry-authorization')?.addEventListener('click', () => this.startMonitoring());
    document.getElementById('btn-cancel-authorization')?.addEventListener('click', () => {
      this.cancelAuthorization();
      this.showScreen('stations');
      this.renderStations();
    });

    document.getElementById('btn-cancelar-pix')?.addEventListener('click', () => {
      this.cancelarPix();
      this.showPaymentStep('method');
    });

    document.getElementById('btn-copiar-pix')?.addEventListener('click', () => {
      const campo = document.getElementById('pix-codigo');
      campo.select();
      navigator.clipboard?.writeText(campo.value).catch(() => {});
      const btn = document.getElementById('btn-copiar-pix');
      const original = btn.textContent;
      btn.textContent = 'Copiado!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    });

    // Monitoring -> End
    document.getElementById('btn-end-charge').addEventListener('click', () => {
      this.showSummaryModal();
    });
    document.getElementById('btn-stop-charge').addEventListener('click', () => {
      this.showSummaryModal();
    });
    document.getElementById('btn-back-stations').addEventListener('click', () => this.returnToStations());

    // Modal close
    document.getElementById('btn-new-charge').addEventListener('click', () => {
      this.hideModal();
      this.returnToStations();
    });
    document.getElementById('btn-close-modal').addEventListener('click', () => {
      this.hideModal();
      this.returnToStations();
    });
  },

  showScreen(screenId) {
    if (this._awaitingAuthorization && screenId !== 'payment') this.cancelAuthorization();
    if (this.currentScreen === 'payment' && screenId !== 'payment') {
      this.cancelarPix();
      this._paymentRequest = (this._paymentRequest || 0) + 1;
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const tela = document.getElementById(`screen-${screenId}`);
    tela.classList.add('active');
    this.currentScreen = screenId;

    // Cada tela começa do topo; sem isso a rolagem da tela anterior é herdada.
    tela.scrollTop = 0;
    requestAnimationFrame(() => this.updateScrollCue());
  },

  /** Avisa que há conteúdo abaixo da dobra, enquanto a tela não foi rolada. */
  updateScrollCue() {
    let cue = document.getElementById('scroll-cue');
    if (!cue) {
      cue = document.createElement('div');
      cue.id = 'scroll-cue';
      cue.className = 'scroll-cue';
      cue.textContent = '↓ role para ver mais';
      document.body.appendChild(cue);
    }

    const tela = document.getElementById(`screen-${this.currentScreen}`);
    if (!tela) return;

    const sobra = tela.scrollHeight - tela.clientHeight - tela.scrollTop;
    cue.classList.toggle('visible', sobra > 80);
  },

  bindScrollCue() {
    document.querySelectorAll('.screen').forEach(tela => {
      tela.addEventListener('scroll', () => this.updateScrollCue(), { passive: true });
    });
    window.addEventListener('resize', () => this.updateScrollCue());
  },

  updateWelcomeScreen() {
    const ready = window.SimClient.connected && window.SimClient.snapshot;
    const count = this._availableStations().length;
    document.getElementById('welcome-count').textContent = ready ? count : '—';
    document.getElementById('welcome-label').textContent = ready ? (count === 1 ? 'Estação Disponível' : 'Estações Disponíveis') : 'Sem conexão com o servidor';
    document.getElementById('btn-start').disabled = !ready;
    this.updateWelcomeTariff();
  },

  /**
   * Tarifa vigente, só pra informar — sem escolha, sem detalhe de posto
   * horário ou ocupação. O motorista decide se carrega ou não com esse único
   * número; a composição do preço fica pro painel do operador.
   */
  updateWelcomeTariff() {
    const valor = document.getElementById('welcome-tariff-value');
    const posto = document.getElementById('welcome-tariff-posto');
    if (!valor || !posto) return;
    if (!window.SimClient.connected || !window.SimClient.snapshot) {
      valor.textContent = 'Indisponível';
      posto.textContent = 'Aguardando conexão';
      return;
    }

    const preco = window.PricingEngine.getCurrentRate();
    valor.innerHTML = window.PricingEngine.formatCurrency(preco) + '<small>/kWh</small>';
    posto.textContent = window.PricingEngine.postoLabel() + ' agora';
  },

  /**
   * Mostra só o que o cliente pode de fato escolher agora. Uma estação
   * ocupada ou em manutenção não é uma opção pra ele — não faz sentido
   * mostrar um cartão cinza e travado só pra informar isso; é mais simples
   * ela simplesmente não aparecer na lista.
   */
  /**
   * A disponibilidade real vem do snapshot do servidor (o admin pode
   * colocar um ponto em manutenção de outra tela) — o catálogo local
   * (StationManager) só fornece nome/local/conector para exibição.
   */
  _availableStations() {
    const snapshot = window.SimClient.snapshot;
    return window.StationManager.getStations().filter(s => {
      const evse = snapshot && snapshot.evses.find(e => e.stationId === s.id);
      return evse?.status === 'Available';
    });
  },

  stationsAvailabilitySignature() {
    const snapshot = window.SimClient.snapshot;
    return window.StationManager.getStations().map(station => {
      const evse = snapshot?.evses.find(e => e.stationId === station.id);
      const session = snapshot?.sessions.find(s => s.evseId === evse?.id);
      return `${station.id}:${evse?.status || 'offline'}:${session?.id || ''}`;
    }).join(',');
  },

  escapeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  },

  renderStations() {
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = '';

    const snapshot = window.SimClient.snapshot;
    this._lastStationsSignature = this.stationsAvailabilitySignature();
    const selected = window.StationManager.selectedStationId;
    if (!this._availableStations().some(s => s.id === selected)) window.StationManager.selectedStationId = null;
    document.getElementById('btn-continue-payment').disabled = !window.StationManager.selectedStationId || !window.SimClient.connected;

    window.StationManager.getStations().forEach(station => {
      const evse = snapshot?.evses.find(e => e.stationId === station.id);
      const session = snapshot?.sessions.find(s => s.evseId === evse?.id);
      const available = evse?.status === 'Available' && !session;
      const isSelected = available && window.StationManager.selectedStationId === station.id;
      const card = document.createElement('button');
      card.type = 'button';
      card.dataset.stationId = station.id;
      card.disabled = !window.SimClient.connected || (!available && !session);
      card.className = `card station-card ${session ? 'occupied' : ''} ${isSelected ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="station-header">
          <div>
            <div class="station-title">${this.escapeText(station.name)}</div>
            <div class="station-location">${this.escapeText(station.location)}</div>
          </div>
          <span class="station-status" data-station-status></span>
        </div>
        <div class="station-details">
          <div class="detail-item"><span class="material-symbols-outlined">ev_station</span> ${station.connector}</div>
          <div class="detail-item"><span class="material-symbols-outlined">bolt</span> ${station.maxPower} kW</div>
        </div>
        ${session ? `
          <div class="station-session">
            <div class="station-vehicle">${this.escapeText(session.vehicle.brand)} ${this.escapeText(session.vehicle.model)}</div>
            <div class="station-charge"><strong data-station-percent></strong><span data-station-power></span></div>
            <div class="station-progress"><div data-station-progress></div></div>
            <div class="station-action">Toque para ver os detalhes</div>
            <small class="station-source">Bateria e recarga simuladas</small>
          </div>` : `<div class="station-action">${available ? 'Selecionar para iniciar recarga' : 'Indisponível'}</div>`}
      `;

      card.addEventListener('click', () => {
        if (session) {
          this.openMonitoring(session.id);
          return;
        }
        window.StationManager.selectStation(station.id);
        this.renderStations();
        this.updateStationTariff();
      });
      grid.appendChild(card);
    });
    this.updateStationSessions(snapshot);
  },

  updateStationSessions(snapshot) {
    this.updateEnergyDistribution(snapshot);
    document.querySelectorAll('[data-station-id]').forEach(card => {
      const evse = snapshot?.evses.find(e => e.stationId === Number(card.dataset.stationId));
      const session = snapshot?.sessions.find(s => s.evseId === evse?.id);
      const status = card.querySelector('[data-station-status]');
      status.textContent = !window.SimClient.connected ? 'Sem conexão' : session
        ? (session.status === 'finished' ? 'Concluída' : session.status === 'suspended' ? 'Pausada' : 'Carregando')
        : evse?.status === 'Available' ? 'Disponível' : 'Indisponível';
      card.disabled = !window.SimClient.connected || (!session && evse?.status !== 'Available');
      if (!session) return;
      const percent = Math.floor(session.soc * 100);
      card.querySelector('[data-station-percent]').textContent = `${percent}%`;
      card.querySelector('[data-station-power]').textContent = `${session.powerKW.toFixed(1)} kW`;
      card.querySelector('[data-station-progress]').style.width = `${percent}%`;
    });
  },

  updateEnergyDistribution(snapshot) {
    const total = document.getElementById('energy-total');
    const budget = document.getElementById('energy-budget');
    const grid = document.getElementById('energy-stations');
    if (!total || !budget || !grid) return;
    const allocation = snapshot?.demand?.allocation;
    if (!allocation || !window.SimClient.connected) {
      total.textContent = 'Sem conexão';
      budget.textContent = 'Aguardando conexão com o controlador…';
      grid.replaceChildren();
      return;
    }
    const kw = value => value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    total.textContent = `${kw(allocation.allocatedKW)} kW em recarga`;
    budget.textContent = `${kw(snapshot.demand.availableKW)} kW disponíveis para recarga · Limite da rede: ${kw(snapshot.demand.limitKW)} kW`;
    const labels = { idle: 'Sem recarga', paused: 'Aguardando potência', limited: 'Potência compartilhada', charging: 'Necessidade atendida' };
    for (const station of allocation.stations) {
      let row = grid.querySelector(`[data-energy-station="${station.stationId}"]`);
      if (!row) {
        row = document.createElement('div');
        row.className = 'energy-station';
        row.dataset.energyStation = station.stationId;
        row.innerHTML = '<div><span></span><strong></strong></div><progress max="1"></progress><small></small>';
        grid.appendChild(row);
      }
      row.querySelector('span').textContent = `Estação ${station.stationId}`;
      row.querySelector('strong').textContent = `${kw(station.allocatedKW)} kW`;
      const bar = row.querySelector('progress');
      bar.value = station.allocatedKW / station.maxPowerKW;
      bar.setAttribute('aria-label', `Potência da estação ${station.stationId}`);
      row.querySelector('small').textContent = labels[station.status];
      row.dataset.status = station.status;
    }
  },

  returnToStations(message) {
    this.cancelAuthorization();
    this.cancelarPix();
    window.PaymentController.cancelPayment();
    window.StationManager.selectedStationId = null;
    window.ChargingSimulator.sessionId = null;
    this.selectedVehicle = null;
    this.arrivalSoc = null;
    this._arrivalSocPorVeiculo = {};
    this._summaryShown = false;
    const panel = document.getElementById('vehicle-info-panel');
    if (panel) panel.style.display = 'none';
    document.getElementById('stations-message').textContent = message || 'Escolha uma estação livre ou toque em uma recarga para acompanhar.';
    this.showScreen('stations');
    this.renderStations();
    this.updateStationTariff();
    this.renderMqttControls();
  },

  /**
   * Antes de escolher o veículo não existe bateria nem SoC real pra estimar
   * custo/tempo — mostrar "--" ali só criava a impressão de um número que
   * ainda não é sabido. A única coisa real e já conhecida neste momento é a
   * tarifa vigente, então é só isso que a tela mostra.
   */
  updateStationTariff() {
    const el = document.getElementById('station-tariff');
    if (!el) return;
    const preco = window.PricingEngine.getCurrentRate();
    el.textContent = window.PricingEngine.formatCurrency(preco) + '/kWh';
  },

  renderVehicles() {
    const grid = document.getElementById('vehicle-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    window.MockData.vehicles.forEach(vehicle => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `vehicle-card ${this.selectedVehicle?.id === vehicle.id ? 'selected' : ''}`;
      card.setAttribute('aria-pressed', String(this.selectedVehicle?.id === vehicle.id));
      card.innerHTML = `
        <span class="vehicle-icon material-symbols-outlined">${vehicle.image}</span>
        <div class="vehicle-brand">${vehicle.brand}</div>
        <div class="vehicle-model">${vehicle.model}</div>
        <div class="vehicle-battery-info">${vehicle.batteryCapacity} kWh • ${vehicle.range} km</div>
      `;
      card.addEventListener('click', () => {
        this.selectVehicle(vehicle);
      });
      grid.appendChild(card);
    });
  },

  selectVehicle(vehicle) {
    this.selectedVehicle = vehicle;

    // O estado de carga na chegada é sorteado uma vez por veículo, não uma vez
    // por clique: antes, comparar dois carros e voltar para o primeiro mudava
    // a bateria dele na hora — o mesmo carro não pode chegar com níveis de
    // bateria diferentes só porque o motorista olhou outra opção no caminho.
    this._arrivalSocPorVeiculo = this._arrivalSocPorVeiculo || {};
    if (!(vehicle.id in this._arrivalSocPorVeiculo)) {
      this._arrivalSocPorVeiculo[vehicle.id] = this._randomArrivalSoc();
    }
    this.arrivalSoc = this._arrivalSocPorVeiculo[vehicle.id];
    this.targetSoc = 0.8;

    this.renderVehicles();
    this.showVehicleInfo(vehicle);
  },

  /**
   * Estado de carga na chegada, só para o "chip" visual da tela de veículo —
   * puramente cosmético (sem nenhuma leitura de estado do motor), por isso
   * roda local em vez de pedir pro servidor. Mesma distribuição de
   * server/sim/ev-physics.js randomArrivalSoc().
   */
  _randomArrivalSoc() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const value = 34 + z * 12;
    return Math.min(62, Math.max(8, Math.round(value))) / 100;
  },

  async showVehicleInfo(vehicle) {
    const request = this._estimateRequest = (this._estimateRequest || 0) + 1;
    const panel = document.getElementById('vehicle-info-panel');
    if (!panel) return;
    panel.style.display = 'block';

    // O painel com o botão de avançar nasce abaixo da grade de veículos. Sem
    // trazê-lo para a vista, o usuário clicava no carro e não via nada
    // acontecer nem como seguir adiante.
    requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      this.updateScrollCue();
    });

    const socInicial = this.arrivalSoc != null ? this.arrivalSoc : 0.2;
    const socAlvo = this.targetSoc != null ? this.targetSoc : 0.8;
    const station = window.StationManager.getSelectedStation();

    document.getElementById('vehicle-emoji').textContent = vehicle.image;
    document.getElementById('vehicle-selected-name').textContent = `${vehicle.brand} ${vehicle.model}`;
    document.getElementById('vehicle-selected-specs').textContent =
      `${vehicle.year} • ${vehicle.batteryCapacity} kWh • bateria em ${Math.round(socInicial * 100)}% na chegada`;

    const titulo = document.getElementById('calc-title');
    if (titulo) {
      titulo.textContent =
        `Simulação de Carregamento (${Math.round(socInicial * 100)}% → ${Math.round(socAlvo * 100)}%)`;
    }
    document.getElementById('calc-battery').textContent = vehicle.batteryCapacity + ' kWh';
    document.getElementById('calc-energy').textContent = 'calculando…';
    document.getElementById('calc-cost').textContent = 'calculando…';
    document.getElementById('calc-time').textContent = '';
    document.getElementById('calc-range').textContent = '';
    document.getElementById('calc-rate').textContent = '';

    // Estimativa pela curva real de carga, respeitando o limite de potência do
    // próprio veículo e as perdas de conversão — calculada no servidor.
    let estimativa;
    try { estimativa = await window.PricingEngine.calculateEstimate(
      socInicial * 100,
      vehicle.batteryCapacity,
      { vehicle: vehicle, stationId: station ? station.id : 1, targetSoc: socAlvo }
    ); } catch {
      if (request === this._estimateRequest && this.selectedVehicle === vehicle) document.getElementById('calc-cost').textContent = 'Estimativa indisponível. Confira a conexão e selecione o veículo novamente.';
      return;
    }

    // O motorista pode ter trocado de veículo enquanto a estimativa deste
    // ainda estava a caminho — não pisa numa tela que já mudou de assunto.
    if (request !== this._estimateRequest || this.selectedVehicle !== vehicle) return;

    const posto = window.TariffEngine.getPosto();
    const autonomia = Math.round(vehicle.range * (socAlvo - socInicial));

    document.getElementById('calc-energy').textContent = estimativa.estimatedEnergy.toFixed(1) + ' kWh';
    document.getElementById('calc-cost').textContent = window.PricingEngine.formatCurrency(estimativa.estimatedCost);
    document.getElementById('calc-time').textContent = estimativa.estimatedTime;
    document.getElementById('calc-range').textContent = '+ ' + autonomia + ' km';
    document.getElementById('calc-rate').textContent =
      window.PricingEngine.formatCurrency(estimativa.rate) + '/kWh · ' + window.TariffEngine.postoLabel(posto);
  },

  async initPaymentScreen() {
    const request = this._paymentRequest = (this._paymentRequest || 0) + 1;
    this._paymentReady = false;
    this._pixRequestKey = window.PaymentController.createRequestId();
    window.PaymentController.cancelPayment();
    const station = window.StationManager.getSelectedStation();

    // Populate summary in method selection
    document.getElementById('method-summary-station').textContent = station.name;
    if (document.getElementById('method-summary-vehicle') && this.selectedVehicle) {
      document.getElementById('method-summary-vehicle').textContent = `${this.selectedVehicle.brand} ${this.selectedVehicle.model}`;
    }
    document.getElementById('method-summary-cost').textContent = 'calculando…';

    // Show method selection, hide others
    this.showPaymentStep('method');

    // Reset selections
    document.querySelectorAll('.payment-method-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('btn-confirm-method').disabled = true;

    // Mesma estimativa mostrada na tela do veículo. A versão anterior fazia
    // `capacidade * 0,8`, que é 80% da bateria inteira e não a energia que
    // falta até os 80% — o valor saltava de uma tela para a outra.
    try {
      const estimate = await window.StationManager.getEstimate();
      if (request !== this._paymentRequest) return;
      if (!estimate) throw new Error('Selecione a estação e o veículo novamente.');
      const method = window.PaymentController.selectedMethod;
      window.PaymentController.startPayment({ station, estimate, vehicle: this.selectedVehicle });
      if (method) window.PaymentController.selectMethod(method);
      this._paymentReady = true;
      document.getElementById('btn-confirm-method').disabled = !method;
      document.getElementById('method-summary-cost').textContent = '~ ' + window.PricingEngine.formatCurrency(estimate.estimatedCost);
    } catch (error) {
      if (request !== this._paymentRequest) return;
      window.PaymentController.cancelPayment();
      document.getElementById('method-summary-cost').textContent = 'Estimativa indisponível. Volte e tente novamente.';
    }
  },

  showPaymentStep(step) {
    ['method', 'pending', 'pix', 'authorization', 'tap', 'tap-confirmed'].forEach(s => {
      const el = document.getElementById(`payment-step-${s}`);
      if (el) el.style.display = s === step ? 'flex' : 'none';
    });
  },

  /**
   * Fluxo real de Pix via Mercado Pago. Se o servidor (server/) não estiver
   * no ar ou sem token configurado, cai para a mesma tela honesta de
   * pendência usada pelo cartão — nunca finge um QR Code.
   */
  async startRealPix() {
    if (this._pixInFlight || !window.PaymentController.orderData?.estimate) return;
    this._pixInFlight = true;
    const generation = this._pixGeneration = (this._pixGeneration || 0) + 1;
    this._pararPollingPix?.();
    this.showPaymentStep('pix');
    document.getElementById('pix-loading').style.display = 'flex';
    document.getElementById('pix-content').style.display = 'none';
    document.getElementById('pix-erro').style.display = 'none';

    // Cobrança simbólica fixa; a estimativa de energia permanece separada.
    const valor = 1;
    const station = window.StationManager.getSelectedStation();

    try {
      const cobranca = await window.PixClient.criarCobranca({
        valor: valor,
        descricao: `ChargeGrid Hub — ${station ? station.name : 'recarga'}`,
        requestId: this._pixRequestKey,
        checkout: { stationId: station.id, vehicleId: this.selectedVehicle.id, startSoc: this.arrivalSoc, targetSoc: this.targetSoc }
      });

      if (generation !== this._pixGeneration) return;
      this._pixPaymentId = cobranca.paymentId;

      document.getElementById('pix-loading').style.display = 'none';
      document.getElementById('pix-content').style.display = 'flex';
      document.getElementById('pix-qr-img').src = `data:image/png;base64,${cobranca.qrCodeBase64}`;
      document.getElementById('pix-codigo').value = cobranca.qrCode || '';
      document.getElementById('pix-valor').textContent = window.PricingEngine.formatCurrency(cobranca.amount ?? valor);

      const statusEl = document.getElementById('pix-status');
      statusEl.textContent = cobranca.sandbox ? 'Pix de teste (sandbox): não representa pagamento real.' : 'Aguardando pagamento real de R$ 1,00…';
      statusEl.className = 'pix-status';

      this._pararPollingPix = window.PixClient.acompanharStatus(cobranca.paymentId, {
        onStatus: (status) => {
          if (generation !== this._pixGeneration) return false;
          if (status === 'approved') {
            statusEl.textContent = cobranca.sandbox ? 'Pagamento de teste aprovado — sem transferência real.' : 'Pagamento aprovado!';
            statusEl.className = 'pix-status aprovado';
            this.startMonitoring();
            return false;
          }
          if (status === 'cancelled' || status === 'rejected') {
            statusEl.textContent = 'Pagamento não concluído. Tente novamente.';
            return false;
          }
          return true;
        },
        onErro: (err) => {
          if (generation !== this._pixGeneration) return false;
          if (err.status === 404 || err.status === 400) {
            statusEl.textContent = 'Cobrança indisponível. Volte aos meios de pagamento; se já pagou, consulte o operador.';
            return false;
          }
          statusEl.textContent = 'Consulta temporariamente indisponível. Tentando novamente…';
        }
      });
    } catch (err) {
      if (generation !== this._pixGeneration) return;
      document.getElementById('pix-loading').style.display = 'none';
      document.getElementById('pix-erro').style.display = 'block';
      document.getElementById('pix-erro-texto').textContent = err.message;
    } finally {
      if (generation === this._pixGeneration) this._pixInFlight = false;
    }
  },

  cancelarPix() {
    this._pixGeneration = (this._pixGeneration || 0) + 1;
    this._pixInFlight = false;
    if (this._pararPollingPix) {
      this._pararPollingPix();
      this._pararPollingPix = null;
    }
    this._pixPaymentId = null;
  },

  /**
   * Encaminha para a tela que declara a integração de pagamento como pendente.
   * Não há QR Code nem maquininha: encenar uma integração bancária que não foi
   * construída é frágil diante de qualquer pergunta da banca.
   */
  showPaymentPending() {
    this.showPaymentStep('pending');

    const nomes = { pix: 'Pix', debit: 'Cartão de débito', credit: 'Cartão de crédito' };
    const metodo = window.PaymentController.selectedMethod;
    document.getElementById('pending-method').textContent = nomes[metodo] || 'não informado';

    const estimativa = window.PaymentController.orderData ? window.PaymentController.orderData.estimate : null;
    document.getElementById('pending-amount').textContent = estimativa
      ? window.PricingEngine.formatCurrency(estimativa.estimatedCost)
      : '—';
  },

  startMonitoring() {
    if (this._awaitingAuthorization) return;
    const station = window.StationManager.getSelectedStation();
    if (!station || !this.selectedVehicle) return;
    this._awaitingAuthorization = true;
    this._authorizationReady = false;
    window.MqttBridge.ativar();
    this.showPaymentStep('authorization');
    document.getElementById('authorization-status').textContent = 'Solicitando autorização…';
    document.getElementById('btn-retry-authorization').hidden = true;
    const sent = window.ChargingSimulator.startSession(
      station.id,
      this.selectedVehicle ? this.selectedVehicle.batteryCapacity : 60,
      {
        vehicle: this.selectedVehicle,
        startSoc: this.arrivalSoc,
        targetSoc: this.targetSoc,
        paymentMethod: this._pixPaymentId ? 'pix' : 'demo',
        paymentId: this._pixPaymentId
      }
    );

    if (!sent) this.onAuthorization({ status: 'error', message: 'Servidor desconectado. Aguarde a conexão e tente novamente.' });
    this.renderMqttControls();
  },

  cancelAuthorization() {
    if (this._awaitingAuthorization) window.SimClient.send('cancel-authorization');
    this._awaitingAuthorization = false;
    this._authorizationReady = false;
    this.renderMqttControls();
  },

  onAuthorization(data) {
    if (data.status === 'stopped' && this.currentScreen === 'monitoring') {
      if (data.sessionId !== window.ChargingSimulator.sessionId) return;
      window.MqttBridge.registrar('Recarga encerrada pelo comando DESLIGAR.');
      this.showSummaryModal();
      return;
    }
    if (!this._awaitingAuthorization) return;
    if (data.status === 'approved') {
      this._awaitingAuthorization = false;
      this._authorizationReady = false;
      this.returnToStations('Recarga iniciada. Toque na sua estação para acompanhar ou escolha outra estação livre.');
      this.renderMqttControls();
      return;
    }
    document.getElementById('authorization-status').textContent = data.message || 'Aguardando autorização…';
    this._authorizationReady = data.status === 'waiting';
    if (data.status !== 'waiting') {
      this._awaitingAuthorization = false;
      document.getElementById('btn-retry-authorization').hidden = false;
    }
    this.renderMqttControls();
  },

  initMqttControls() {
    document.querySelectorAll('[data-mqtt-command]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        if (button.dataset.mqttCommand === 'LIGAR') window.MqttBridge.autorizarCarga();
        else window.MqttBridge.cortarCarga();
      });
    });
    window.MqttBridge.onCommand(command => {
      // Só o recebimento MQTT, nunca o clique, pede liberação ao servidor.
      if ((this._awaitingAuthorization && this._authorizationReady) || this.currentScreen === 'monitoring') {
        window.SimClient.send('mqtt-command', { command, sessionId: window.ChargingSimulator.sessionId });
      }
    });
    window.MqttBridge.onUpdate(state => {
      if ((!state.ativo || !state.conectado) && this._awaitingAuthorization && this._authorizationReady) {
        this.cancelAuthorization();
        document.getElementById('authorization-status').textContent = 'Conexão MQTT indisponível. Reconecte e tente novamente.';
        document.getElementById('btn-retry-authorization').hidden = false;
      }
      this.renderMqttControls();
    });
    window.MqttBridge.ativar();
    this.renderMqttControls();
  },

  renderMqttControls() {
    const state = window.MqttBridge.snapshot();
    const ready = state.ativo && state.conectado;
    document.querySelectorAll('[data-mqtt-status]').forEach(el => {
      el.textContent = ready ? 'MQTT conectado' : 'MQTT desconectado';
      el.classList.toggle('text-success', Boolean(ready));
    });
    document.querySelectorAll('[data-mqtt-command]').forEach(button => {
      button.disabled = !ready || (button.dataset.mqttCommand === 'LIGAR'
        ? !this._authorizationReady
        : !(this._authorizationReady || (this.currentScreen === 'monitoring' && !this._summaryShown && window.ChargingSimulator.getSnapshotSession()?.evse.stationId === 1)));
    });
    document.querySelectorAll('[data-mqtt-log]').forEach(el => {
      el.textContent = state.log.map(entry => `[${entry.time}] ${entry.message}`).join('\n') || 'Aguardando conexão MQTT…';
      el.scrollTop = el.scrollHeight;
    });
  },

  openMonitoring(sessionId) {
    const session = window.SimClient.snapshot?.sessions.find(s => s.id === sessionId);
    if (!session) return;
    this._summaryShown = false;
    window.StationManager.selectedStationId = session.evse.stationId;
    this.selectedVehicle = session.vehicle;
    this.showScreen('monitoring');
    document.getElementById('monitoring-title').textContent = `Estação ${String(session.evse.stationId).padStart(2, '0')}`;
    document.getElementById('monitoring-vehicle').textContent = `${session.vehicle.brand} ${session.vehicle.model}`;
    window.ChargingSimulator.selectSession(session.id);
    this.renderMqttControls();

    this.renderSessionEndControls();

    if (window.SimClient.snapshot) {
      this.updateDemandBanner(window.SimClient.snapshot);
      this.updateSiteStrip(window.SimClient.snapshot);
    }
  },

  /**
   * Tempo decorrido para exibição. Acima de uma hora, "78m 45s" vira
   * ilegível rápido demais — passa a mostrar a hora separada.
   */
  formatElapsed(totalSeconds) {
    const total = Math.floor(totalSeconds);
    const secs = total % 60;
    const totalMinutes = Math.floor(total / 60);
    const mins = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    return hours > 0 ? `${hours}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
  },

  updateMonitoringUI(data) {
    document.getElementById('mon-percent').textContent = Math.floor(data.batteryLevel) + '%';
    document.getElementById('mon-power').textContent = data.currentPower.toFixed(1) + ' kW';
    document.getElementById('stat-energy').textContent = data.energyDelivered.toFixed(2) + ' kWh';
    document.getElementById('stat-time').textContent = this.formatElapsed(data.timeElapsed);
    document.getElementById('stat-cost').textContent = window.PricingEngine.formatCurrency(data.currentCost);

    const status = document.getElementById('stat-status');
    if (status) {
      const stationId = window.ChargingSimulator.getSnapshotSession()?.evse.stationId;
      const limitado = window.SimClient.snapshot?.demand.allocation?.stations.some(s => s.stationId === stationId && s.status === 'limited');
      if (data.status === 'suspended') {
        status.textContent = 'Suspenso';
        status.className = 'stat-value text-danger';
      } else if (data.status === 'completed') {
        status.textContent = 'Concluída';
        status.className = 'stat-value text-success';
      } else if (limitado) {
        status.textContent = 'Limitado';
        status.className = 'stat-value text-warning';
      } else {
        status.textContent = 'Carregando';
        status.className = 'stat-value text-success';
      }
    }

    document.getElementById('stat-current').textContent =
      `${data.commandedA} A` + (data.currentA ? ` · ${data.currentA.toFixed(1)} A medidos` : '');
    document.getElementById('stat-price').textContent =
      window.PricingEngine.formatCurrency(window.PricingEngine.getCurrentRate()) + '/kWh';
    document.getElementById('stat-target').textContent = Math.round((data.socTarget || 0.8) * 100) + '%';

    const sessao = window.ChargingSimulator.getSnapshotSession();
    document.getElementById('stat-remaining').textContent = sessao
      ? window.PricingEngine.formatDuration(sessao.minutesRemaining)
      : '—';

    const circle = document.querySelector('.progress-ring-fill');
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    circle.style.strokeDashoffset = circumference - (data.batteryLevel / 100) * circumference;

    this.renderSessionEndControls();
  },

  renderSessionEndControls() {
    const session = window.ChargingSimulator.getSnapshotSession();
    const disabled = !window.SimClient.connected || !session || this._summaryShown;
    const completed = session?.status === 'finished';
    const bottom = document.getElementById('btn-end-charge');
    const top = document.getElementById('btn-stop-charge');
    bottom.disabled = top.disabled = Boolean(disabled);
    bottom.textContent = completed ? 'Ver resumo e liberar estação' : 'Encerrar Carregamento';
    top.textContent = completed ? 'Ver resumo e liberar estação' : 'DESLIGAR · Encerrar recarga';
  },

  /** Banner do Controle Dinâmico de Demanda. */
  updateDemandBanner(snapshot) {
    const banner = document.getElementById('demand-banner');
    if (!banner) return;

    const d = snapshot.demand;
    const sessao = window.ChargingSimulator.getSnapshotSession(snapshot);
    const evse = sessao ? sessao.evse : snapshot.evses.find(e => e.id === 1);

    banner.classList.remove('state-atencao', 'state-limitando', 'state-suspenso');

    // A mensagem descreve a sessão de quem está diante do tótem, não o estado
    // agregado do eletroposto: outra vaga pode estar suspensa enquanto esta
    // segue carregando normalmente.
    const suspensa = sessao && sessao.status === 'suspended';
    const limitada = sessao && !suspensa && d.allocation?.stations.some(s => s.stationId === evse.stationId && s.status === 'limited');
    const alerta = !suspensa && !limitada && (d.state === 'ATENCAO' || d.state === 'LIMITANDO');

    if (!suspensa && !limitada && !alerta) {
      banner.classList.remove('visible');
      return;
    }

    banner.classList.add('visible');
    const icone = document.getElementById('demand-icon');
    const titulo = document.getElementById('demand-title');
    const detalhe = document.getElementById('demand-detail');
    const delta = document.getElementById('demand-delta');

    if (suspensa) {
      banner.classList.add('state-suspenso');
      icone.textContent = 'pause_circle';
      titulo.textContent = 'Recarga pausada pelo controle de demanda';
      delta.textContent = 'retoma em breve';
    } else if (limitada) {
      banner.classList.add('state-limitando');
      icone.textContent = 'bolt';
      titulo.textContent = 'Controle de Demanda atuando nesta vaga';
      delta.textContent = `${evse.iMax} A → ${evse.commandedA} A`;
    } else {
      banner.classList.add('state-atencao');
      icone.textContent = 'warning';
      titulo.textContent = 'Demanda do prédio próxima do contrato';
      delta.textContent = `${d.projectedWindowKW.toFixed(0)} / ${d.limitKW.toFixed(0)} kW`;
    }

    detalhe.textContent =
      `Consumo do prédio em ${snapshot.site.netKW.toFixed(1)} kW · ` +
      `janela de 15 min projetada em ${d.projectedWindowKW.toFixed(1)} kW de ${d.limitKW.toFixed(1)} kW contratados`;
  },

  /** Barra de demanda do estabelecimento contra o limite contratado. */
  updateSiteStrip(snapshot) {
    const valor = document.getElementById('site-strip-value');
    if (!valor) return;

    const escala = window.SiteConfig.contractedDemandKW;
    const predio = snapshot.site.netKW;
    const ev = Math.max(0, snapshot.site.evKW - snapshot.site.surplusKW);

    document.getElementById('seg-building').style.width = Math.min(100, (predio / escala) * 100) + '%';
    document.getElementById('seg-ev').style.width = Math.min(100, (ev / escala) * 100) + '%';
    document.getElementById('site-limit-mark').style.left =
      (snapshot.demand.limitKW / escala) * 100 + '%';

    valor.innerHTML =
      `<strong>${(predio + ev).toFixed(1)} kW</strong> de ${escala.toFixed(0)} kW contratados`;

    const nota = document.getElementById('site-solar-note');
    if (nota) {
      nota.textContent = snapshot.site.surplusKW > 0.1
        ? `Solar ${snapshot.site.solarKW.toFixed(1)} kW · ${snapshot.site.surplusKW.toFixed(1)} kW de excedente`
        : `Solar ${snapshot.site.solarKW.toFixed(1)} kW abatendo o consumo`;
    }
  },

  showSummaryModal() {
    // A tela de monitoramento dispara a cada tick; sem esta guarda o resumo
    // seria reaberto (e a sessão encerrada de novo) a cada atualização.
    if (this._summaryShown) return;
    const data = window.ChargingSimulator.stopSession();
    if (!data) return;
    this._summaryShown = true;
    this.renderMqttControls();
    this.renderSessionEndControls();
    // O relé físico pertence à estação 1. O corte direto também cobre a
    // reconexão do navegador, que não é mais o dono original do WebSocket.
    if (data.evse?.stationId === 1) window.MqttBridge.aplicarComandoRele('DESLIGAR');
    const station = window.StationManager.getSelectedStation();
    window.StationManager.updateStationStatus(station.id, 'available');

    document.getElementById('modal-station').textContent = station.name;
    document.getElementById('modal-time').textContent = this.formatElapsed(data.timeElapsed);
    document.getElementById('modal-energy').textContent = data.energyDelivered.toFixed(2) + ' kWh';
    document.getElementById('modal-battery').textContent = (data.energyBattery || 0).toFixed(2) + ' kWh';
    document.getElementById('modal-cost').textContent = window.PricingEngine.formatCurrency(data.currentCost);

    this.renderSegments(data.rateSegments || []);
    document.getElementById('summary-modal').classList.add('active');
  },

  /**
   * Faixas de preço atravessadas pela recarga. Uma sessão que cruza as 18h é
   * faturada em dois postos, como numa conta de energia de verdade.
   */
  renderSegments(segments) {
    const alvo = document.getElementById('modal-segments');
    if (!alvo) return;

    if (!segments.length) {
      alvo.innerHTML = '';
      return;
    }

    alvo.innerHTML = segments.map(seg => {
      const medio = seg.kWh > 0 ? seg.cost / seg.kWh : 0;
      return `
        <div class="tariff-row">
          <span class="label">
            <span class="posto-badge posto-${seg.posto}">${window.TariffEngine.postoLabel(seg.posto)}</span>
            ${seg.kWh.toFixed(2)} kWh a ${window.PricingEngine.formatCurrency(medio)}/kWh
          </span>
          <span class="value">${window.PricingEngine.formatCurrency(seg.cost)}</span>
        </div>
      `;
    }).join('');
  },

  hideModal() {
    document.getElementById('summary-modal').classList.remove('active');
  },

  resetApp() {
    this.cancelAuthorization();
    this.cancelarPix();
    window.StationManager.selectedStationId = null;
    this.selectedVehicle = null;
    const panel = document.getElementById('vehicle-info-panel');
    if (panel) panel.style.display = 'none';

    this.arrivalSoc = null;
    this._arrivalSocPorVeiculo = {};
    this._summaryShown = false;

    const banner = document.getElementById('demand-banner');
    if (banner) banner.classList.remove('visible');

    this.updateWelcomeScreen();
    this.showScreen('welcome');
  }
};

window.addEventListener('DOMContentLoaded', () => {
  window.App.init();
});
