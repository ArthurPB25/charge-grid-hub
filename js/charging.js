/**
 * Adaptador da sessão do tótem sobre o cliente WebSocket do motor.
 *
 * O motor de verdade agora vive no servidor (server/sim/) — este arquivo
 * preserva a mesma interface que a tela de monitoramento já consumia
 * (`startSession`, `getSessionData`, `stopSession`, `onUpdate`), só trocando
 * `window.SimEngine` por `window.SimClient` por dentro. O fluxo do tótem não
 * precisa mudar nada além disso.
 */
window.ChargingSimulator = {
  stationId: null,
  callback: null,

  session: {
    batteryLevel: 20,
    energyDelivered: 0,
    timeElapsed: 0,
    currentCost: 0,
    currentPower: 0,
    status: 'idle'
  },

  _bound: false,

  /**
   * @param {number} stationId
   * @param {number} batteryCapacity capacidade em kWh (compatibilidade)
   * @param {object} [options] { vehicle, targetSoc, startSoc }
   */
  startSession(stationId, batteryCapacity, options) {
    const opts = options || {};
    this.stationId = stationId;

    const vehicle = opts.vehicle || this._resolveVehicle(batteryCapacity);

    const sent = window.SimClient.send('start-session', {
      stationId: stationId,
      vehicle: vehicle,
      targetSoc: opts.targetSoc,
      startSoc: opts.startSoc,
      paymentMethod: opts.paymentMethod
    });

    if (!this._bound) {
      window.SimClient.onSnapshot(snapshot => this._sync(snapshot));
      this._bound = true;
    }
    // A sessão só aparecerá nos snapshots depois da autorização MQTT.
    return sent;
  },

  /** Quando a tela não informa o veículo, escolhe o de capacidade mais próxima. */
  _resolveVehicle(batteryCapacity) {
    const alvo = batteryCapacity || 60;
    return window.MockData.vehicles
      .slice()
      .sort((a, b) => Math.abs(a.batteryCapacity - alvo) - Math.abs(b.batteryCapacity - alvo))[0];
  },

  _sync(snapshot) {
    const s = snapshot.userSession;
    if (!s) return;

    this.session = {
      batteryCapacity: s.vehicle.batteryCapacity,
      batteryLevel: s.soc * 100,
      energyDelivered: s.energyGridKWh,
      energyBattery: s.energyBatteryKWh,
      timeElapsed: Math.round(s.elapsedSim),
      currentCost: s.cost,
      currentPower: s.powerKW,
      currentA: s.currentA,
      commandedA: s.evse.commandedA,
      socTarget: s.socTarget,
      // A tela antiga espera 'completed' para abrir o resumo da sessão.
      status: s.status === 'finished' ? 'completed' : s.status,
      rateSegments: s.rateSegments,
      vehicle: s.vehicle,
      evse: s.evse
    };

    this.notify();
  },

  getSessionData() {
    return Object.assign({}, this.session);
  },

  stopSession() {
    const dadosFinais = this.getSessionData();
    window.SimClient.send('stop-session', { reason: 'Local' });
    this.session = Object.assign({}, dadosFinais, { status: 'stopped', currentPower: 0 });
    return this.getSessionData();
  },

  onUpdate(callback) {
    this.callback = callback;
  },

  notify() {
    if (this.callback) this.callback(this.getSessionData());
  }
};
