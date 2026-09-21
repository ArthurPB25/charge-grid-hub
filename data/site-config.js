/**
 * Configuração do estabelecimento onde o ChargeGrid Hub está instalado.
 *
 * O tótem não é o carregador: ele se acopla a carregadores GoodWe HCA G2 já
 * existentes e precisa respeitar a demanda contratada do prédio junto à
 * concessionária. Todos os números abaixo descrevem esse contexto elétrico.
 */
const SiteConfig = {
  name: 'Shopping Central — Estacionamento G2',

  // Demanda contratada junto à concessionária (kW). Estourar este valor
  // dispara a proteção e gera multa por ultrapassagem.
  contractedDemandKW: 75,

  // Margem de segurança sobre a demanda contratada. O controlador nunca
  // permite que o site chegue aos 100% do contrato.
  safetyMargin: 0.05,

  // Geração fotovoltaica instalada (inversor híbrido GoodWe). O sistema foi
  // dimensionado acima do consumo próprio justamente para sobrar geração no
  // meio do dia e alimentar os carregadores.
  solarKWp: 90,

  // Instante em que a simulação começa. Terça-feira, 15h: ainda há geração
  // solar relevante e o horário de ponta (18h) chega em poucos minutos de
  // gravação, permitindo demonstrar a virada de tarifa.
  startISO: '2026-08-25T15:00:00',

  /**
   * Curva de carga base do estabelecimento, em kW, por hora do dia.
   * Perfil comercial: mínimo de madrugada (refrigeração e segurança), rampa
   * pela manhã e pico no meio da tarde por conta da climatização.
   */
  baseLoadByHour: [
    11, 10, 10, 10, 11, 13, 17, 23, 31, 38, 43, 47,
    49, 48, 50, 52, 51, 47, 41, 35, 28, 22, 17, 13
  ],

  /**
   * Geração solar em kW por hora do dia, para os 90 kWp instalados.
   * Dia de céu limpo; a variação por nuvens é aplicada em tempo de execução.
   * Entre 10h e 15h a geração supera a carga do prédio e o excedente fica
   * disponível para a recarga — é a terceira variável do Smart Pricing.
   */
  solarByHour: [
    0, 0, 0, 0, 0, 0, 2, 9, 21, 36, 51, 63,
    68, 66, 58, 43, 27, 12, 3.5, 0.4, 0, 0, 0, 0
  ],

  /**
   * Pontos de recarga. Cada um corresponde a uma estação em mock-data.js e a
   * um escravo Modbus no barramento RS-485.
   *
   * Os quatro pontos são idênticos de propósito: um único modelo de
   * carregador GoodWe HCA G2, 230 V monofásico, 7,4 kW, 32 A, conector
   * Tipo 2 — sem variação de potência nem opção de carga rápida entre eles.
   */
  evses: [
    { id: 1, stationId: 1, slaveId: 11, phases: 1, voltage: 230, iMax: 32, maxPowerKW: 7.36, connector: 'Tipo 2', current: 'ac' },
    { id: 2, stationId: 2, slaveId: 12, phases: 1, voltage: 230, iMax: 32, maxPowerKW: 7.36, connector: 'Tipo 2', current: 'ac' },
    { id: 3, stationId: 3, slaveId: 13, phases: 1, voltage: 230, iMax: 32, maxPowerKW: 7.36, connector: 'Tipo 2', current: 'ac' },
    { id: 4, stationId: 4, slaveId: 14, phases: 1, voltage: 230, iMax: 32, maxPowerKW: 7.36, connector: 'Tipo 2', current: 'ac' }
  ],

  // Corrente mínima de operação segundo a IEC 61851. Abaixo disso o veículo
  // não aceita carga: é preciso suspender a sessão, não reduzi-la mais.
  minCurrentA: 6,

  // Degrau de carga injetado pelo gatilho de demonstração (kW).
  demoPeakStepKW: 18
};

// Dual-mode: mesmo arquivo funciona como <script> global no navegador e como
// módulo requerível no servidor (via createRequire), sem duplicar conteúdo.
if (typeof window !== 'undefined') window.SiteConfig = SiteConfig;
if (typeof module !== 'undefined' && module.exports) module.exports = SiteConfig;
