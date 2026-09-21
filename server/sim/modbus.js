/**
 * Barramento Modbus RTU sobre RS-485 (porta server-side de js/sim/modbus.js).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ModbusRegisters = require('../../data/modbus-map.js');
import SiteModel from './site.js';
import SimClock from './clock.js';

const ModbusBus = {
  values: {},
  lastFrames: [],
  maxFrames: 40,

  _writeListeners: [],

  init() {
    this.values = {};
    this.lastFrames = [];
    for (const evse of SiteModel.evses) {
      this.values[evse.slaveId] = this._blankRegisters(evse);
    }
    return this;
  },

  onWrite(fn) {
    if (typeof fn === 'function') this._writeListeners.push(fn);
  },

  _blankRegisters(evse) {
    return {
      status: 0,
      voltageL1: evse.voltage,
      voltageL2: evse.phases === 3 ? evse.voltage : 0,
      voltageL3: evse.phases === 3 ? evse.voltage : 0,
      currentL1: 0,
      currentL2: 0,
      currentL3: 0,
      activePower: 0,
      energyTotal: 0,
      maxCurrent: evse.iMax,
      temperature: 24,
      cpState: 1
    };
  },

  refresh() {
    for (const evse of SiteModel.evses) {
      const regs = this.values[evse.slaveId] || (this.values[evse.slaveId] = this._blankRegisters(evse));
      const session = SiteModel.sessions.find(s => s.evseId === evse.id && s.status !== 'finished');

      regs.maxCurrent = evse.commandedA;

      if (!session) {
        regs.status = 0;
        regs.cpState = 1;
        regs.currentL1 = regs.currentL2 = regs.currentL3 = 0;
        regs.activePower = 0;
        regs.temperature = 24 + Math.random() * 1.5;
        continue;
      }

      const charging = session.status === 'charging' && session.powerKW > 0;
      regs.status = charging ? 2 : 3;
      regs.cpState = charging ? 3 : 2;

      const perPhase = session.currentA;
      regs.currentL1 = perPhase * (1 - Math.random() * 0.02);
      if (evse.phases === 3) {
        regs.currentL2 = perPhase * (1 - Math.random() * 0.02);
        regs.currentL3 = perPhase * (1 - Math.random() * 0.02);
      }

      regs.voltageL1 = evse.voltage * (1 + (Math.random() - 0.5) * 0.01);
      if (evse.phases === 3) {
        regs.voltageL2 = evse.voltage * (1 + (Math.random() - 0.5) * 0.01);
        regs.voltageL3 = evse.voltage * (1 + (Math.random() - 0.5) * 0.01);
      }

      regs.activePower = session.powerKW * 1000;
      regs.energyTotal = session.energyGridKWh;

      const alvo = 24 + (session.powerKW / evse.maxPowerKW) * 22;
      regs.temperature += (alvo - regs.temperature) * 0.05;
    }
  },

  rawValue(slaveId, key) {
    const reg = ModbusRegisters.byKey(key);
    const value = (this.values[slaveId] || {})[key] || 0;
    return Math.round(value / reg.scale);
  },

  registerTable(slaveId) {
    const regs = this.values[slaveId] || {};
    return ModbusRegisters.map.map(reg => {
      const engineering = regs[reg.key] || 0;
      const raw = Math.round(engineering / reg.scale);
      let display;
      if (reg.key === 'status') {
        display = ModbusRegisters.statusNames[raw] || String(raw);
      } else if (reg.key === 'cpState') {
        display = ModbusRegisters.cpStateNames[raw] || String(raw);
      } else {
        display = `${engineering.toFixed(reg.scale < 1 ? 2 : 0)} ${reg.unit}`.trim();
      }
      return {
        addr: '0x' + reg.addr.toString(16).toUpperCase().padStart(4, '0'),
        name: reg.name,
        type: reg.type,
        access: reg.access,
        raw: raw,
        display: display
      };
    });
  },

  readHolding(slaveId, addr, count) {
    const bytes = [slaveId, 0x03, (addr >> 8) & 0xFF, addr & 0xFF, (count >> 8) & 0xFF, count & 0xFF];
    const frame = this._frameWithCrc(bytes);
    this._pushFrame({ dir: 'tx', fc: 3, slaveId: slaveId, addr: addr, hex: frame });
    return frame;
  },

  writeSingle(slaveId, addr, value) {
    const v = Math.max(0, Math.round(value)) & 0xFFFF;
    const bytes = [slaveId, 0x06, (addr >> 8) & 0xFF, addr & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
    const frame = this._frameWithCrc(bytes);

    const regs = this.values[slaveId];
    const reg = ModbusRegisters.byAddr(addr);
    if (regs && reg) regs[reg.key] = v * reg.scale;

    const record = { dir: 'tx', fc: 6, slaveId: slaveId, addr: addr, value: v, hex: frame };
    this._pushFrame(record);
    for (const fn of this._writeListeners) {
      try {
        fn(record);
      } catch (err) {
        console.error('[ModbusBus] observador de escrita falhou:', err);
      }
    }
    return frame;
  },

  _frameWithCrc(bytes) {
    const crc = this.crc16(bytes);
    const full = bytes.concat([crc & 0xFF, (crc >> 8) & 0xFF]);
    return full.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  },

  crc16(bytes) {
    let crc = 0xFFFF;
    for (const byte of bytes) {
      crc ^= byte & 0xFF;
      for (let bit = 0; bit < 8; bit += 1) {
        if (crc & 0x0001) crc = (crc >>> 1) ^ 0xA001;
        else crc >>>= 1;
      }
    }
    return crc & 0xFFFF;
  },

  _pushFrame(record) {
    record.at = new Date(SimClock.simDate);
    this.lastFrames.push(record);
    while (this.lastFrames.length > this.maxFrames) this.lastFrames.shift();
  }
};

export default ModbusBus;
