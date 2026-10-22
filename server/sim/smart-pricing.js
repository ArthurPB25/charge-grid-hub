/** Patamar comercial: sobe na entrada de uma recarga, permanece até o local esvaziar. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TariffEngine = require('../../js/sim/tariff.js');
const SiteConfig = require('../../data/site-config.js');
import SiteModel from './site.js';
const SmartPricing = {
  displayedPrice: null, targetPrice: 0, factors: null,
  posto() { return TariffEngine.getPosto(); },
  compute(activeCount = 0) {
    let posto = this.posto();
    const base = SiteConfig.pricing.baseKWh;
    let factor = SiteConfig.pricing.scheduleFactors[posto];
    if (activeCount > 0 && SiteModel.sessions.length > 0 && this.factors?.factor > factor) {
      factor = this.factors.factor; posto = this.factors.posto;
    }
    const occupancyExtra = base * SiteConfig.pricing.additionalSessionRate * Math.max(0, activeCount - 1);
    return { posto, base, factor, activeCount, occupancyExtra, price: Math.round((base * factor + occupancyExtra) * 100) / 100 };
  },
  apply(factors) {
    this.factors = factors;
    this.targetPrice = this.displayedPrice = this.factors.price;
    return this.displayedPrice;
  },
  init() { this.apply(this.compute()); return this; },
  recompute() {
    // Uma sessão concluída ainda ocupa o ponto até fechar o resumo. Só zerar
    // o patamar quando todos os pontos estiverem livres, sem sessão pendente.
    if (this.displayedPrice === null || SiteModel.sessions.length === 0) this.apply(this.compute());
    return this.displayedPrice;
  },
  quoteNextSession() {
    return Math.max(this.currentPrice(), this.compute(SiteModel.activeSessions().length + 1).price);
  },
  sessionStarted() {
    const next = this.compute(SiteModel.activeSessions().length);
    if (this.displayedPrice === null || next.price >= this.displayedPrice) this.apply(next);
    return this.displayedPrice;
  },
  currentPrice() { return this.recompute(); },
  getBreakdown() {
    this.recompute();
    const f = this.factors;
    return [
      { label: 'Referência de mercado AC — Volvo Brasil (jun/2026)', value: f.base, kind: 'base' },
      { label: 'Faixa considerada no início do patamar — ' + TariffEngine.postoLabel(f.posto), factor: f.factor, kind: 'factor' },
      { label: `Ocupação considerada: ${f.activeCount} veículo(s) · ${SiteConfig.pricing.additionalSessionRate * 100}% da base por adicional`, value: f.occupancyExtra, kind: 'base' },
      { label: 'Patamar preservado até todas as estações ficarem livres', value: this.displayedPrice, kind: 'total' }
    ];
  }
};
export default SmartPricing;
