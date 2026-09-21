# Guia de demonstração — ChargeGrid Hub

Referência técnica para conduzir a gravação. Os números aqui são os que o
sistema realmente produz.

## Como rodar

```bash
python .claude/serve.py 8322
```

Abra `http://localhost:8322/index.html` (tótem) e `http://localhost:8322/admin.html`
(painel). Precisa ser por HTTP: abrir o arquivo direto com duplo clique também
funciona, mas o servidor evita que o navegador sirva JavaScript em cache.

## Painel de demonstração

Abre com **Ctrl+D** ou pela aba discreta na borda direita. Fica escondido por
padrão para não aparecer no vídeo.

| Controle | Para que serve |
|---|---|
| `12h` | Meio-dia: excedente solar de ~19 kW, preço no mínimo |
| `15h` | Tarde: ponto de partida padrão |
| `17h` | Início do posto intermediário |
| `18h` | Início da ponta — a virada de tarifa |
| `21h` | Fim da ponta |
| `−30min` … `+30min` | Ajuste fino para acertar o enquadramento |
| `Pausar` | Congela a simulação para narrar uma tela parada |
| `1x / 60x / 240x` | 60x é o padrão: 1 minuto real = 1 hora simulada |
| `Pico moderado` | Estrangula todas as recargas, sem suspender nenhuma |
| `Pico severo` | Leva o carregador a ~16 A e suspende uma sessão |
| `Normalizar consumo` | Remove o pico e as recargas se recuperam |
| `Dia útil / Sábado` | No fim de semana não existe posto de ponta |

O pico é dimensionado a partir da demanda atual dos veículos, não é um degrau
fixo: funciona em qualquer horário, inclusive ao meio-dia, quando o sol cobriria
um degrau fixo.

## Os três momentos que valem a pena filmar

### 1. Controle Dinâmico de Demanda (o pilar do produto)

Na tela de monitoramento, acione **Pico moderado**. Em poucos segundos:

- o banner desliza com **32 A → 18 A** (o valor exato varia com o horário)
- o status muda para *Limitado*
- a potência no anel cai
- a barra de demanda encosta no traço da demanda contratada
- na aba **Modbus RS-485**, o registrador `0x0010` (Corrente máxima de saída)
  muda de valor
- na aba **Quadros RTU** aparece o quadro `FC06` correspondente, com CRC16 real
- na aba **OCPP 1.6J** aparece o `SetChargingProfile` com `chargingRateUnit: "A"`

Falas com respaldo no código:

> A concessionária não fatura potência instantânea: ela mede a demanda como a
> média de cada janela de 15 minutos. O controlador projeta em quanto a janela
> corrente vai fechar e corta a corrente antes de estourar o contrato, em vez de
> reagir depois.

> Abaixo de 6 A o veículo não aceita carga — é a norma IEC 61851. Por isso o
> sistema não reduz indefinidamente: quando não há mais folga, ele suspende a
> sessão de menor prioridade e realoca o que sobrou.

Com **Pico severo** a suspensão acontece e o carregador do tótem vai a ~16 A —
o mesmo exemplo "de 32A para 16A" que está na documentação da Sprint 1.

### 2. Smart Pricing com as três variáveis

No painel, aba **Tarifação**, a composição do preço aparece linha a linha: TE,
TUSD, bandeira amarela, tributos, custo da energia, margem do operador, e então
os três multiplicadores — ocupação, posto tarifário e excedente solar.

Amplitude real do modelo:

| Cenário | Preço |
|---|---|
| 12h, um carro, excedente solar | **R$ 0,96/kWh** |
| 15h, movimento normal | ~R$ 1,53/kWh |
| 19h, ponta, eletroposto cheio | **R$ 3,08/kWh** |

Pule para **12h** e depois para **18h** para mostrar a variação ao vivo. Em
**Sábado** às 19h o preço cai: fim de semana é integralmente fora-ponta.

### 3. Recibo faturado por faixa

Deixe uma recarga atravessar as 18h e encerre. O resumo lista cada posto
separadamente — por exemplo *Fora-ponta 1,98 kWh a R$ 1,69* e *Ponta 1,50 kWh a
R$ 3,03* — porque o custo é acumulado com o preço vigente a cada instante, e não
com um preço fixado no início da sessão.

O recibo também separa **energia medida** de **energia na bateria**: a diferença
são as perdas de conversão (7% em corrente alternada, 5% em contínua). O cliente
paga o que passa pelo medidor.

## O que está declarado como não implementado

A tela de pagamento não simula Pix nem maquininha. Ao escolher o meio, o tótem
informa que a integração com a API bancária é da próxima etapa e oferece seguir
para a recarga em modo demonstração. Isso é deliberado: encenar uma integração
bancária inexistente não sobrevive à primeira pergunta da banca.

Também não fazem parte desta entrega o chatbot (PAI), o circuito de prioridade
em Arduino (COA) e a análise estatística em Pandas (MLPAM) — são entregáveis
separados de outras disciplinas.

## Detalhes que resistem a perguntas

- Nenhum veículo carrega acima do seu próprio limite: o BYD Dolphin Mini fica em
  6,6 kW mesmo num carregador de 7,4 kW.
- A curva de carga é CC/CV: a potência começa a cair a partir de 55% do estado de
  carga, e a queda é bem mais acentuada em corrente contínua.
- O estado de carga na chegada é sorteado a cada sessão em torno de um terço da
  bateria, e o mesmo valor é usado na estimativa e na recarga.
- O CRC16 dos quadros Modbus é calculado de verdade (polinômio 0xA001) e confere
  com os vetores da especificação.
- Os carimbos de tempo do OCPP estão em UTC, como o padrão exige — por isso
  aparecem três horas à frente do relógio local na tela.
