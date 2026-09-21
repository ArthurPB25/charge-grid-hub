/**
 * Cliente OCPP 1.6J (porta server-side de js/sim/ocpp.js).
 */
import SimClock from './clock.js';
import ModbusBus from './modbus.js';

const OcppClient = {
  frames: [],
  maxFrames: 60,

  _seq: 0,
  _listeners: [],

  init() {
    this.frames = [];
    this._seq = 0;
    return this;
  },

  onFrame(fn) {
    if (typeof fn === 'function') this._listeners.push(fn);
  },

  _messageId() {
    this._seq += 1;
    return String(19223200 + this._seq);
  },

  _timestamp() {
    return SimClock.simDate.toISOString();
  },

  call(action, payload, meta) {
    const frame = [2, this._messageId(), action, payload];
    return this._push(frame, action, meta);
  },

  result(messageId, payload, action) {
    const frame = [3, messageId, payload];
    return this._push(frame, action ? action + '.conf' : 'CallResult', { kind: 'result' });
  },

  _push(frame, action, meta) {
    const record = Object.assign({
      frame: frame,
      action: action,
      messageId: frame[1],
      json: JSON.stringify(frame),
      pretty: JSON.stringify(frame, null, 2),
      at: new Date(SimClock.simDate)
    }, meta || {});

    this.frames.push(record);
    while (this.frames.length > this.maxFrames) this.frames.shift();

    for (const fn of this._listeners) {
      try {
        fn(record);
      } catch (err) {
        console.error('[OcppClient] observador falhou:', err);
      }
    }
    return record;
  },

  bootNotification(evse) {
    const call = this.call('BootNotification', {
      chargePointVendor: 'GoodWe',
      chargePointModel: 'HCA G2',
      chargePointSerialNumber: 'HCA2-' + String(evse.slaveId).padStart(4, '0'),
      firmwareVersion: '1.4.2',
      meterType: 'Integrated MID'
    }, { evseId: evse.id });

    this.result(call.messageId, {
      status: 'Accepted',
      currentTime: this._timestamp(),
      interval: 300
    }, 'BootNotification');
    return call;
  },

  authorize(idTag, evse) {
    const call = this.call('Authorize', { idTag: idTag }, { evseId: evse && evse.id });
    this.result(call.messageId, { idTagInfo: { status: 'Accepted' } }, 'Authorize');
    return call;
  },

  startTransaction(session, idTag) {
    const call = this.call('StartTransaction', {
      connectorId: 1,
      idTag: idTag || 'CG-' + session.id,
      meterStart: Math.round(session.energyGridKWh * 1000),
      timestamp: this._timestamp()
    }, { evseId: session.evseId, sessionId: session.id });

    this.result(call.messageId, {
      transactionId: session.transactionId,
      idTagInfo: { status: 'Accepted' }
    }, 'StartTransaction');
    return call;
  },

  meterValues(session) {
    const evse = session.evse;
    const regs = (ModbusBus.values || {})[evse.slaveId] || {};
    const sampled = [
      {
        value: String(Math.round(session.energyGridKWh * 1000)),
        context: 'Sample.Periodic',
        measurand: 'Energy.Active.Import.Register',
        location: 'Outlet',
        unit: 'Wh'
      },
      {
        value: String(Math.round(session.powerKW * 1000)),
        context: 'Sample.Periodic',
        measurand: 'Power.Active.Import',
        location: 'Outlet',
        unit: 'W'
      },
      {
        value: (regs.currentL1 || 0).toFixed(1),
        context: 'Sample.Periodic',
        measurand: 'Current.Import',
        phase: 'L1',
        location: 'Outlet',
        unit: 'A'
      },
      {
        value: (regs.voltageL1 || evse.voltage).toFixed(1),
        context: 'Sample.Periodic',
        measurand: 'Voltage',
        phase: 'L1-N',
        location: 'Outlet',
        unit: 'V'
      },
      {
        value: String(Math.round(session.soc * 100)),
        context: 'Sample.Periodic',
        measurand: 'SoC',
        location: 'EV',
        unit: 'Percent'
      }
    ];

    return this.call('MeterValues', {
      connectorId: 1,
      transactionId: session.transactionId,
      meterValue: [{ timestamp: this._timestamp(), sampledValue: sampled }]
    }, { evseId: evse.id, sessionId: session.id });
  },

  statusNotification(evse, status, errorCode) {
    return this.call('StatusNotification', {
      connectorId: 1,
      errorCode: errorCode || 'NoError',
      status: status,
      timestamp: this._timestamp()
    }, { evseId: evse.id });
  },

  setChargingProfile(evse, limitA, session) {
    const call = this.call('SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: {
        chargingProfileId: 100 + evse.id,
        transactionId: session ? session.transactionId : undefined,
        stackLevel: 0,
        chargingProfilePurpose: 'TxProfile',
        chargingProfileKind: 'Absolute',
        chargingSchedule: {
          chargingRateUnit: 'A',
          chargingSchedulePeriod: [
            { startPeriod: 0, limit: limitA, numberPhases: evse.phases }
          ]
        }
      }
    }, { evseId: evse.id, highlight: true });

    this.result(call.messageId, { status: 'Accepted' }, 'SetChargingProfile');
    return call;
  },

  stopTransaction(session, reason) {
    const call = this.call('StopTransaction', {
      transactionId: session.transactionId,
      meterStop: Math.round(session.energyGridKWh * 1000),
      timestamp: this._timestamp(),
      reason: reason || 'Local'
    }, { evseId: session.evseId, sessionId: session.id });

    this.result(call.messageId, { idTagInfo: { status: 'Accepted' } }, 'StopTransaction');
    return call;
  }
};

export default OcppClient;
