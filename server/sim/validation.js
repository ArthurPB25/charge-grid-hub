export const finiteRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function validSessionConfig(config) {
  const v = config?.vehicle;
  return Boolean(config && Number.isInteger(config.stationId) && v && finiteRange(v.batteryCapacity, .1, 1000) &&
    finiteRange(v.maxChargePower?.ac, .1, 1000) &&
    (config.startSoc == null || finiteRange(config.startSoc, 0, 1)) &&
    (config.targetSoc == null || finiteRange(config.targetSoc, .001, 1)) &&
    (config.startSoc == null || (config.targetSoc ?? .8) > config.startSoc));
}
