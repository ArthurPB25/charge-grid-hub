/**
 * Cliente WebSocket do motor de simulação — usado pelo totem e pelo admin.
 *
 * O motor agora roda só no servidor (server/sim/*), como uma única instância
 * compartilhada. Este arquivo substitui o antigo `window.SimEngine` local:
 * conecta por WebSocket, cacheia o último snapshot recebido e expõe métodos
 * pra quem quiser ler o estado ao vivo ou mandar comandos.
 *
 * Segue o mesmo padrão de descoberta de host do js/pix-client.js — o
 * endereço acompanha o hostname da própria página, não fica fixo em
 * "localhost", pra funcionar quando o totem abre a partir do IP de outro
 * dispositivo na rede.
 */
window.SimClient = {
  ws: null,
  snapshot: null,
  _snapshotListeners: [],
  _protocolListeners: [],
  _relayListeners: [],
  _authorizationListeners: [],
  _connectionListeners: [],
  _tapWatchRequests: new Map(),
  _tapWatchSequence: 0,
  connected: false,
  _reconnectDelay: 1000,

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return this;
    const url = window.ChargeGridConfig.wsUrl;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this._reconnectDelay = 1000;
      // Wait for a fresh snapshot before enabling operations after reconnect.
    });
    this.ws.addEventListener('message', e => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this._onMessage(msg);
    });
    this.ws.addEventListener('close', () => {
      this._connectionChanged(false);
      for (const fn of this._authorizationListeners) fn({ status: 'error', message: 'Conexão com o servidor perdida. Tente novamente após reconectar.' });
      this._scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {});

    return this;
  },

  _scheduleReconnect() {
    setTimeout(() => this.connect(), this._reconnectDelay);
    this._reconnectDelay = Math.min(10000, this._reconnectDelay * 2);
  },

  _onMessage(msg) {
    if (msg.type === 'snapshot') {
      this.snapshot = msg.data;
      if (!this.connected) this._connectionChanged(true);
      for (const fn of this._snapshotListeners) fn(this.snapshot);
    } else if (msg.type === 'ocpp-frame' || msg.type === 'modbus-write') {
      for (const fn of this._protocolListeners) fn(msg);
    } else if (msg.type === 'relay') {
      for (const fn of this._relayListeners) fn(msg.command);
    } else if (msg.type === 'authorization') {
      for (const fn of this._authorizationListeners) fn(msg.data);
    } else if (msg.type === 'tap-demo:watched') {
      const pending = this._tapWatchRequests.get(msg.data?.requestId);
      if (pending && pending.id === msg.data?.id) pending.finish();
    }
  },

  /** Chamado a cada snapshot novo. Se já houver um em cache, dispara na hora. */
  onSnapshot(fn) {
    this._snapshotListeners.push(fn);
    if (this.snapshot) fn(this.snapshot);
  },

  onProtocol(fn) {
    this._protocolListeners.push(fn);
  },

  onRelay(fn) {
    this._relayListeners.push(fn);
  },

  onAuthorization(fn) {
    this._authorizationListeners.push(fn);
  },

  onConnection(fn) {
    this._connectionListeners.push(fn);
    fn(this.connected);
  },

  _connectionChanged(connected) {
    this.connected = connected;
    if (!connected) for (const pending of [...this._tapWatchRequests.values()]) pending.finish(new Error('Totem desconectado. Reconecte e toque em Conectar novamente, sem pagar outra vez.'));
    for (const fn of this._connectionListeners) fn(connected);
  },

  watchTapOrder(id, token) {
    if (!this.connected) return Promise.reject(new Error('Reconecte o totem antes de iniciar o ESP. O pagamento foi preservado.'));
    const requestId = 'tap-' + (++this._tapWatchSequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('O servidor não confirmou a conexão do totem. Tente Conectar novamente, sem pagar outra vez.')), 5000);
      const finish = error => {
        clearTimeout(timer); this._tapWatchRequests.delete(requestId);
        if (error) reject(error); else resolve();
      };
      this._tapWatchRequests.set(requestId, { id, finish });
      if (!this.send('tap-demo:watch', { id, token, requestId })) finish(new Error('Totem desconectado. O pagamento foi preservado.'));
    });
  },

  waitForTapSession(sessionId) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this._snapshotListeners = this._snapshotListeners.filter(fn => fn !== inspect);
        this._connectionListeners = this._connectionListeners.filter(fn => fn !== connection);
      };
      const inspect = snapshot => {
        const session = snapshot?.sessions?.find(s => s.id === sessionId && s.evse.stationId === 1);
        if (session) { cleanup(); resolve(session); }
      };
      const connection = connected => { if (!connected) { cleanup(); reject(new Error('Conexão com o totem perdida. Tente Conectar novamente, sem pagar outra vez.')); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Aguardando o estado atualizado da estação. Toque em Conectar novamente, sem pagar outra vez.')); }, 5000);
      this._snapshotListeners.push(inspect); this._connectionListeners.push(connection);
      if (!this.connected) connection(false); else inspect(this.snapshot);
    });
  },

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[SimClient] WebSocket não conectado, comando descartado:', type);
      return false;
    }
    try {
      this.ws.send(JSON.stringify(payload ? { type, payload } : { type }));
      return true;
    } catch {
      this._connectionChanged(false);
      return false;
    }
  }
};
