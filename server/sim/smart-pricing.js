/**
 * Smart Pricing (porta server-side de js/sim/smart-pricing.js).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TariffEngine = require('../../js/sim/tariff.js');
import SiteModel from './site.js';
import DemandController from './demand.js';

const SmartPricing = {
  solarCostKWh: 0.18,

  markupRate: 1.22,
  markupFixed: 0.52,

  floor: 0.55,
  ceiling: 3.20,

  rampStep: 0.02,

  displayedPrice: null,
  targetPrice: 0,
  factors: null,

  init() {
    const computed = this.compute();
    this.targetPrice = computed.price;
    this.displayedPrice = computed.price;
    this.factors = computed;
    return this;
  },

  posto() {
    return TariffEngine.getPosto();
  },

  compute() {
    const posto = this.posto();
    const custoRede = TariffEngine.custoKWh(posto);

    const solarFraction = SiteModel.solarFraction();
    const occupancy = SiteModel.occupancy();
    const state = DemandController.state;

    const custoMix = custoRede * (1 - solarFraction) + this.solarCostKWh * solarFraction;
    const precoBase = custoMix * this.markupRate + this.markupFixed;

    const kOccupancy = Math.min(1.18, Math.max(0.85, 1 + 0.35 * (occupancy - 0.5)));

    const kSchedule = { ponta: 1.12, inter: 1.05, fora: 0.96 }[posto];

    const kSolar = 1 - 0.10 * solarFraction;
    const kScarcity = (state === 'LIMITANDO' || state === 'SUSPENSO') ? 1.10 : 1.00;

    const raw = precoBase * kOccupancy * kSchedule * kSolar * kScarcity;
    const price = Math.min(this.ceiling, Math.max(this.floor, raw));

    return {
      posto: posto,
      custoRede: custoRede,
      custoMix: custoMix,
      precoBase: precoBase,
      solarFraction: solarFraction,
      occupancy: occupancy,
      kOccupancy: kOccupancy,
      kSchedule: kSchedule,
      kSolar: kSolar,
      kScarcity: kScarcity,
      raw: raw,
      price: price,
      clamped: raw !== price
    };
  },

  recompute() {
    const computed = this.compute();
    this.factors = computed;
    this.targetPrice = computed.price;

    if (this.displayedPrice === null) {
      this.displayedPrice = computed.price;
      return this.displayedPrice;
    }

    const delta = this.targetPrice - this.displayedPrice;
    if (Math.abs(delta) <= this.rampStep) {
      this.displayedPrice = this.targetPrice;
    } else {
      this.displayedPrice += Math.sign(delta) * this.rampStep;
    }
    return this.displayedPrice;
  },

  currentPrice() {
    if (this.displayedPrice === null) this.init();
    return this.displayedPrice;
  },

  getBreakdown() {
    const f = this.factors || this.compute();
    const rows = TariffEngine.breakdown(f.posto).slice();

    if (f.solarFraction > 0.005) {
      rows.push({
        label: `Mistura solar (${(f.solarFraction * 100).toFixed(0)}% a R$ ${this.solarCostKWh.toFixed(2)})`,
        value: f.custoMix - f.custoRede,
        kind: 'discount'
      });
    }

    rows.push({
      label: `Margem do operador (${((this.markupRate - 1) * 100).toFixed(0)}% + R$ ${this.markupFixed.toFixed(2)})`,
      value: f.precoBase - f.custoMix,
      kind: 'base'
    });
    rows.push({ label: 'Preço base', value: f.precoBase, kind: 'subtotal' });

    rows.push({
      label: `Ocupação do eletroposto (${(f.occupancy * 100).toFixed(0)}%)`,
      factor: f.kOccupancy,
      kind: 'factor'
    });
    rows.push({
      label: `Posto tarifário — ${TariffEngine.postoLabel(f.posto)}`,
      factor: f.kSchedule,
      kind: 'factor'
    });
    rows.push({
      label: f.solarFraction > 0.005
        ? `Excedente solar (${(f.solarFraction * 100).toFixed(0)}% da carga)`
        : 'Excedente solar (indisponível)',
      factor: f.kSolar,
      kind: 'factor'
    });

    if (f.kScarcity > 1) {
      rows.push({ label: 'Restrição de rede ativa', factor: f.kScarcity, kind: 'factor' });
    }

    rows.push({ label: 'Preço final', value: this.currentPrice(), kind: 'total' });
    return rows;
  }
};

export default SmartPricing;
