/**
 * Estrutura tarifária brasileira (modalidade Tarifa Branca, ANEEL).
 *
 * O preço da energia no Brasil não é um número só: separa-se em TE (energia) e
 * TUSD (uso do sistema de distribuição), soma-se a bandeira tarifária vigente e
 * os tributos incidem "por dentro", ou seja, sobre o próprio valor final.
 *
 * A Tarifa Branca tem três postos e só vale em dias úteis — fim de semana e
 * feriado são integralmente fora-ponta.
 */
const TariffEngine = {
  // R$/kWh, sem tributos.
  //
  // Na Tarifa Branca quem varia entre os postos é a TUSD, não a TE: o que
  // encarece o horário de ponta é o uso do sistema de distribuição, e não o
  // preço da energia em si.
  te: { fora: 0.32, inter: 0.32, ponta: 0.32 },
  tusd: { fora: 0.25, inter: 0.49, ponta: 0.90 },

  // Adicional por bandeira, em R$/kWh.
  bandeiras: { verde: 0, amarela: 0.0195, vermelha1: 0.0446, vermelha2: 0.0779 },
  bandeiraAtual: 'amarela',

  tributos: { icms: 0.18, pis: 0.0165, cofins: 0.076 },

  labels: {
    fora: 'Fora-ponta',
    inter: 'Intermediário',
    ponta: 'Ponta'
  },

  /**
   * Posto tarifário vigente. Usa o horário real do dispositivo, não o
   * relógio acelerado da simulação — o preço cobrado tem que bater com a
   * hora que o motorista vê na tela, mesmo que a própria sessão de
   * carregamento avance mais rápido que o tempo real.
   */
  getPosto(date) {
    const d = date || new Date();
    const day = d.getDay();
    if (day === 0 || day === 6) return 'fora';

    const h = d.getHours() + d.getMinutes() / 60;
    if (h >= 18 && h < 21) return 'ponta';
    if ((h >= 17 && h < 18) || (h >= 21 && h < 22)) return 'inter';
    return 'fora';
  },

  postoLabel(posto) {
    return this.labels[posto] || posto;
  },

  /** Alíquota total dos tributos que incidem sobre a tarifa. */
  aliquotaTotal() {
    return this.tributos.icms + this.tributos.pis + this.tributos.cofins;
  },

  /** TE + TUSD + bandeira, ainda sem tributos. */
  tarifaBruta(posto) {
    return this.te[posto] + this.tusd[posto] + this.bandeiras[this.bandeiraAtual];
  },

  /**
   * Custo final por kWh para o operador do eletroposto.
   * Os tributos são calculados por dentro: divide-se pela alíquota complementar.
   */
  custoKWh(posto) {
    return this.tarifaBruta(posto) / (1 - this.aliquotaTotal());
  },

  /** Quanto do preço final é imposto, em R$/kWh. */
  parcelaTributos(posto) {
    return this.custoKWh(posto) - this.tarifaBruta(posto);
  },

  /** Faixas horárias do dia, para desenhar a linha do tempo tarifária. */
  postosDoDia(isWeekday) {
    if (!isWeekday) return [{ from: 0, to: 24, posto: 'fora' }];
    return [
      { from: 0, to: 17, posto: 'fora' },
      { from: 17, to: 18, posto: 'inter' },
      { from: 18, to: 21, posto: 'ponta' },
      { from: 21, to: 22, posto: 'inter' },
      { from: 22, to: 24, posto: 'fora' }
    ];
  },

  /** Composição do custo da energia, linha a linha, para exibição. */
  breakdown(posto) {
    const p = posto || this.getPosto();
    const bandeira = this.bandeiras[this.bandeiraAtual];
    return [
      { label: `TE — Energia (${this.postoLabel(p).toLowerCase()})`, value: this.te[p], kind: 'base' },
      { label: 'TUSD — Uso da distribuição', value: this.tusd[p], kind: 'base' },
      { label: `Bandeira ${this.bandeiraAtual}`, value: bandeira, kind: 'base' },
      { label: 'Tributos (ICMS 18% + PIS/COFINS 9,25%)', value: this.parcelaTributos(p), kind: 'tax' },
      { label: 'Custo da energia', value: this.custoKWh(p), kind: 'subtotal' }
    ];
  }
};

if (typeof window !== 'undefined') window.TariffEngine = TariffEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = TariffEngine;
