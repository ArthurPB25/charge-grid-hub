/**
 * Sessão de recarga (porta server-side de js/sim/session.js).
 * Fábrica, não singleton: o Controle Dinâmico de Demanda só faz sentido com
 * vários veículos disputando a mesma entrada de energia ao mesmo tempo.
 */
import SiteModel from './site.js';
import EVPhysics from './ev-physics.js';
import SimClock from './clock.js';

const ChargeSession = {
  _seq: 1028,

  create(options) {
    const evse = SiteModel.getEvse(options.evseId);
    const vehicle = options.vehicle;
    const startSoc = options.startSoc != null
      ? options.startSoc
      : EVPhysics.randomArrivalSoc();

    const session = {
      id: 'SES-' + String(++ChargeSession._seq),
      transactionId: ChargeSession._seq,
      evseId: evse.id,
      evse: evse,
      vehicle: vehicle,
      ambient: !!options.ambient,

      socStart: startSoc,
      soc: startSoc,
      socTarget: options.targetSoc != null ? options.targetSoc : 0.8,

      energyGridKWh: 0,
      energyBatteryKWh: 0,

      elapsedSim: 0,
      powerKW: 0,
      currentA: 0,
      setpointKW: 0,
      status: 'charging',
      suspendedFor: 0,

      cost: 0,
      rateSegments: [],
      startedAt: new Date(SimClock.simDate),
      finishedAt: null,

      demandKW() {
        if (this.status === 'finished') return 0;
        return EVPhysics.demandKW(this.vehicle, this.evse, this.soc);
      },

      urgency() {
        if (this.socTarget <= 0) return 0;
        return Math.max(0, (this.socTarget - this.soc) / this.socTarget);
      },

      ageFactor() {
        return Math.min(1, this.elapsedSim / 3600);
      },

      priority() {
        return 0.7 * this.urgency() + 0.3 * this.ageFactor();
      },

      step(dtSim, setpointKW, price, posto) {
        if (this.status === 'finished') return;

        this.elapsedSim += dtSim;
        this.setpointKW = setpointKW;

        if (setpointKW <= 0) {
          this.status = 'suspended';
          this.suspendedFor += dtSim;
          this.powerKW = 0;
          this.currentA = 0;
          return;
        }

        this.status = 'charging';
        this.powerKW = EVPhysics.effectivePowerKW(setpointKW, this.vehicle, this.evse, this.soc);
        this.currentA = EVPhysics.powerToCurrent(this.powerKW, this.evse);

        const hours = dtSim / 3600;
        const gridKWh = this.powerKW * hours;
        const batteryKWh = gridKWh * EVPhysics.efficiency[this.evse.current];

        this.energyGridKWh += gridKWh;
        this.energyBatteryKWh += batteryKWh;
        this.soc = Math.min(1, this.soc + batteryKWh / this.vehicle.batteryCapacity);

        this._bill(gridKWh, price, posto);

        if (this.soc >= this.socTarget - 0.0005) {
          this.finish();
        }
      },

      _bill(kWh, price, posto) {
        if (!(kWh > 0) || !(price > 0)) return;
        this.cost += kWh * price;
        let segment = this.rateSegments.find(s => s.posto === posto);
        if (!segment) {
          segment = { posto: posto, kWh: 0, cost: 0 };
          this.rateSegments.push(segment);
        }
        segment.kWh += kWh;
        segment.cost += kWh * price;
      },

      segmentAverage(segment) {
        return segment.kWh > 0 ? segment.cost / segment.kWh : 0;
      },

      finish() {
        this.status = 'finished';
        this.powerKW = 0;
        this.currentA = 0;
        this.setpointKW = 0;
        this.finishedAt = new Date(SimClock.simDate);
      },

      minutesRemaining(capKW) {
        if (this.status === 'finished') return 0;
        return EVPhysics.estimateMinutesToTarget(
          this.vehicle, this.evse, this.soc, this.socTarget, capKW
        );
      }
    };

    return session;
  }
};

export default ChargeSession;
