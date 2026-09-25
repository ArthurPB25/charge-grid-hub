# ChargeGrid Hub

Tótem de recarga para eletropostos comerciais, feito sobre o carregador residencial **GoodWe HCA G2**. Adiciona ao carregador tudo que ele não tem de fábrica: cobrança, tarifação dinâmica, controle de demanda e um painel de operação — sem alterar o hardware do carregador.

Projeto do desafio **1CC EV Challenge — GoodWe + FIAP 2026**.

A recarga do totem agora aguarda o comando **LIGAR recebido por MQTT** no navegador,
após o pagamento ou a escolha do modo de demonstração. Veja o fluxo, as mensagens
e a configuração do ESP32 em [MQTT-AUTORIZACAO.md](MQTT-AUTORIZACAO.md).

O admin registra as operações do totem e possui uma aba **GoodWe / SEMS+** para
dados importados do portal. A importação atual não se atualiza automaticamente;
energia e custo do simulador são identificados como estimativas. Consulte
[DADOS-ADMIN.md](DADOS-ADMIN.md) para fontes, persistência e integração pendente.

## Funcionalidades

### Tótem (experiência do motorista)

- Seleção de estação disponível, com preço da tarifa em tempo real.
- Seleção de veículo e simulação de carregamento (SoC de chegada, tempo/energia estimados).
- Pagamento via **Pix real**, integrado à API do Mercado Pago (QR Code dinâmico, aprovação automática em modo sandbox).
- Tela de carregamento ao vivo: potência entregue, SoC, custo parcial, tempo restante.
- Nota fiscal ao final da sessão, com detalhamento do preço cobrado.
- Interface mobile-first pensada para tablet em pé (iPad retrato), com tema claro/escuro.

### Painel administrativo

- Visão geral com KPIs reais do dia (sessões, energia fornecida, faturamento, ocupação) e gráfico de desempenho por dia simulado.
- Monitoramento por estação: corrente comandada, potência, SoC, status (livre / carregando / limitado / suspenso / manutenção), com botão para tirar um ponto de operação.
- Histórico de sessões concluídas e faturamento consolidado — dados reais desta execução, não fixos.
- Tela de energia: demanda medida vs. contratada, geração solar, folga disponível para recarga, curva do dia.
- Tela de tarifação: composição do preço vigente (TE, TUSD, bandeira, tributos) segundo a **Tarifa Branca (ANEEL)**, linha do tempo dos postos horários, e terminal com o tráfego de protocolo (OCPP / Modbus) emitido pelo motor.

### Por baixo do capô

- Motor de simulação único rodando no servidor (Node.js): física de carregamento dos veículos, controle dinâmico de demanda (respeitando o limite contratado do site), geração solar, tarifação por horário — tudo compartilhado entre tótem e painel em tempo real via **WebSocket**, então uma sessão iniciada no tótem aparece instantaneamente no admin.
- Backend Pix isolado: o token do Mercado Pago nunca chega ao navegador.

## Passo a passo para rodar

### 1. Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- Python 3 (só para servir os arquivos estáticos — qualquer outro servidor estático funciona no lugar)
- Uma conta de teste no [Mercado Pago Developers](https://www.mercadopago.com.br/developers) (gratuita, para gerar cobranças Pix em modo sandbox)

### 2. Instalar as dependências do backend

```bash
cd server
npm install
```

### 3. Configurar o token do Mercado Pago

```bash
cp server/.env.example server/.env
```

Edite `server/.env` e preencha `MP_ACCESS_TOKEN` com seu **Access Token de teste** (painel do Mercado Pago → Suas integrações → Credenciais de teste). Mantenha `MP_SANDBOX=true` — isso faz o Mercado Pago aprovar o Pix automaticamente em modo teste.

### 4. Subir o backend (Pix + motor de simulação + WebSocket)

Em um terminal:

```bash
cd server
node server.js
```

Deixe esse terminal aberto. Ele sobe em `http://localhost:3001` e só responde às rotas `/api/...` e ao WebSocket `/ws` — a página em si não é servida por ele.

### 5. Subir o front-end (HTML/CSS/JS)

Em **outro** terminal, na raiz do projeto:

```bash
python -m http.server 8322
```

### 6. Abrir no navegador

- **Tótem:** [http://localhost:8322](http://localhost:8322)
- **Painel administrativo:** [http://localhost:8322/admin.html](http://localhost:8322/admin.html)

Os dois se conectam ao mesmo motor de simulação no backend — abra as duas telas lado a lado para ver uma sessão iniciada no tótem refletir ao vivo no admin.

## Equipe

| Nome | RM |
|------|----|
| Arthur Primo Brandão | 573572 |
| Felipe Gouveia Braga | 568956 |
| Isaías Hörlle Sobral | 568990 |
| Leandro Cavaccini Brito | 570556 |
| Lucas Dorice Dos Santos | 568692 |
| Vinicius de Oliveira Coppola | 571699 |
