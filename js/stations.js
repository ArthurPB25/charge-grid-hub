window.StationManager = {
  stations: [],
  selectedStationId: null,

  init() {
    // Clone to avoid mutating original mock
    this.stations = JSON.parse(JSON.stringify(window.MockData.stations));
  },

  getStations() {
    if (!this.stations.length) this.init();
    return this.stations;
  },

  getAvailableCount() {
    return this.getStations().filter(s => s.status === 'available').length;
  },

  getStation(id) {
    return this.getStations().find(s => s.id === id);
  },

  selectStation(id) {
    const station = this.getStation(id);
    if (station && station.status === 'available') {
      this.selectedStationId = id;
      return station;
    }
    return null;
  },

  getSelectedStation() {
    if (!this.selectedStationId) return null;
    return this.getStation(this.selectedStationId);
  },

  updateStationStatus(id, status) {
    const station = this.getStation(id);
    if (station) {
      station.status = status;
      // trigger event or callback if needed
    }
  },

  /**
   * Estimativa para a estação selecionada. Só existe depois que o motorista
   * escolhe o veículo — antes disso não há bateria nem SoC de chegada reais
   * para calcular, e mostrar um número de um "veículo médio" inventado
   * passaria a impressão de um custo que ainda não é sabido de verdade.
   *
   * Assíncrona porque o cálculo agora roda no servidor (depende da curva de
   * carga do EVSE/veículo, que só o motor sabe).
   */
  async getEstimate() {
    if (!this.selectedStationId) return null;

    const app = window.App || {};
    const vehicle = app.selectedVehicle || null;
    if (!vehicle) return null;

    const socInicial = app.arrivalSoc != null ? app.arrivalSoc * 100 : 30;

    return window.PricingEngine.calculateEstimate(
      socInicial,
      vehicle.batteryCapacity,
      {
        vehicle,
        stationId: this.selectedStationId,
        targetSoc: app.targetSoc != null ? app.targetSoc : 0.8
      }
    );
  }
};
