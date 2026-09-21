/**
 * Painel de controle da demonstração.
 *
 * Existe para a gravação do vídeo: permite posicionar o relógio no horário
 * desejado, acelerar ou pausar a simulação e provocar o pico de consumo do
 * estabelecimento no momento exato em que a câmera está enquadrando a tela —
 * em vez de esperar que a situação aconteça sozinha.
 *
 * Fica escondido por padrão. Abre com Ctrl+D ou pela aba discreta na lateral.
 */
window.DemoPanel = {
  el: null,
  tab: null,
  open: false,

  atalhos: [
    { label: '12h', hora: 12, hint: 'excedente solar' },
    { label: '15h', hora: 15, hint: 'tarde' },
    { label: '17h', hora: 17, hint: 'intermediário' },
    { label: '18h', hora: 18, hint: 'ponta' },
    { label: '21h', hora: 21, hint: 'fim da ponta' }
  ],

  init() {
    if (this.el) return this;
    this._render();
    this._bind();

    window.SimClient.onSnapshot(() => this._refresh());
    this._refresh();
    return this;
  },

  _render() {
    const panel = document.createElement('div');
    panel.className = 'demo-panel';
    panel.id = 'demo-panel';
    panel.innerHTML = `
      <div class="demo-panel-head">
        <span class="demo-panel-title">Modo demonstração</span>
        <button class="demo-panel-close" id="demo-close" title="Fechar (Ctrl+D)">&times;</button>
      </div>
      <div class="demo-panel-body">
        <div>
          <div class="demo-clock" id="demo-clock">--:--</div>
          <div class="demo-clock-date" id="demo-date">—</div>
          <div class="demo-btn-row">
            ${this.atalhos.map(a => `<button class="demo-btn" data-hora="${a.hora}" title="${a.hint}">${a.label}</button>`).join('')}
          </div>
        </div>

        <div>
          <div class="demo-group-label">Ajuste fino</div>
          <div class="demo-btn-row">
            <button class="demo-btn" data-nudge="-30">−30min</button>
            <button class="demo-btn" data-nudge="-5">−5min</button>
            <button class="demo-btn" data-nudge="5">+5min</button>
            <button class="demo-btn" data-nudge="30">+30min</button>
          </div>
        </div>

        <div>
          <div class="demo-group-label">Velocidade</div>
          <div class="demo-btn-row">
            <button class="demo-btn" id="demo-playpause">Pausar</button>
            <button class="demo-btn" data-speed="1">1x</button>
            <button class="demo-btn" data-speed="60">60x</button>
            <button class="demo-btn" data-speed="240">240x</button>
          </div>
        </div>

        <div>
          <div class="demo-group-label">Consumo do estabelecimento</div>
          <div class="demo-btn-row">
            <button class="demo-btn danger" data-peak="0.45">Pico moderado</button>
            <button class="demo-btn danger" data-peak="0.25">Pico severo</button>
          </div>
          <div class="demo-btn-row" style="margin-top:6px">
            <button class="demo-btn" id="demo-peak-clear">Normalizar consumo</button>
          </div>
        </div>

        <div>
          <div class="demo-group-label">Dia da semana</div>
          <div class="demo-btn-row">
            <button class="demo-btn" data-dow="2">Dia útil</button>
            <button class="demo-btn" data-dow="6">Sábado</button>
          </div>
        </div>

        <div>
          <div class="demo-group-label">Hardware real (ESP32)</div>
          <div class="demo-btn-row">
            <button class="demo-btn" id="demo-hw-toggle">Conectar ao ESP32</button>
          </div>
          <div class="demo-hw-status" id="demo-hw-status">desconectado</div>
        </div>

        <div class="demo-hint">
          Pico moderado estrangula todas as recargas sem suspender nenhuma.
          Pico severo leva o carregador a 16 A e suspende uma sessão.
        </div>
      </div>
    `;

    const tab = document.createElement('button');
    tab.className = 'demo-tab';
    tab.id = 'demo-tab';
    tab.textContent = 'demo';

    document.body.appendChild(panel);
    document.body.appendChild(tab);
    this.el = panel;
    this.tab = tab;
  },

  _bind() {
    this.tab.addEventListener('click', () => this.toggle());
    this.el.querySelector('#demo-close').addEventListener('click', () => this.toggle(false));

    document.addEventListener('keydown', e => {
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        this.toggle();
      }
    });

    this.el.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.dataset.hora != null) {
        window.SimClient.send('demo:set-time', { hour: parseInt(btn.dataset.hora, 10), minute: 0 });
      } else if (btn.dataset.nudge != null) {
        window.SimClient.send('demo:nudge', { minutes: parseInt(btn.dataset.nudge, 10) });
      } else if (btn.dataset.speed != null) {
        window.SimClient.send('demo:set-speed', { speed: parseInt(btn.dataset.speed, 10) });
      } else if (btn.dataset.peak != null) {
        window.SimClient.send('demo:trigger-peak', { folga: parseFloat(btn.dataset.peak) });
      } else if (btn.dataset.dow != null) {
        window.SimClient.send('demo:set-day', { dow: parseInt(btn.dataset.dow, 10) });
      } else if (btn.id === 'demo-peak-clear') {
        window.SimClient.send('demo:clear-peak');
      } else if (btn.id === 'demo-playpause') {
        window.SimClient.send('demo:toggle-clock');
      } else if (btn.id === 'demo-hw-toggle') {
        window.MqttBridge.toggle(); // hardware real: fica local, sem rede
      }

      this._refresh();
    });

    if (window.MqttBridge) {
      window.MqttBridge.onUpdate(() => this._refresh());
    }
  },

  toggle(force) {
    this.open = force == null ? !this.open : force;
    this.el.classList.toggle('open', this.open);
    this.tab.hidden = this.open;
  },

  _refresh() {
    if (!this.el) return;
    const snap = window.SimClient.snapshot;
    if (!snap) return;

    this.el.querySelector('#demo-clock').textContent = snap.time;
    this.el.querySelector('#demo-date').textContent =
      snap.date + ' · ' + (snap.clock.isWeekday ? 'dia útil' : 'fim de semana');

    const play = this.el.querySelector('#demo-playpause');
    play.textContent = snap.clock.running ? 'Pausar' : 'Retomar';
    play.classList.toggle('active', !snap.clock.running);

    for (const btn of this.el.querySelectorAll('[data-speed]')) {
      btn.classList.toggle('active', snap.clock.speed === parseInt(btn.dataset.speed, 10));
    }

    const comPico = snap.site.demoPeakKW > 0;
    for (const btn of this.el.querySelectorAll('[data-peak]')) {
      btn.classList.toggle('active', comPico);
    }

    for (const btn of this.el.querySelectorAll('[data-dow]')) {
      const ehUtil = btn.dataset.dow === '2';
      btn.classList.toggle('active', ehUtil === snap.clock.isWeekday);
    }

    if (window.MqttBridge) {
      const hw = window.MqttBridge.snapshot();
      const btnHw = this.el.querySelector('#demo-hw-toggle');
      const status = this.el.querySelector('#demo-hw-status');
      btnHw.textContent = hw.ativo ? 'Desconectar do ESP32' : 'Conectar ao ESP32';
      btnHw.classList.toggle('active', hw.ativo);

      if (!hw.ativo) status.textContent = 'desconectado';
      else if (!hw.conectado) status.textContent = 'conectando ao broker...';
      else status.textContent = 'conectado · relé: ' + (hw.statusHardware || 'aguardando status...');
    }
  }
};
