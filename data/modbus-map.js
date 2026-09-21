/**
 * Mapa de registradores do carregador GoodWe HCA G2.
 *
 * O tótem conversa com o carregador por Modbus RTU sobre RS-485. Os valores
 * trafegam como inteiros escalados — não há ponto flutuante no barramento — e é
 * o middleware que converte para grandezas de engenharia antes de traduzir para
 * OCPP.
 *
 * FC03 lê holding registers; FC06 escreve um registrador.
 */
const ModbusRegisters = {
  map: [
    { addr: 0x0000, name: 'Status do ponto', type: 'U16', scale: 1, unit: '', access: 'R', key: 'status' },
    { addr: 0x0002, name: 'Tensão L1', type: 'U16', scale: 0.1, unit: 'V', access: 'R', key: 'voltageL1' },
    { addr: 0x0003, name: 'Tensão L2', type: 'U16', scale: 0.1, unit: 'V', access: 'R', key: 'voltageL2' },
    { addr: 0x0004, name: 'Tensão L3', type: 'U16', scale: 0.1, unit: 'V', access: 'R', key: 'voltageL3' },
    { addr: 0x0006, name: 'Corrente L1', type: 'U16', scale: 0.01, unit: 'A', access: 'R', key: 'currentL1' },
    { addr: 0x0007, name: 'Corrente L2', type: 'U16', scale: 0.01, unit: 'A', access: 'R', key: 'currentL2' },
    { addr: 0x0008, name: 'Corrente L3', type: 'U16', scale: 0.01, unit: 'A', access: 'R', key: 'currentL3' },
    { addr: 0x000A, name: 'Potência ativa', type: 'U32', scale: 1, unit: 'W', access: 'R', key: 'activePower' },
    { addr: 0x000C, name: 'Energia acumulada', type: 'U32', scale: 0.01, unit: 'kWh', access: 'R', key: 'energyTotal' },
    { addr: 0x0010, name: 'Corrente máxima de saída', type: 'U16', scale: 1, unit: 'A', access: 'R/W', key: 'maxCurrent' },
    { addr: 0x0012, name: 'Temperatura interna', type: 'I16', scale: 0.1, unit: '°C', access: 'R', key: 'temperature' },
    { addr: 0x0014, name: 'Estado do Control Pilot', type: 'U16', scale: 1, unit: '', access: 'R', key: 'cpState' }
  ],

  // Registrador que o Controle Dinâmico de Demanda escreve para limitar a
  // corrente entregue ao veículo.
  MAX_CURRENT_ADDR: 0x0010,

  statusNames: {
    0: 'Available',
    1: 'Preparing',
    2: 'Charging',
    3: 'SuspendedEVSE',
    4: 'Finishing',
    5: 'Faulted'
  },

  // Estados do Control Pilot conforme a IEC 61851-1.
  cpStateNames: {
    1: 'A — Desconectado',
    2: 'B — Conectado',
    3: 'C — Carregando',
    4: 'D — Ventilação',
    5: 'E/F — Falha'
  },

  byKey(key) {
    return this.map.find(r => r.key === key);
  },

  byAddr(addr) {
    return this.map.find(r => r.addr === addr);
  }
};

if (typeof window !== 'undefined') window.ModbusRegisters = ModbusRegisters;
if (typeof module !== 'undefined' && module.exports) module.exports = ModbusRegisters;
