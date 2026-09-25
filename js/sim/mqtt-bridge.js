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
  topicoRele: 'meu_projeto/tomada/rele',
  topicoStatus: 'meu_projeto/tomada/status',

  client: null,
  conectado: false,
  ativo: false, // liga/desliga a ponte inteira — só publica quando true
  ultimoStatusHardware: null, // o que o ESP32 realmente reportou por último

  _listeners: [],
  _commandListeners: [],
  log: [],

  registrar(message) {
    this.log.push({ time: new Date().toLocaleTimeString('pt-BR'), message });
    if (this.log.length > 40) this.log.shift();
    this._notificar();
  },

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

    this.client = mqtt.connect(this.url, { connectTimeout: 8000, reconnectPeriod: 4000, clean: true, queueQoSZero: false });
    this.registrar('Conectando ao broker MQTT…');

    this.client.on('connect', () => {
      this.client.subscribe([this.topicoStatus, this.topicoComando], { qos: 0 }, (err, grants) => {
        this.conectado = !err && this.client.connected && grants?.some(g => g.topic === this.topicoComando && g.qos !== 128);
        this.registrar(this.conectado ? 'Conectado e aguardando comandos.' : 'Falha ao assinar o tópico de comandos.');
      });
    });

    this.client.on('reconnect', () => {
      this.conectado = false;
      this.registrar('Tentando reconectar…');
    });

    this.client.on('close', () => {
      this.conectado = false;
      this.registrar('Conexão MQTT perdida.');
    });

    this.client.on('message', (topic, payload, packet = {}) => {
      if (topic === this.topicoStatus) {
        this.ultimoStatusHardware = payload.toString();
        this._notificar();
      } else if (topic === this.topicoComando && this.ativo && this.conectado) {
        const command = payload.toString();
        if (packet.retain || !['LIGAR', 'DESLIGAR'].includes(command)) return;
        this.registrar(`Recebido: ${command}`);
        for (const fn of this._commandListeners) fn(command);
      }
    });

    this.client.on('error', err => {
      this.conectado = false;
      this.registrar(`Erro MQTT: ${err.message}`);
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

  /** Publica a autorização manual; o recebimento no tópico é que libera a sessão. */
  autorizarCarga() {
    if (this.ativo) this._publicar('LIGAR');
  },

  /** Publica a ordem manual de cancelar/encerrar a recarga. */
  cortarCarga() {
    if (this.ativo) this._publicar('DESLIGAR');
  },

  aplicarComandoRele(comando) {
    if (this.ativo && ['LIGAR', 'DESLIGAR'].includes(comando)) this._publicar(comando, this.topicoRele);
  },

  _publicar(comando, topic = this.topicoComando) {
    if (!this.client || !this.ativo || !this.conectado || !this.client.connected) {
      this.registrar('Comando não enviado: MQTT desconectado.');
      return false;
    }
    this.client.publish(topic, comando, { qos: 0, retain: false }, err => {
      this.registrar(err ? `Falha ao publicar ${comando}: ${err.message}` : `Publicado: ${comando}`);
    });
    return true;
  },

  onCommand(fn) {
    if (typeof fn === 'function') this._commandListeners.push(fn);
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
      statusHardware: this.ultimoStatusHardware,
      log: this.log.slice()
    };
  }
};
