const MockData = {
  stations: [
    { id: 1, name: 'Estação 01', connector: 'Tipo 2', maxPower: 7.4, status: 'available', location: 'Vaga A1' },
    { id: 2, name: 'Estação 02', connector: 'Tipo 2', maxPower: 7.4, status: 'charging', location: 'Vaga A2', currentSession: { vehicleName: 'BYD Dolphin', batteryLevel: 65, energyDelivered: 12.5, startTime: Date.now() - 3600000, estimatedEnd: Date.now() + 1800000 } },
    { id: 3, name: 'Estação 03', connector: 'Tipo 2', maxPower: 7.4, status: 'available', location: 'Vaga B1' },
    { id: 4, name: 'Estação 04', connector: 'Tipo 2', maxPower: 7.4, status: 'maintenance', location: 'Vaga B2' }
  ],
  vehicles: [
    {
      id: 'dolphin-mini',
      brand: 'BYD',
      model: 'Dolphin Mini',
      image: 'electric_car',
      batteryCapacity: 38.8,
      range: 280,
      connectorType: 'Tipo 2',
      maxChargePower: { ac: 6.6, dc: 40 },
      year: 2025
    },
    {
      id: 'dolphin',
      brand: 'BYD',
      model: 'Dolphin',
      image: 'electric_car',
      batteryCapacity: 44.9,
      range: 291,
      connectorType: 'Tipo 2',
      maxChargePower: { ac: 7, dc: 60 },
      year: 2025
    },
    {
      id: 'dolphin-plus',
      brand: 'BYD',
      model: 'Dolphin Plus',
      image: 'electric_car',
      batteryCapacity: 60.48,
      range: 330,
      connectorType: 'Tipo 2',
      maxChargePower: { ac: 7, dc: 80 },
      year: 2025
    },
    {
      id: 'byd-seal',
      brand: 'BYD',
      model: 'Seal',
      image: 'electric_car',
      batteryCapacity: 82.5,
      range: 372,
      connectorType: 'CCS2',
      maxChargePower: { ac: 11, dc: 150 },
      year: 2025
    },
    {
      id: 'ora-03',
      brand: 'GWM',
      model: 'Ora 03',
      image: 'electric_car',
      batteryCapacity: 48,
      range: 232,
      connectorType: 'Tipo 2',
      maxChargePower: { ac: 6.6, dc: 64 },
      year: 2025
    },
    {
      id: 'volvo-ex30',
      brand: 'Volvo',
      model: 'EX30',
      image: 'electric_car',
      batteryCapacity: 51,
      range: 250,
      connectorType: 'CCS2',
      maxChargePower: { ac: 11, dc: 130 },
      year: 2025
    },
    {
      id: 'tesla-model3',
      brand: 'Tesla',
      model: 'Model 3',
      image: 'electric_car',
      batteryCapacity: 60,
      range: 534,
      connectorType: 'CCS2',
      maxChargePower: { ac: 11, dc: 170 },
      year: 2025
    },
    {
      id: 'equinox-ev',
      brand: 'Chevrolet',
      model: 'Equinox EV',
      image: 'electric_car',
      batteryCapacity: 85,
      range: 481,
      connectorType: 'CCS2',
      maxChargePower: { ac: 11.5, dc: 150 },
      year: 2025
    }
  ],
  pricing: {
    normal: { offPeak: 0.85, peak: 1.45, unit: 'R$/kWh', label: 'Carga Normal', estimatedTime: '4-6 horas', power: '7.4 kW' },
    fast: { offPeak: 1.20, peak: 1.95, unit: 'R$/kWh', label: 'Carga Rápida', estimatedTime: '1-2 horas', power: '22 kW' },
    peakHours: { start: 17, end: 21 }
  },
  sessionHistory: [
    { id: 'SES-001', stationId: 1, date: '2026-08-14', startTime: '08:30', endTime: '12:15', energyDelivered: 28.4, cost: 24.14, paymentMethod: 'PIX', vehicleName: 'Tesla Model 3', status: 'completed' },
    { id: 'SES-002', stationId: 3, date: '2026-08-14', startTime: '14:00', endTime: '15:30', energyDelivered: 33.0, cost: 39.60, paymentMethod: 'PIX', vehicleName: 'BYD Seal', status: 'completed' },
    { id: 'SES-003', stationId: 2, date: '2026-08-14', startTime: '18:00', endTime: '20:45', energyDelivered: 20.3, cost: 29.44, paymentMethod: 'PIX', vehicleName: 'Volvo EX30', status: 'completed' },
    { id: 'SES-004', stationId: 1, date: '2026-08-15', startTime: '07:00', endTime: '10:30', energyDelivered: 25.9, cost: 22.02, paymentMethod: 'PIX', vehicleName: 'GWM Ora 03', status: 'completed' },
    { id: 'SES-005', stationId: 2, date: '2026-08-15', startTime: '09:15', endTime: null, energyDelivered: 12.5, cost: 10.63, paymentMethod: 'PIX', vehicleName: 'BYD Dolphin', status: 'active' },
    { id: 'SES-006', stationId: 3, date: '2026-08-13', startTime: '10:00', endTime: '11:45', energyDelivered: 38.5, cost: 32.73, paymentMethod: 'PIX', vehicleName: 'Chevrolet Equinox EV', status: 'completed' },
    { id: 'SES-007', stationId: 1, date: '2026-08-13', startTime: '16:30', endTime: '19:00', energyDelivered: 18.6, cost: 26.97, paymentMethod: 'PIX', vehicleName: 'Renault Megane E-Tech', status: 'completed' },
    { id: 'SES-008', stationId: 4, date: '2026-08-12', startTime: '09:00', endTime: '13:00', energyDelivered: 29.6, cost: 25.16, paymentMethod: 'PIX', vehicleName: 'Hyundai Ioniq 5', status: 'completed' }
  ],
  dailyStats: [
    { date: '2026-08-10', sessions: 6, energy: 95.2, revenue: 112.40 },
    { date: '2026-08-11', sessions: 8, energy: 128.7, revenue: 155.30 },
    { date: '2026-08-12', sessions: 5, energy: 78.4, revenue: 89.60 },
    { date: '2026-08-13', sessions: 7, energy: 115.3, revenue: 138.20 },
    { date: '2026-08-14', sessions: 9, energy: 142.1, revenue: 172.50 },
    { date: '2026-08-15', sessions: 4, energy: 62.8, revenue: 73.90 }
  ]
};

if (typeof window !== 'undefined') window.MockData = MockData;
if (typeof module !== 'undefined' && module.exports) module.exports = MockData;
