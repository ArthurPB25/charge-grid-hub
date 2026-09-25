import fs from 'node:fs';
import path from 'node:path';

export function dayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}

/** Registro das operações do totem; energia e custo continuam sendo estimativas. */
export class TotemHistory {
  constructor(file = null) {
    this.file = file;
    this.records = [];
    this.storageError = false;
    if (file && fs.existsSync(file)) {
      // Um arquivo inválido não é substituído silenciosamente por um histórico vazio.
      const records = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(records)) throw new Error('Histórico do totem inválido');
      this.records = records;
    }
  }

  add(session) {
    if (session.ambient || this.records.some(s => s.id === session.id)) return;
    this.records.push(JSON.parse(JSON.stringify({ ...session,
      source: 'totem', energySource: 'simulation',
      startedAt: session.actualStartedAt, finishedAt: session.actualFinishedAt
    })));
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.records, null, 2));
      fs.renameSync(`${this.file}.tmp`, this.file);
      this.storageError = false;
    } catch (err) {
      this.storageError = true;
      console.error('[TotemHistory] Não foi possível salvar o histórico:', err.code);
    }
  }

  snapshot(now = new Date()) {
    const todayKey = dayKey(now);
    const empty = date => ({ date, sessions: 0, energyKWh: 0, revenue: 0, pixReported: 0 });
    const days = new Map();
    for (const record of this.records) {
      const date = dayKey(record.finishedAt);
      const day = days.get(date) || empty(date);
      day.sessions++;
      day.energyKWh += record.energyGridKWh;
      day.revenue += record.cost; // valor calculado, não comprovante de recebimento
      if (record.paymentMethod === 'pix') day.pixReported++;
      days.set(date, day);
    }
    return {
      today: days.get(todayKey) || empty(todayKey),
      dailyHistory: [...days.values()].filter(d => d.date !== todayKey).sort((a, b) => a.date.localeCompare(b.date)),
      sessionHistory: this.records,
      storageError: this.storageError
    };
  }
}
