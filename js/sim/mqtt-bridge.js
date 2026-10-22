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
  corte: null,
  _cortePendente: false,
  _corteEmEnvio: false,
  _corteRevisao: 0,
  _bloqueioManual: false,

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

    try {
      if (window.localStorage?.getItem('chargegrid-esp-stop-pending') === '1') {
        this._cortePendente = this._bloqueioManual = true;
        this.corte = 'pending';
      }
    } catch {}
    this.client = mqtt.connect(this.url, { connectTimeout: 8000, reconnectPeriod: 4000, clean: true, queueQoSZero: false });
    this.registrar('Conectando ao broker MQTT…');

    this.client.on('connect', () => {
      this.client.subscribe([this.topicoStatus, this.topicoComando], { qos: 0 }, (err, grants) => {
        this.conectado = !err && this.client.connected && grants?.some(g => g.topic === this.topicoComando && g.qos !== 128);
        this.registrar(this.conectado ? 'Conectado e aguardando comandos.' : 'Falha ao assinar o tópico de comandos.');
        this._enviarCortePendente();
      });
    });

    this.client.on('reconnect', () => {
      this.conectado = false;
      this.registrar('Tentando reconectar…');
    });

    this.client.on('close', () => {
      this.conectado = false;
      this._corteEmEnvio = false;
      this._corteRevisao++;
      this.registrar('Conexão MQTT perdida.');
    });

    this.client.on('message', (topic, payload, packet = {}) => {
      if (topic === this.topicoStatus) {
        this.ultimoStatusHardware = payload.toString();
        if (!packet.retain && this.corte && ['PARADO','DESLIGADO','OFF'].includes(this.ultimoStatusHardware.trim().toUpperCase())) {
          this.corte = 'confirmed';
          this._cortePendente = false;
          this._corteEmEnvio = false;
          this._corteRevisao++;
          this._salvarCortePendente();
        }
        this._notificar();
      } else if (topic === this.topicoComando && this.ativo && this.conectado) {
        const command = payload.toString();
        if (packet.retain || !['LIGAR', 'DESLIGAR'].includes(command)) return;
        if (command === 'LIGAR') {
          if (this._cortePendente) return;
          this._bloqueioManual = false;
          this.corte = null;
        }
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
      this.cortarCarga();
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
    if (!this.prepararNovaRecarga()) return false;
    if (this.ativo) return this._publicar('LIGAR');
    return false;
  },

  prepararNovaRecarga() {
    if (this._cortePendente) { this.registrar('Aguarde o envio do desligamento pendente antes de autorizar outra carga.'); return false; }
    this._bloqueioManual = false;
    this.corte = null;
    this._notificar();
    return true;
  },

  /** Publica a ordem manual de cancelar/encerrar a recarga. */
  cortarCarga() {
    this._cortePendente = this._bloqueioManual = true;
    this.corte = 'pending';
    this._salvarCortePendente();
    this.ativar();
    if (this._corteEmEnvio) return true;
    const sent = this._enviarCortePendente();
    if (!sent) this.registrar('Desligamento pendente: será enviado quando o MQTT reconectar.');
    return sent;
  },

  _salvarCortePendente() {
    try {
      if (this._cortePendente) window.localStorage?.setItem('chargegrid-esp-stop-pending','1');
      else window.localStorage?.removeItem('chargegrid-esp-stop-pending');
    } catch {}
  },

  _enviarCortePendente() {
    if (!this._cortePendente || this._corteEmEnvio || !this.ativo || !this.conectado || !this.client?.connected) return false;
    this._corteEmEnvio = true;
    const revision = ++this._corteRevisao;
    const complete = err => {
      if (revision !== this._corteRevisao) return;
      this._corteEmEnvio = false;
      if (!err) {
        this._cortePendente = false;
        if (this.corte !== 'confirmed') this.corte = 'sent';
        this._salvarCortePendente();
      }
      this.registrar(err ? 'Falha ao enviar DESLIGAR: '+err.message : 'DESLIGAR enviado ao tópico de comando. Aguardando confirmação do ESP.');
    };
    try {
      // PUBACK confirma o broker; só um status novo do ESP confirma o relé.
      this.client.publish(this.topicoComando,'DESLIGAR',{qos:1,retain:false},complete);
      return true;
    } catch (err) { complete(err); return false; }
  },

  aplicarComandoRele(comando) {
    if (comando === 'LIGAR' && this._bloqueioManual) return false;
    if (this.ativo && ['LIGAR', 'DESLIGAR'].includes(comando)) return this._publicar(comando, this.topicoRele);
    return false;
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
      corte: this.corte,
      log: this.log.slice()
    };
  }
};
