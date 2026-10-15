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
- Totem compartilhado: após autorizar a recarga, retorna às estações; cartões
  ocupados mostram carro e porcentagem simulada. Toque para abrir os detalhes
  e volte à lista sem encerrar a sessão. Várias estações podem carregar juntas.
- Resumo ao final da sessão, com energia e valor calculados por faixa. Não é nota fiscal nem comprovação de pagamento.
- Interface mobile-first pensada para tablet em pé (iPad retrato), com tema claro/escuro.

### Painel administrativo

- Assistente de Operação: relatórios por período e análise factual dos registros, sem recomendações automáticas. Integração Ollama local no servidor, sem cobrança de API; se indisponível, análise por regras
  identificada. Configuração e fontes em [IA-ADMIN.md](IA-ADMIN.md).

- Visão geral com sessões e horários registrados, energia estimada, valor calculado e ocupação do cadastro; gráfico por dia real de registro.
- Monitoramento por estação: corrente comandada, potência, SoC, status (livre / carregando / limitado / suspenso / manutenção), com botão para tirar um ponto de operação.
- Histórico de sessões concluídas e faturamento consolidado — dados reais desta execução, não fixos.
- GoodWe / SEMS+: importação pontual de registros reais, com data da consulta e indicação de ausência de telemetria ao vivo.
- Tela de tarifação: composição do preço vigente (TE, TUSD, bandeira, tributos) segundo a **Tarifa Branca (ANEEL)**, linha do tempo dos postos horários, e terminal com o tráfego de protocolo (OCPP / Modbus) emitido pelo motor.

### Por baixo do capô

- Motor de simulação único rodando no servidor (Node.js): física de carregamento dos veículos, controle dinâmico de demanda (respeitando o limite contratado do site), geração solar, tarifação por horário — tudo compartilhado entre tótem e painel em tempo real via **WebSocket**, então uma sessão iniciada no tótem aparece instantaneamente no admin.
- Backend Pix isolado: o token do Mercado Pago nunca chega ao navegador.

### Redistribuição de potência

O controlador compartilha a potência disponível entre as recargas, considerando
o consumo do prédio, a geração solar, a margem de segurança e a demanda de cada
carro. A prioridade combina a energia que falta para chegar à meta e o tempo de
espera. Carros que aceitam menos potência deixam a sobra para os demais.
Entradas, encerramentos e conclusões recalculam a distribuição imediatamente,
sem acrescentar energia ou custo. Reduções de corrente não aguardam histerese;
aumentos durante os ticks têm estabilização para evitar alternâncias rápidas.
Quando não cabe a corrente mínima configurada, parte das recargas fica pausada.

A tela das estações mostra a potência distribuída por vaga. Para demonstrar,
inicie duas ou mais recargas e use **Modo demonstração → Pico moderado / Pico
severo**; depois clique em **Normalizar consumo** ou encerre uma recarga.
Os perfis OCPP e as escritas Modbus de corrente ainda são **simulados**. O relé
MQTT da estação 1 apenas liga/desliga; regular a corrente dos carregadores reais
exige integrar o controlador ao equipamento e a medições reais do estabelecimento.

## Passo a passo para rodar

### 1. Preparar a pasta e instalar dependências

Abra o PowerShell na pasta `chargegrid-hub`. É necessário Node.js com npm;
o ambiente de revisão usa Node.js 22. Não é necessário Python para executar o site.

```powershell
npm ci --prefix server
if (-not (Test-Path 'server/.env')) {
    Copy-Item 'server/.env.example' 'server/.env'
}
```

Edite `server/.env`: mantenha `PORT=3001`. Pix precisa de credenciais apropriadas
do Mercado Pago. `MP_SANDBOX=true` controla o comportamento do pedido e não
converte credenciais de produção em credenciais de teste. É possível testar o
fluxo de demonstração sem token. Nunca publique `.env`.

### 2. Iniciar o projeto

```powershell
npm start --prefix server
```

O próprio backend serve HTML, CSS, JavaScript, API e WebSocket na mesma porta:

- Totem: http://localhost:3001/
- Administrativo: http://localhost:3001/admin.html
- Saúde do backend: http://localhost:3001/healthz

### 3. IA local (opcional)

Em outro terminal na mesma pasta:

```powershell
powershell -NoProfile -File server/start-ollama.ps1
```

Se necessário, instale o Ollama e baixe `qwen2.5:3b` usando o comando que o
script imprime, em outro terminal. O script usa um diretório próprio de modelos;
inicie o serviço por ele antes do download. Veja [IA-ADMIN.md](IA-ADMIN.md).
`AI_PROVIDER=rules` mantém a análise factual sem IA, sem exigir uma chave paga.

### 4. Demonstração e testes

No totem, selecione estação e carro. Escolha cartão e **Prosseguir para a recarga
(demonstração)** para testar sem cobrança. A autorização aguarda LIGAR recebido
por MQTT; o tópico compartilhado pode acionar um ESP32 inscrito. Não confunda
sessões simuladas com controle físico de corrente.

```powershell
node --test server/test/*.test.js
```

Os testes do Pix usam um provedor controlado e não geram cobranças reais. A suíte
inclui o servidor completo com histórico separado, redistribuição, concorrência,
cancelamentos, entradas inválidas, datas, persistência e relatórios/PDF.
Veja [AUDITORIA.md](AUDITORIA.md) para resultados e limites da revisão.

## Equipe

| Nome | RM |
|------|----|
| Arthur Primo Brandão | 573572 |
| Felipe Gouveia Braga | 568956 |
| Isaías Hörlle Sobral | 568990 |
| Leandro Cavaccini Brito | 570556 |
| Lucas Dorice Dos Santos | 568692 |
| Vinicius de Oliveira Coppola | 571699 |

## Hospedagem

O site e o backend podem rodar juntos no Render. Veja [HOSPEDAGEM.md](HOSPEDAGEM.md) e `render.yaml`.
