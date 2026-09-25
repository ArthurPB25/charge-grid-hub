/**
 * Fachada de tarifação usada pelas telas.
 *
 * `isPeakHour`/`posto`/`postoLabel` continuam lendo js/sim/tariff.js local
 * (ele roda dual-mode, tanto no navegador quanto no servidor — ver seção 0
 * do plano de migração). `getCurrentRate`/`getBreakdown` agora leem o
 * snapshot ao vivo do servidor via `window.SimClient`. `calculateEstimate`
 * virou uma chamada de rede porque depende da física do EVSE/veículo, que só
 * o motor (agora server-side) sabe calcular.
 */
window.PricingEngine = {
  isPeakHour(date) {
    return window.TariffEngine.getPosto(date) === 'ponta';
  },

  posto(date) {
    return window.TariffEngine.getPosto(date);
  },

  postoLabel(date) {
    return window.TariffEngine.postoLabel(window.TariffEngine.getPosto(date));
  },

  /** Preço praticado agora, em R$/kWh — vem do último snapshot recebido. */
  getCurrentRate() {
    return window.SimClient.snapshot ? window.SimClient.snapshot.price : 0;
  },

  /**
   * Estimativa de energia, custo e tempo até o alvo. Chama o servidor
   * (POST /api/estimate) porque a conta depende da curva de carga do EVSE e
   * do veículo, que só o motor sabe calcular.
   */
  async calculateEstimate(batteryLevel, batteryCapacity, options) {
    const opts = options || {};
    const resposta = await fetch(`${window.ChargeGridConfig.apiOrigin}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stationId: opts.stationId,
        vehicleId: opts.vehicle ? opts.vehicle.id : null,
        batteryLevel: batteryLevel,
        targetSoc: opts.targetSoc,
        capKW: opts.capKW
      })
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new Error(dados.erro || 'Não foi possível calcular a estimativa.');
    }
    return {
      estimatedCost: dados.estimatedCost,
      estimatedEnergy: dados.estimatedEnergy,
      estimatedMinutes: dados.estimatedMinutes,
      estimatedTime: this.formatDuration(dados.estimatedMinutes),
      rate: dados.rate
    };
  },

  formatDuration(minutes) {
    if (minutes < 1) return 'menos de 1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  },

  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value || 0);
  },

  /** Composição do preço, linha a linha — vem do último snapshot recebido. */
  getBreakdown() {
    return window.SimClient.snapshot ? window.SimClient.snapshot.priceBreakdown : [];
  }
};
