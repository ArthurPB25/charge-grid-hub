window.TapDemo = {
  order: null, timer: null, busy: false, revision: 0,
  async request(path, options = {}) {
    const response = await fetch('/api/tap-demo' + path, { ...options, signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.erro || 'Falha na comunicação com o celular.'), { status: response.status });
    return data;
  },
  async begin() {
    if (this.busy) return;
    if (this.order) { this.display(); return; }
    this.busy = true;
    try {
      const health = await this.request('/health');
      this.terminalMode = Boolean(health.terminalEnabled);
      if (!health.enabled) { window.App.showPaymentPending(); return; }
      const station = window.StationManager.getSelectedStation(), app = window.App;
      const request = app._paymentRequest;
      const payload = JSON.stringify({ stationId: station.id, vehicleId: app.selectedVehicle.id,
        startSoc: app.arrivalSoc, targetSoc: app.targetSoc, method: window.PaymentController.selectedMethod });
      if (this.keyPayload !== payload || !this.requestKey) { this.keyPayload = payload; this.requestKey = window.PaymentController.createRequestId(); }
      const data = await this.request('/orders', { method: 'POST',
        headers: { 'Idempotency-Key': this.requestKey }, body: payload });
      this.order = data;
      localStorage.setItem('chargegrid-tap-order', JSON.stringify(data));
      if (request !== app._paymentRequest || app.currentScreen !== 'payment') { await this.cancel(); return; }
      window.MqttBridge?.ativar();
      this.display(); this.poll();
    } catch (e) { alert(e.message); }
    finally { this.busy = false; }
  },
  physicalPending(order = this.order) { return order?.stationId === 1 && order.state === 'released'; },
  display() {
    const canConnect = this.order.state === 'paid' || this.physicalPending();
    window.App.showScreen('payment'); window.App.showPaymentStep(canConnect ? 'tap-confirmed' : 'tap');
    const manual = document.getElementById('tap-manual-connection');
    if (manual) manual.hidden = Boolean(this.terminalMode);
    document.getElementById('tap-code').textContent = this.order.code;
    document.getElementById('tap-paid-station').textContent = `Estação ${this.order.stationId} · ${this.order.vehicle}`;
    document.getElementById('tap-order-station').textContent = `Estação ${this.order.stationId} · ${this.order.vehicle}`;
    if (this.order.lockedRate != null) document.getElementById('tap-order-station').textContent += ` · Energia estimada a R$ ${this.order.lockedRate.toFixed(2).replace('.', ',')}/kWh, preço preservado`;
    document.getElementById('tap-address').textContent = location.origin.includes('localhost') || location.hostname === '127.0.0.1'
      ? 'No celular, use http://IP-DO-COMPUTADOR:' + (location.port || '80') + ' na mesma rede Wi-Fi.' : location.origin;
    document.getElementById('tap-connect').hidden = !canConnect;
    document.getElementById('tap-order-status').textContent = this.order.state === 'review' ? this.order.message : this.order.state === 'paid'
      ? 'Pagamento recebido. Conecte o cabo ao veículo e toque em Conectar para iniciar a recarga.' : this.terminalMode
      ? 'Aproxime seu cartão do celular do estabelecimento quando o InfinitePay solicitar. Valor: R$ 1,00.'
      : 'Aguardando o celular. Informe o endereço do servidor e este código no app ChargeGrid.';
  },
  async connect() {
    if (this.busy || !(this.order?.state === 'paid' || this.physicalPending())) return;
    this.busy = this.connecting = true;
    const order = this.order, revision = this.revision;
    const button = document.getElementById('tap-connect'); button.disabled = true;
    try {
      if (order.stationId === 1) {
        window.MqttBridge?.ativar();
        if (!window.MqttBridge?.prontoParaIniciarCarga()) throw new Error('MQTT indisponível ou desligamento anterior pendente. Aguarde a reconexão e tente Conectar novamente. O pagamento foi preservado.');
        if (!window.MqttBridge.prepararNovaRecarga()) throw new Error('Aguarde o desligamento anterior do ESP. O pagamento foi preservado.');
        await window.SimClient.watchTapOrder(order.id, order.token);
      } else {
        window.SimClient.send('tap-demo:watch', { id: order.id, token: order.token });
      }
      if (revision !== this.revision || this.order?.id !== order.id) return;
      if (order.stationId === 1 && !window.MqttBridge.prontoParaIniciarCarga()) throw new Error('Conexão MQTT perdida. Reconecte e toque em Conectar novamente. O pagamento foi preservado.');
      const data = await this.request(`/orders/${order.id}/connect`, { method: 'POST', headers: { 'X-Tap-Token': order.token } });
      if (revision !== this.revision || this.order?.id !== order.id) return;
      if (data.state === 'released') {
        if (order.stationId === 1) {
          this.order = { ...order, ...data };
          localStorage.setItem('chargegrid-tap-order', JSON.stringify(this.order));
          if (!data.physical?.active) throw new Error('Esta recarga já foi encerrada. Confira a estação e o histórico; não pague novamente.');
          const session = await window.SimClient.waitForTapSession(data.sessionId);
          if (revision !== this.revision || this.order?.id !== order.id) return;
          const permitted = () => {
            const current = window.SimClient.snapshot?.sessions?.find(s => s.id === data.sessionId && s.evse.stationId === 1);
            return revision === this.revision && this.order?.id === order.id && window.SimClient.connected
              && current?.status !== 'finished' && current?.evse.commandedA > 0;
          };
          if (session.status === 'finished') throw new Error('Esta recarga já foi encerrada. Confira a estação e o histórico; não pague novamente.');
          if (data.physical.command !== 'LIGAR' || !permitted()) throw new Error('Recarga aguardando potência disponível. Tente Conectar novamente quando a estação for liberada, sem pagar outra vez.');
          await window.MqttBridge.iniciarCargaPaga(permitted);
          if (revision !== this.revision || this.order?.id !== order.id) return;
        }
        this.forget(); window.App.returnToStations(order.stationId === 1 ? 'Comando de início enviado ao ESP. Toque na estação para conferir o acompanhamento.' : 'Recarga iniciada após sua confirmação.');
      }
    } catch (e) { if (this.order?.id === order.id) document.getElementById('tap-connect-status').textContent = e.message; }
    finally { this.busy = this.connecting = false; button.disabled = false; }
  },
  restore() {
    try { this.order = JSON.parse(localStorage.getItem('chargegrid-tap-order')); } catch { localStorage.removeItem('chargegrid-tap-order'); }
    if (this.order) {
      window.MqttBridge?.ativar(); this.display(); this.poll();
      this.request('/health').then(health => { if (this.order) { this.terminalMode = Boolean(health.terminalEnabled); this.display(); } }).catch(() => {});
    }
  },
  forget() { this.revision++; clearTimeout(this.timer); this.order = null; this.requestKey = null; localStorage.removeItem('chargegrid-tap-order'); },
  recoverMissing() {
    this.forget();
    window.App.returnToStations('Este pedido não está mais disponível no servidor. O acompanhamento local foi encerrado; isso não cancela nem estorna um pagamento. Confira o InfinitePay ou procure o operador antes de pagar novamente.');
  },
  async cancel() {
    const order = this.order, revision = this.revision;
    if (!order) return;
    try {
      const data = await this.request(`/orders/${order.id}/cancel`, { method: 'POST', headers: { 'X-Tap-Token': order.token } });
      if (revision !== this.revision || this.order?.id !== order.id) return;
      if (['paid', 'review'].includes(data.state)) { this.order = { ...order, ...data }; this.display(); return; }
      this.forget();
      window.App.returnToStations(data.state === 'released' ? 'Recarga já iniciada. Confira a estação.' : 'Pedido encerrado. Cancelar o pedido não estorna um pagamento no InfinitePay.');
    } catch (e) {
      if (revision !== this.revision || this.order?.id !== order.id) return;
      if (e.status === 404) { this.recoverMissing(); return; }
      document.getElementById('tap-order-status').textContent = e.message + ' Não foi possível encerrar o pedido. O acompanhamento continua; confira o InfinitePay antes de pagar novamente.';
    }
  },
  async poll() {
    const order = this.order, revision = this.revision;
    if (!order || this.connecting) return;
    window.SimClient.send('tap-demo:watch', { id: order.id, token: order.token });
    try {
      const data = await this.request(`/orders/${order.id}`, { headers: { 'X-Tap-Token': order.token } });
      if (revision !== this.revision || this.order?.id !== order.id || this.connecting) return;
      if (data.state === 'released') {
        if (order.stationId === 1) {
          this.order = { ...order, ...data }; localStorage.setItem('chargegrid-tap-order', JSON.stringify(this.order));
          this.display();
          document.getElementById('tap-connect-status').textContent = 'Pedido pago preservado. Toque em Conectar para concluir o envio ao ESP, sem pagar novamente.';
          return;
        }
        this.forget(); window.App.returnToStations('Recarga iniciada por retorno local do InfiniteTap · demonstração R$ 1,00.'); return;
      }
      if (data.state === 'paid') {
        this.order = { ...order, ...data };
        localStorage.setItem('chargegrid-tap-order', JSON.stringify(this.order));
        this.display();
        return;
      }
      if (data.state === 'review') {
        this.order = { ...order, ...data };
        localStorage.setItem('chargegrid-tap-order', JSON.stringify(this.order));
        this.display();
      }
      if (!['pending', 'review'].includes(data.state)) {
        const message = data.message || 'Pedido encerrado ou expirado. Confira o InfinitePay antes de pagar novamente.';
        this.forget(); window.App.returnToStations(message); return;
      }
    } catch (e) {
      if (revision !== this.revision || this.order?.id !== order.id || this.connecting) return;
      if (e.status === 404) { this.recoverMissing(); return; }
      document.getElementById('tap-order-status').textContent = e.message + ' Tentando consultar novamente; não repita o pagamento.';
    }
    if (revision === this.revision) this.timer = setTimeout(() => this.poll(), 1500);
  }
};
