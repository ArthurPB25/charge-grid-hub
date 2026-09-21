/**
 * Física de carregamento de baterias de lítio (porta server-side de
 * js/sim/ev-physics.js). Puro — sem dependência de outros módulos.
 */
const EVPhysics = {
  taperParams: {
    ac: { knee: 0.55, depth: 0.60, exponent: 2.2 },
    dc: { knee: 0.55, depth: 0.85, exponent: 1.6 }
  },

  efficiency: { ac: 0.93, dc: 0.95 },

  minTaper: 0.08,

  taper(soc, mode) {
    const p = this.taperParams[mode] || this.taperParams.ac;
    if (soc <= p.knee) return 1;
    const x = (soc - p.knee) / (1 - p.knee);
    const tau = 1 - p.depth * Math.pow(Math.min(1, x), p.exponent);
    return Math.max(this.minTaper, tau);
  },

  effectivePowerKW(setpointKW, vehicle, evse, soc) {
    const mode = evse.current;
    const vehicleMax = vehicle.maxChargePower[mode] || vehicle.maxChargePower.ac;
    const ceiling = Math.min(vehicleMax, evse.maxPowerKW);
    return Math.max(0, Math.min(setpointKW, ceiling * this.taper(soc, mode)));
  },

  demandKW(vehicle, evse, soc) {
    return this.effectivePowerKW(Infinity, vehicle, evse, soc);
  },

  powerToCurrent(powerKW, evse) {
    if (evse.phases === 3) {
      return (powerKW * 1000) / (Math.sqrt(3) * evse.voltage);
    }
    return (powerKW * 1000) / evse.voltage;
  },

  currentToPower(amps, evse) {
    if (evse.phases === 3) {
      return (amps * Math.sqrt(3) * evse.voltage) / 1000;
    }
    return (amps * evse.voltage) / 1000;
  },

  randomArrivalSoc() {
    const value = this._gaussian(34, 12);
    return Math.min(62, Math.max(8, Math.round(value))) / 100;
  },

  estimateMinutesToTarget(vehicle, evse, socNow, socTarget, capKW) {
    let soc = socNow;
    let minutes = 0;
    const ceiling = capKW == null ? Infinity : capKW;
    while (soc < socTarget && minutes < 24 * 60) {
      const p = this.effectivePowerKW(ceiling, vehicle, evse, soc);
      if (p <= 0.05) break;
      const kWhBattery = (p * this.efficiency[evse.current]) / 60;
      soc += kWhBattery / vehicle.batteryCapacity;
      minutes += 1;
    }
    return minutes;
  },

  _gaussian(mean, stdDev) {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * stdDev;
  }
};

export default EVPhysics;
