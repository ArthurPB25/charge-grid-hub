/**
 * Ponte MQTT entre o site e o ESP32 real.
 *
 * O núcleo de simulação (SimEngine, DemandController) continua rodando
 * inteiramente em software — é ele quem decide preço, aloca corrente entre
 * sessões, projeta a janela de demanda. Esta ponte é a camada extra que faz
 * uma dessas decisões virar um evento físico de verdade: quando o motorista
 * inicia ou perde a recarga, um comando real trafega por MQTT até o ESP32,
 * que fecha ou abre um relé de verdade.
 *
 * Como um relé só liga ou desliga (não existe "meio-termo"), o hardware real
 * só expressa o corte binário do controle de demanda — sessão autorizada
 * (relé fechado) ou suspensa (relé aberto). A granularidade fina de
 * corrente (32A, 18A, 16A...) continua existindo só no software, como o
 * "gêmeo digital" de um sistema comercial completo.
 *
 * Broker público broker.emqx.io — validado por teste real antes de integrar
 * aqui (ver scratchpad/test-mqtt.js da sessão de desenvolvimento).
 */
window.MqttBridge = {
  url: 'wss://broker.emqx.io:8084/mqtt',
  topicoComando: 'meu_projeto/tomada/comando',
  topicoStatus: 'meu_projeto/tomada/status',

  client: null,
  conectado: false,
  ativo: false, // liga/desliga a ponte inteira — só publica quando true
  ultimoStatusHardware: null, // o que o ESP32 realmente reportou por último

  _listeners: [],

  /** Liga a ponte: conecta ao broker e passa a espelhar o hardware real. */
  ativar() {
    if (this.client) {
      this.ativo = true;
      this._notificar();
      return;
    }

    if (typeof mqtt === 'undefined') {
      console.error('[MqttBridge] Biblioteca mqtt.js não carregada. Verifique o <script> no HTML.');
      return;
    }

    this.client = mqtt.connect(this.url, { connectTimeout: 8000, reconnectPeriod: 4000 });

    this.client.on('connect', () => {
      this.conectado = true;
      this.client.subscribe(this.topicoStatus);
      this._notificar();
    });

    this.client.on('reconnect', () => {
      this.conectado = false;
      this._notificar();
    });

    this.client.on('close', () => {
      this.conectado = false;
      this._notificar();
    });

    this.client.on('message', (topic, payload) => {
      if (topic === this.topicoStatus) {
        this.ultimoStatusHardware = payload.toString();
        this._notificar();
      }
    });

    this.client.on('error', err => {
      console.error('[MqttBridge] erro de conexão:', err.message);
    });

    this.ativo = true;
    this._notificar();
  },

  /** Desliga a ponte. Publica DESLIGAR antes de sair, por segurança. */
  desativar() {
    if (this.ativo && this.conectado) {
      this._publicar('DESLIGAR');
    }
    this.ativo = false;
    this._notificar();
  },

  toggle() {
    if (this.ativo) this.desativar();
    else this.ativar();
    return this.ativo;
  },

  /** Chamado pelo motor de simulação quando uma sessão real deveria energizar o relé. */
  autorizarCarga() {
    if (this.ativo) this._publicar('LIGAR');
  },

  /** Chamado quando a sessão termina ou é suspensa pelo controle de demanda. */
  cortarCarga() {
    if (this.ativo) this._publicar('DESLIGAR');
  },

  _publicar(comando) {
    if (!this.client || !this.conectado) return;
    this.client.publish(this.topicoComando, comando);
  },

  onUpdate(fn) {
    if (typeof fn === 'function') this._listeners.push(fn);
  },

  _notificar() {
    const snap = this.snapshot();
    for (const fn of this._listeners) {
      try { fn(snap); } catch (err) { console.error('[MqttBridge] observador falhou:', err); }
    }
  },

  snapshot() {
    return {
      ativo: this.ativo,
      conectado: this.conectado,
      statusHardware: this.ultimoStatusHardware
    };
  }
};
