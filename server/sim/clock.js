/**
 * Relógio único da simulação (porta server-side de js/sim/clock.js).
 *
 * Todo o sistema (carga dos veículos, curva do prédio, geração solar,
 * tarifação) avança a partir deste laço. Roda como uma única instância no
 * processo do servidor, independente de quantos clientes (totem, admin)
 * estejam conectados por WebSocket.
 *
 * O tempo é acelerado para caber numa gravação: na velocidade padrão de 60x,
 * um minuto real equivale a uma hora simulada.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SiteConfig = require('../../data/site-config.js');

const SimClock = {
  tickMs: 250,
  speed: 60,
  simDate: null,
  running: false,

  _handle: null,
  _listeners: [],

  init(startISO) {
    this.simDate = new Date(startISO || SiteConfig.startISO);
    return this;
  },

  start() {
    if (this.running) return;
    if (!this.simDate) this.init();
    this.running = true;
    this._handle = setInterval(() => this._tick(), this.tickMs);
  },

  stop() {
    if (this._handle) clearInterval(this._handle);
    this._handle = null;
    this.running = false;
  },

  /** Velocidade em segundos simulados por segundo real. */
  setSpeed(multiplier) {
    this.speed = Math.max(1, multiplier);
  },

  /** Registra um observador. Recebe (dtSim em segundos, Date simulada, meta). */
  onTick(fn) {
    if (typeof fn === 'function') this._listeners.push(fn);
  },

  /**
   * Avança o relógio até a próxima ocorrência da hora indicada, sem integrar o
   * tempo pulado. Os veículos mantêm o estado de carga onde estavam: o objetivo
   * é demonstrar a virada de posto tarifário, não simular as horas puladas.
   */
  jumpToHour(hour) {
    const target = new Date(this.simDate);
    target.setHours(hour, 0, 0, 0);
    if (target <= this.simDate) target.setDate(target.getDate() + 1);
    this.simDate = target;
    this._emit(0, { jumped: true });
  },

  /**
   * Ajuste manual para a gravação: posiciona o relógio na hora e no minuto
   * exatos, sem integrar o tempo pulado.
   */
  setTime(hour, minute) {
    const target = new Date(this.simDate);
    target.setHours(hour, minute || 0, 0, 0);
    this.simDate = target;
    this._emit(0, { jumped: true });
  },

  /** Avança ou recua o relógio em minutos, para acertar o enquadramento. */
  nudgeMinutes(delta) {
    this.simDate = new Date(this.simDate.getTime() + delta * 60000);
    this._emit(0, { jumped: true });
  },

  /**
   * Move a data para o dia da semana pedido, mantendo o horário.
   * Serve para demonstrar que sábado e domingo não têm posto de ponta.
   */
  setDayOfWeek(dow) {
    const target = new Date(this.simDate);
    const diff = (dow - target.getDay() + 7) % 7;
    target.setDate(target.getDate() + (diff === 0 ? 0 : diff));
    this.simDate = target;
    this._emit(0, { jumped: true });
  },

  pause() {
    this.stop();
  },

  resume() {
    this.start();
  },

  /** Alterna entre pausado e rodando; devolve o novo estado. */
  toggle() {
    if (this.running) this.stop();
    else this.start();
    return this.running;
  },

  /** Hora do dia como número fracionário (ex.: 17,5 para 17h30). */
  hourFloat() {
    const d = this.simDate;
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  },

  /** Dias úteis definem os postos de ponta e intermediário da Tarifa Branca. */
  isWeekday() {
    const day = this.simDate.getDay();
    return day >= 1 && day <= 5;
  },

  formatTime() {
    return this.simDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },

  formatDate() {
    return this.simDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  _tick() {
    const dtSim = (this.tickMs / 1000) * this.speed;
    this.simDate = new Date(this.simDate.getTime() + dtSim * 1000);
    this._emit(dtSim, { jumped: false });
  },

  _emit(dtSim, meta) {
    for (const fn of this._listeners) {
      try {
        fn(dtSim, this.simDate, meta);
      } catch (err) {
        console.error('[SimClock] observador falhou:', err);
      }
    }
  }
};

export default SimClock;
