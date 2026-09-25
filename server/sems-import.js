import fs from 'node:fs';

/** Importação explícita do portal: não representa uma conexão de telemetria ao vivo. */
export function readSemsImport(file) {
  if (!fs.existsSync(file)) return { status: 'not-configured', records: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const datePattern = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;
    if (!data.capturedAt || !Number.isFinite(Date.parse(data.capturedAt)) || !Array.isArray(data.records)) throw new Error('Formato inválido');
    if (data.records.some(r => !datePattern.test(r.startedAtDisplay) || !datePattern.test(r.finishedAtDisplay) || !Number.isFinite(r.energyKWh) || r.energyKWh < 0)) throw new Error('Registro inválido');
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
