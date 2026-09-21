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
  _reconnectDelay: 1000,

  connect() {
    const url = `ws://${window.location.hostname}:3001/ws`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this._reconnectDelay = 1000;
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
    this.ws.addEventListener('close', () => this._scheduleReconnect());
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
      for (const fn of this._snapshotListeners) fn(this.snapshot);
    } else if (msg.type === 'ocpp-frame' || msg.type === 'modbus-write') {
      for (const fn of this._protocolListeners) fn(msg);
    } else if (msg.type === 'relay') {
      for (const fn of this._relayListeners) fn(msg.command);
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

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[SimClient] WebSocket não conectado, comando descartado:', type);
      return;
    }
    this.ws.send(JSON.stringify(payload ? { type, payload } : { type }));
  }
};
