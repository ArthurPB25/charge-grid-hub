/**
 * Modelo elétrico do estabelecimento (porta server-side de js/sim/site.js).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SiteConfig = require('../../data/site-config.js');
import SimClock from './clock.js';

const SiteModel = {
  evses: [],
  sessions: [],

  baseLoadKW: 0,
  solarKW: 0,

  demoPeakKW: 0,

  _cloud: 1,

  init() {
    this.evses = SiteConfig.evses.map(e => Object.assign({}, e, {
      setpointKW: 0,
      currentA: 0,
      commandedA: e.iMax,
      status: 'Available'
    }));
    this.sessions = [];
    this.demoPeakKW = 0;
    this._cloud = 1;
    this._sample(SimClock.hourFloat());
    return this;
  },

  step(dtSim) {
    this._cloud += (Math.random() - 0.5) * 0.02 * (dtSim / 60);
    this._cloud = Math.min(1, Math.max(0.72, this._cloud));
    this._sample(SimClock.hourFloat());
  },

  _sample(hour) {
    this.baseLoadKW = this._interpolate(SiteConfig.baseLoadByHour, hour);
    this.solarKW = this._interpolate(SiteConfig.solarByHour, hour) * this._cloud;
  },

  _interpolate(curve, hour) {
    const h = ((hour % 24) + 24) % 24;
    const i = Math.floor(h);
    const frac = h - i;
    const a = curve[i];
    const b = curve[(i + 1) % 24];
    return a + (b - a) * frac;
  },

  buildingLoadKW() {
    return this.baseLoadKW + this.demoPeakKW;
  },

  netGridKW() {
    return Math.max(0, this.buildingLoadKW() - this.solarKW);
  },

  solarSurplusKW() {
    return Math.max(0, this.solarKW - this.buildingLoadKW());
  },

  totalEvKW() {
    return this.sessions.reduce((sum, s) => sum + (s.powerKW || 0), 0);
  },

  totalMeterKW() {
    return this.netGridKW() + this.totalEvKW();
  },

  limitKW() {
    return SiteConfig.contractedDemandKW * (1 - SiteConfig.safetyMargin);
  },

  availableForEvKW() {
    return Math.max(0, this.limitKW() - this.netGridKW());
  },

  solarFraction() {
    const ev = this.totalEvKW();
    if (ev <= 0) return 0;
    return Math.min(1, this.solarSurplusKW() / ev);
  },

  occupancy() {
    const operational = this.evses.filter(e => e.status !== 'Faulted' && e.status !== 'Unavailable');
    if (!operational.length) return 0;
    const busy = this.sessions.filter(s => s.status !== 'finished').length;
    return Math.min(1, busy / operational.length);
  },

  getEvse(id) {
    return this.evses.find(e => e.id === id);
  },

  getEvseByStation(stationId) {
    return this.evses.find(e => e.stationId === stationId);
  },

  activeSessions() {
    return this.sessions.filter(s => s.status === 'charging' || s.status === 'suspended');
  },

  addSession(session) {
    this.sessions.push(session);
    const evse = this.getEvse(session.evseId);
    if (evse) evse.status = 'Charging';
    return session;
  },

  removeSession(session) {
    const i = this.sessions.indexOf(session);
    if (i >= 0) this.sessions.splice(i, 1);
    const evse = this.getEvse(session.evseId);
    if (evse) {
      evse.status = 'Available';
      evse.setpointKW = 0;
      evse.currentA = 0;
      evse.commandedA = evse.iMax;
    }
  },

  triggerDemoPeak(folga) {
    const alvo = folga == null ? 0.45 : folga;
    const evDemand = this.sessions
      .filter(s => s.status !== 'finished')
      .reduce((sum, s) => sum + s.demandKW(), 0);

    const rawNet = this.baseLoadKW - this.solarKW;
    const desejado = this.limitKW() - rawNet - alvo * evDemand;

    const teto = this.limitKW() - rawNet - 4;

    this.demoPeakKW = Math.max(6, Math.min(teto, desejado));
    return this.demoPeakKW;
  },

  clearDemoPeak() {
    this.demoPeakKW = 0;
  },

  toggleDemoPeak(folga) {
    if (this.demoPeakKW > 0) this.clearDemoPeak();
    else this.triggerDemoPeak(folga);
    return this.demoPeakKW > 0;
  }
};

export default SiteModel;
