import fs from 'node:fs';

const portalTime = text => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text || '');
  if (!match) return NaN;
  const [, day, month, year, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return NaN;
  return date.getTime();
};

/** Importação explícita do portal: não representa uma conexão de telemetria ao vivo. */
export function readSemsImport(file) {
  if (!fs.existsSync(file)) return { status: 'not-configured', records: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.capturedAt || !Number.isFinite(Date.parse(data.capturedAt)) || !Array.isArray(data.records)) throw new Error('Formato inválido');
    if (data.records.some(r => !r || !Number.isFinite(portalTime(r.startedAtDisplay)) || !Number.isFinite(portalTime(r.finishedAtDisplay)) ||
        portalTime(r.finishedAtDisplay) < portalTime(r.startedAtDisplay) || !Number.isFinite(r.energyKWh) || r.energyKWh < 0)) throw new Error('Registro inválido');
    const seen = new Set();
    const records = data.records.filter(r => {
      const key = `${r.startedAtDisplay}|${r.finishedAtDisplay}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { status: 'imported', source: 'SEMS+ · leitura do portal', capturedAt: data.capturedAt,
      stationName: String(data.stationName || ''), deviceSn: String(data.deviceSn || ''),
      observedStatus: String(data.observedStatus || ''), records,
      totalEnergyKWh: records.reduce((sum, r) => sum + r.energyKWh, 0)
    };
  } catch {
    return { status: 'invalid-import', records: [] };
  }
}
