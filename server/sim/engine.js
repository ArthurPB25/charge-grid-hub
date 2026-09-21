/**
 * Orquestrador da simulação (porta server-side de js/sim/engine.js).
 *
 * Roda como única instância no processo do servidor, iniciada uma vez no
 * startup — totem e admin conectam por WebSocket e recebem o snapshot() a
 * cada tick, em vez de cada um rodar sua própria cópia do motor.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MockData = require('../../data/mock-data.js');
const ModbusRegisters = require('../../data/modbus-map.js');
const TariffEngine = require('../../js/sim/tariff.js');

import SimClock from './clock.js';
import SiteModel from './site.js';
import EVPhysics from './ev-physics.js';
import ChargeSession from './session.js';
import DemandController from './demand.js';
import SmartPricing from './smart-pricing.js';
import ModbusBus from './modbus.js';
import OcppClient from './ocpp.js';

const SimEngine = {
  started: false,
  userSession: null,

  _updateListeners: [],
  _relayListeners: [],
  _meterTimers: {},
  meterIntervalSim: 60,

  // Acumulado do dia simulado corrente — o painel admin usava dados fixos de
  // um mock histórico (agosto de 2026); agora reflete o que de fato
  // aconteceu nesta simulação. Zera na virada de dia simulado (ver _tick),
  // e o dia que fecha vira uma entrada em dailyHistory.
  today: { sessions: 0, energyKWh: 0, revenue: 0 },
  _dayKey: null,

  // Um registro por dia simulado que já se completou nesta execução do
  // servidor. Começa vazio a cada boot — sem preencher com histórico
  // inventado, só cresce com dias que realmente passaram na simulação.
  dailyHistory: [],

  // Sessões concluídas (ambiente ou do tótem) sobrevivem aqui depois de
  // saírem de SiteModel.sessions — sem isso, uma sessão "ambiente" (outro
  // cliente carregando num dos outros pontos, fora do tótem à sua frente)
  // contava para o KPI "Sessões Hoje" mas sumia das tabelas de histórico
  // no mesmo tick em que terminava, uma inconsistência dos dois lugares
  // mostrarem números diferentes para a mesma coisa.
  sessionHistory: [],

  ambientTags: ['04A3B2C1D5', '04F19E7A22', '048C5D3311'],

  boot(options) {
    const opts = options || {};
    if (this.started) return this;

    SimClock.init();
    this._dayKey = this._dayKeyOf(SimClock.simDate);
    SiteModel.init();
    DemandController.init();
    ModbusBus.init();
    OcppClient.init();
    SmartPricing.init();

    const manutencao = SiteModel.getEvse(4);
    if (manutencao) manutencao.status = 'Unavailable';

    this._wireProtocol();
    for (const evse of SiteModel.evses) {
      OcppClient.bootNotification(evse);
    }

    this.seedAmbientSessions(opts.ambient == null ? 2 : opts.ambient);

    SimClock.onTick((dt, date, meta) => this._tick(dt, date, meta));
    SimClock.start();

    this.started = true;
    return this;
  },

  /**
   * Liga o controle de demanda à camada de protocolo: toda decisão de limitar
   * corrente vira uma escrita Modbus real e o perfil de carga OCPP
   * correspondente. As transições de corrente 0<->não-zero da sessão do
   * totem viram um evento de relé (ver onRelay) em vez de chamar o
   * MqttBridge direto — esse bridge agora vive só no navegador do totem.
   */
  _wireProtocol() {
    DemandController.onCommand(cmd => {
      ModbusBus.writeSingle(
        cmd.evse.slaveId,
        ModbusRegisters.MAX_CURRENT_ADDR,
        cmd.toA
      );
      OcppClient.setChargingProfile(cmd.evse, cmd.toA, cmd.session);

      if (cmd.toA === 0) {
        OcppClient.statusNotification(cmd.evse, 'SuspendedEVSE');
      } else if (cmd.fromA === 0) {
        OcppClient.statusNotification(cmd.evse, 'Charging');
      }

      if (cmd.session === this.userSession) {
        if (cmd.toA === 0) this._emitRelay('DESLIGAR');
        else if (cmd.fromA === 0) this._emitRelay('LIGAR');
      }
    });
  },

  onRelay(fn) {
    if (typeof fn === 'function') this._relayListeners.push(fn);
  },

  _emitRelay(command) {
    for (const fn of this._relayListeners) {
      try {
        fn(command);
      } catch (err) {
        console.error('[SimEngine] observador de relé falhou:', err);
      }
    }
  },

  seedAmbientSessions(count) {
    const disponiveis = SiteModel.evses.filter(e => e.status === 'Available' && e.id !== 1);
    const veiculos = MockData.vehicles;

    for (let i = 0; i < count && i < disponiveis.length; i += 1) {
      const evse = disponiveis[i];
      const vehicle = veiculos[Math.floor(Math.random() * veiculos.length)];
      const session = ChargeSession.create({
        evseId: evse.id,
        vehicle: vehicle,
        targetSoc: 0.8,
        ambient: true
      });
      session.elapsedSim = 600 + Math.random() * 2400;
      SiteModel.addSession(session);

      const tag = this.ambientTags[i % this.ambientTags.length];
      OcppClient.authorize(tag, evse);
      OcppClient.startTransaction(session, tag);
    }
  },

  startUserSession(config) {
    const evse = SiteModel.getEvseByStation(config.stationId);
    if (!evse) return null;

    // Se a sessão anterior do motorista ficou pendurada (ele saiu da tela —
    // deu refresh, o tablet dormiu — sem passar por stopUserSession), ela
    // nunca seria limpa sozinha: sessões do usuário que terminam não são
    // removidas automaticamente, só as ambiente (ver _tick). Sem isso, o
    // EVSE dela ficava "Charging" para sempre e nenhuma estação nova
    // aparecia disponível no tótem.
    if (this.userSession) {
      if (this.userSession.status !== 'finished') this.userSession.finish();
      OcppClient.stopTransaction(this.userSession, 'Local');
      SiteModel.removeSession(this.userSession);
      this.userSession = null;
    }

    const session = ChargeSession.create({
      evseId: evse.id,
      vehicle: config.vehicle,
      targetSoc: config.targetSoc != null ? config.targetSoc : 0.8,
      startSoc: config.startSoc
    });

    SiteModel.addSession(session);
    this.userSession = session;

    const tag = config.idTag || 'CG-TOTEM-01';
    OcppClient.authorize(tag, evse);
    OcppClient.startTransaction(session, tag);

    this._emitRelay('LIGAR');

    return session;
  },

  stopUserSession(reason) {
    const session = this.userSession;
    if (!session) return null;
    if (session.status !== 'finished') session.finish();
    OcppClient.stopTransaction(session, reason || 'Local');
    SiteModel.removeSession(session);
    this.userSession = null;

    this._emitRelay('DESLIGAR');

    return session;
  },

  /** Coloca um EVSE em manutenção ou libera (comando de escrita do admin). */
  toggleStation(evseId) {
    const evse = SiteModel.getEvse(evseId);
    if (!evse) return;

    if (evse.status === 'Unavailable') {
      evse.status = 'Available';
      OcppClient.statusNotification(evse, 'Available');
      return;
    }

    const sessao = SiteModel.sessions.find(s => s.evseId === evse.id && s.status !== 'finished');
    if (sessao) {
      sessao.finish();
      OcppClient.stopTransaction(sessao, 'Other');
      SiteModel.removeSession(sessao);
    }
    evse.status = 'Unavailable';
    OcppClient.statusNotification(evse, 'Unavailable');
  },

  /** Estimativa de custo/tempo antes de existir sessão (porta de js/pricing.js calculateEstimate). */
  estimate({ stationId, vehicleId, batteryLevel, targetSoc, capKW } = {}) {
    const vehicle = MockData.vehicles.find(v => v.id === vehicleId);
    const evse = SiteModel.getEvseByStation(stationId) || SiteModel.evses[0];
    if (!vehicle || !evse) return null;

    const socNow = (batteryLevel == null ? 20 : batteryLevel) / 100;
    const socTarget = targetSoc != null ? targetSoc : 0.8;
    const rate = SmartPricing.currentPrice();
    const capacity = vehicle.batteryCapacity;

    const energyBattery = Math.max(0, socTarget - socNow) * capacity;
    const estimatedEnergy = energyBattery / EVPhysics.efficiency[evse.current];
    const estimatedCost = estimatedEnergy * rate;
    const estimatedMinutes = EVPhysics.estimateMinutesToTarget(vehicle, evse, socNow, socTarget, capKW);

    return { estimatedCost, estimatedEnergy, estimatedMinutes, rate };
  },

  onUpdate(fn) {
    if (typeof fn === 'function') this._updateListeners.push(fn);
  },

  /** Chave de dia calendário (não UTC) a partir da data simulada, ex: "2026-08-25". */
  _dayKeyOf(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  _tick(dtSim, simDate, meta) {
    const dayKey = this._dayKeyOf(simDate);
    if (dayKey !== this._dayKey) {
      this.dailyHistory.push({ date: this._dayKey, ...this.today });
      if (this.dailyHistory.length > 30) this.dailyHistory.shift();
      this.today = { sessions: 0, energyKWh: 0, revenue: 0 };
      this._dayKey = dayKey;
    }

    if (!meta || !meta.jumped) {
      SiteModel.step(dtSim);
    } else {
      SiteModel.step(0);
    }

    DemandController.measure(dtSim);
    const setpoints = DemandController.allocate();

    const price = SmartPricing.recompute();
    const posto = TariffEngine.getPosto();

    for (const session of SiteModel.sessions.slice()) {
      if (session.status === 'finished') continue;
      const before = session.status;
      session.step(dtSim, setpoints.get(session) || 0, price, posto);

      if (session.status === 'finished' && before !== 'finished') {
        OcppClient.stopTransaction(session, 'EVDisconnected');
        this.today.sessions += 1;
        this.today.energyKWh += session.energyGridKWh;
        this.today.revenue += session.cost;
        this.sessionHistory.push(this._serializeSession(session));
        if (this.sessionHistory.length > 200) this.sessionHistory.shift();
        if (session.ambient) SiteModel.removeSession(session);
      }
    }

    ModbusBus.refresh();
    this._emitMeterValues(dtSim);
    this._notify();
  },

  _emitMeterValues(dtSim) {
    for (const session of SiteModel.sessions) {
      if (session.status !== 'charging') continue;
      const acc = (this._meterTimers[session.id] || 0) + dtSim;
      if (acc >= this.meterIntervalSim) {
        this._meterTimers[session.id] = 0;
        OcppClient.meterValues(session);
      } else {
        this._meterTimers[session.id] = acc;
      }
    }
  },

  _notify() {
    const snapshot = this.snapshot();
    for (const fn of this._updateListeners) {
      try {
        fn(snapshot);
      } catch (err) {
        console.error('[SimEngine] observador falhou:', err);
      }
    }
  },

  /** Sessão viva -> POJO serializável (o cliente não recebe métodos). */
  _serializeSession(session) {
    if (!session) return null;
    return {
      id: session.id,
      transactionId: session.transactionId,
      evseId: session.evseId,
      evse: session.evse,
      vehicle: session.vehicle,
      ambient: session.ambient,
      socStart: session.socStart,
      soc: session.soc,
      socTarget: session.socTarget,
      energyGridKWh: session.energyGridKWh,
      energyBatteryKWh: session.energyBatteryKWh,
      elapsedSim: session.elapsedSim,
      powerKW: session.powerKW,
      currentA: session.currentA,
      setpointKW: session.setpointKW,
      status: session.status,
      suspendedFor: session.suspendedFor,
      cost: session.cost,
      rateSegments: session.rateSegments,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      minutesRemaining: session.minutesRemaining(
        session.evse.commandedA ? EVPhysics.currentToPower(session.evse.commandedA, session.evse) : null
      )
    };
  },

  snapshot() {
    return {
      time: SimClock.formatTime(),
      date: SimClock.formatDate(),
      clock: {
        simDate: SimClock.simDate,
        hourFloat: SimClock.hourFloat(),
        isWeekday: SimClock.isWeekday(),
        running: SimClock.running,
        speed: SimClock.speed
      },
      demand: DemandController.snapshot(),
      site: {
        buildingKW: SiteModel.buildingLoadKW(),
        solarKW: SiteModel.solarKW,
        netKW: SiteModel.netGridKW(),
        evKW: SiteModel.totalEvKW(),
        surplusKW: SiteModel.solarSurplusKW(),
        occupancy: SiteModel.occupancy(),
        demoPeak: SiteModel.demoPeakKW > 0,
        demoPeakKW: SiteModel.demoPeakKW,
        limitKW: SiteModel.limitKW()
      },
      evses: SiteModel.evses,
      sessions: SiteModel.sessions.map(s => this._serializeSession(s)),
      sessionHistory: this.sessionHistory,
      today: this.today,
      dailyHistory: this.dailyHistory,
      price: SmartPricing.currentPrice(),
      priceBreakdown: SmartPricing.getBreakdown(),
      posto: TariffEngine.getPosto(),
      userSession: this._serializeSession(this.userSession)
    };
  }
};

export default SimEngine;
export { SimClock, SiteModel, DemandController, ModbusBus, OcppClient, EVPhysics };
