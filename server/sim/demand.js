/**
 * Controle Dinâmico de Demanda (porta server-side de js/sim/demand.js).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SiteConfig = require('../../data/site-config.js');
import SiteModel from './site.js';
import EVPhysics from './ev-physics.js';

const DemandController = {
  state: 'NORMAL',
  measuredKW: 0,
  emaKW: 0,
  projectedWindowKW: 0,
  lastWindowAvgKW: 0,
  constrained: false,

  demandWindowSec: 900,

  _windowElapsed: 0,
  _windowEnergyKWh: 0,
  _stateListeners: [],
  _commandListeners: [],
  _lastCommand: {},
  _simSeconds: 0,

  minDeltaA: 2,
  minIntervalSim: 20,
  resumeHoldSim: 60,

  init() {
    this.state = 'NORMAL';
    this.measuredKW = SiteModel.totalMeterKW();
    this.emaKW = this.measuredKW;
    this.projectedWindowKW = this.measuredKW;
    this.lastWindowAvgKW = this.measuredKW;
    this.availableForPlanningKW = SiteModel.availableForEvKW();
    this._windowElapsed = 0;
    this._windowEnergyKWh = 0;
    this._lastCommand = {};
    this._simSeconds = 0;
    return this;
  },

  onStateChange(fn) {
    if (typeof fn === 'function') this._stateListeners.push(fn);
  },

  onCommand(fn) {
    if (typeof fn === 'function') this._commandListeners.push(fn);
  },

  measure(dtSim) {
    this._simSeconds += dtSim;
    this.measuredKW = SiteModel.totalMeterKW();

    this._windowEnergyKWh += this.measuredKW * (dtSim / 3600);
    this._windowElapsed += dtSim;

    if (this._windowElapsed >= this.demandWindowSec) {
      this.lastWindowAvgKW = this._windowEnergyKWh / (this.demandWindowSec / 3600);
      this._windowElapsed = 0;
      this._windowEnergyKWh = 0;
    }

    const remainingSec = Math.max(1, this.demandWindowSec - this._windowElapsed);
    const projectedKWh = this._windowEnergyKWh + this.measuredKW * (remainingSec / 3600);
    this.projectedWindowKW = projectedKWh / (this.demandWindowSec / 3600);

    this.emaKW = this.emaKW === 0
      ? this.measuredKW
      : 0.25 * this.measuredKW + 0.75 * this.emaKW;
  },

  headroomForEvKW() {
    const limit = SiteModel.limitKW();
    const windowHours = this.demandWindowSec / 3600;
    const remainingHours = Math.max(1 / 3600, (this.demandWindowSec - this._windowElapsed) / 3600);
    const allowedRest = (limit * windowHours - this._windowEnergyKWh) / remainingHours;

    const ceiling = Math.min(limit, allowedRest);
    return Math.max(0, ceiling - SiteModel.netGridKW());
  },

  allocate() {
    const limit = SiteModel.limitKW();

    const available = this.headroomForEvKW();
    this.availableForPlanningKW = available;

    const sessions = SiteModel.sessions.filter(s => s.status !== 'finished');

    const suspended = [];
    let pool = sessions.slice();
    let allocation = this._waterFill(pool, available);

    for (let guard = 0; guard < sessions.length; guard += 1) {
      const starved = pool.filter(s => {
        const kW = allocation.get(s) || 0;
        return Math.floor(EVPhysics.powerToCurrent(kW, s.evse)) < SiteConfig.minCurrentA;
      });
      if (!starved.length || pool.length <= 1) break;

      starved.sort((a, b) => a.priority() - b.priority());
      const victim = starved[0];
      suspended.push(victim);
      pool = pool.filter(s => s !== victim);
      allocation = this._waterFill(pool, available);
    }

    const demandTotal = sessions.reduce((sum, s) => sum + s.demandKW(), 0);
    this.constrained = demandTotal > available + 0.01;

    const commands = [];
    for (const session of sessions) {
      const evse = session.evse;
      const isSuspended = suspended.indexOf(session) >= 0;
      const targetKW = isSuspended ? 0 : (allocation.get(session) || 0);

      let amps;
      if (isSuspended) {
        amps = 0;
      } else if (!this.constrained) {
        amps = evse.iMax;
      } else {
        amps = Math.min(evse.iMax, Math.floor(EVPhysics.powerToCurrent(targetKW, evse)));
        if (amps < SiteConfig.minCurrentA) amps = 0;
      }

      commands.push({ session: session, evse: evse, amps: amps });
    }

    this._updateState(limit, suspended.length > 0);
    this._applyHysteresis(commands);

    const setpoints = new Map();
    for (const cmd of commands) {
      const evse = cmd.evse;
      setpoints.set(cmd.session, EVPhysics.currentToPower(evse.commandedA, evse));
    }
    return setpoints;
  },

  _waterFill(sessions, available) {
    const result = new Map();
    let pending = sessions.slice();
    let remaining = available;

    for (let iter = 0; iter < 5 && pending.length; iter += 1) {
      const totalPriority = pending.reduce((sum, s) => sum + Math.max(0.01, s.priority()), 0);
      const satisfied = [];

      for (const session of pending) {
        const weight = Math.max(0.01, session.priority()) / totalPriority;
        if (session.demandKW() <= remaining * weight) satisfied.push(session);
      }

      if (!satisfied.length) break;

      for (const session of satisfied) {
        const kW = session.demandKW();
        result.set(session, kW);
        remaining -= kW;
        pending = pending.filter(s => s !== session);
      }
    }

    if (pending.length) {
      const totalPriority = pending.reduce((sum, s) => sum + Math.max(0.01, s.priority()), 0);
      for (const session of pending) {
        const weight = Math.max(0.01, session.priority()) / totalPriority;
        result.set(session, Math.max(0, remaining * weight));
      }
    }

    return result;
  },

  _applyHysteresis(commands) {
    for (const cmd of commands) {
      const evse = cmd.evse;
      const last = this._lastCommand[evse.id];
      const current = evse.commandedA;
      const target = cmd.amps;

      if (last && this._simSeconds - last.at < this.minIntervalSim) continue;

      const delta = Math.abs(target - current);
      const resuming = current === 0 && target >= SiteConfig.minCurrentA;

      if (resuming && last && this._simSeconds - last.at < this.resumeHoldSim) continue;
      if (delta < this.minDeltaA && !(target === 0 && current > 0)) continue;

      evse.commandedA = target;
      this._lastCommand[evse.id] = { amps: target, at: this._simSeconds };
      this._emitCommand(evse, current, target, cmd.session);
    }
  },

  _updateState(limit, hasSuspended) {
    const utilization = this.measuredKW / limit;
    const projected = this.projectedWindowKW / limit;
    let next;

    if (hasSuspended) next = 'SUSPENSO';
    else if (this.constrained) next = 'LIMITANDO';
    else if (utilization > 0.85 || projected > 0.98) next = 'ATENCAO';
    else next = 'NORMAL';

    if (next !== this.state) {
      const previous = this.state;
      this.state = next;
      for (const fn of this._stateListeners) {
        try {
          fn(next, previous, this.snapshot());
        } catch (err) {
          console.error('[DemandController] observador de estado falhou:', err);
        }
      }
    }
  },

  _emitCommand(evse, fromA, toA, session) {
    for (const fn of this._commandListeners) {
      try {
        fn({ evse: evse, fromA: fromA, toA: toA, session: session, state: this.state });
      } catch (err) {
        console.error('[DemandController] observador de comando falhou:', err);
      }
    }
  },

  snapshot() {
    return {
      state: this.state,
      measuredKW: this.measuredKW,
      smoothedKW: this.emaKW,
      projectedWindowKW: this.projectedWindowKW,
      lastWindowAvgKW: this.lastWindowAvgKW,
      windowProgress: this._windowElapsed / this.demandWindowSec,
      limitKW: SiteModel.limitKW(),
      availableKW: this.availableForPlanningKW,
      constrained: this.constrained
    };
  }
};

export default DemandController;
