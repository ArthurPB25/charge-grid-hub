# ChargeGrid Hub

Protótipo de gestão de eletropostos comerciais desenvolvido para o **Challenge GoodWe + FIAP 2026**. Integra totem de atendimento, sessões simultâneas, distribuição de potência, pagamentos e painel administrativo.

O **GoodWe HCA G2 é o equipamento-alvo**. Recarga, estado da bateria, geração solar e comandos Modbus/OCPP são simulados. A ponte ESP32/MQTT da estação 1 faz liga/desliga; a integração direta de corrente com o carregador ainda não foi validada em campo.

## Documentação da Sprint 4

O [relatório final integrado](docs/sprint4/RELATORIO-FINAL.md) contém arquitetura, diagrama funcional, resultados quantitativos, capturas do sistema, análise de sustentabilidade, referências e limites da implementação.

## Funcionalidades

- **Totem:** seleção de estação e veículo, estimativa de recarga, pagamento, acompanhamento de potência, SoC, tempo e custo estimados.
- **Controle multiestação:** quatro sessões concorrentes, repartição de potência, suspensão por falta de capacidade e redistribuição ao liberar uma vaga.
- **Painel:** estado das estações, histórico, gráficos e relatórios PDF; importação histórica SEMS identificada, sem atualização automática.
- **Pagamentos:** Pix via Mercado Pago e aplicativo Android com InfiniteTap. O retorno local do Tap é uma heurística de demonstração, sem conciliação bancária independente. No fluxo Tap, pagar e conectar são etapas distintas.
- **Assistente administrativo:** fatos e dicas calculados por regras, com priorização opcional por Ollama. A IA não controla energia, preços ou pagamentos.

## Arquitetura e código

| Parte | Implementação |
|---|---|
| Interfaces | HTML, CSS e JavaScript em `index.html`, `admin.html`, `js/` e `css/` |
| Backend e sincronização | Node.js, Express e WebSocket em `server/` |
| Simulação e controle | `server/sim/`; parâmetros do cenário em `data/site-config.js` |
| Firmware IoT | ESP32, Wi-Fi, MQTT, sensor de cabo e relé em `esp32/` |
| Terminal Android | Java em `mobile/tap-poc/` |
| Verificação | Testes em `server/test/` e evidências em `output/` |

Um único motor no servidor mantém totem e painel sincronizados. O controlador considera consumo predial, geração solar, margem de segurança e limites de cada veículo e estação. O histórico concluído é salvo em JSON; sessões e pedidos em andamento são voláteis.

## Executar localmente

Pré-requisito: **Node.js 22 com npm**. Execute na raiz do repositório:

```powershell
npm ci --prefix server
if (-not (Test-Path server/.env)) {
    Copy-Item server/.env.example server/.env
}
npm start --prefix server
```

Crie `server/.env` apenas se ainda não existir e ajuste as opções a partir do exemplo. O padrão de referência é a porta 3001; use a porta configurada no ambiente:

- Totem: http://localhost:3001/
- Painel: http://localhost:3001/admin.html
- Saúde: http://localhost:3001/healthz

`AI_PROVIDER=rules` permite relatórios sem consultar modelos. Ollama local e Cloud são opcionais, conforme `server/.env.example`. As credenciais ficam no backend e não devem ser versionadas.

Pix exige credenciais apropriadas: `MP_SANDBOX=true` não transforma uma credencial de produção em credencial de teste. InfiniteTap requer aplicativo Android e configuração do terminal; a demonstração pode envolver cobrança real de R$1. A energia estimada da sessão é contabilizada separadamente. Não é necessário realizar cobranças para executar os testes automatizados.

## Verificar e demonstrar

```powershell
node --test server/test/*.test.js
```

Resultado da revisão de 23/10/2026: **130 testes aprovados, nenhuma falha**, usando provedores controlados. Veja o [registro da execução](output/auditoria/testes-sprint4-2026-10-23.txt).

Para demonstrar o controlador, prepare duas ou mais sessões, abra o painel e use **Modo demonstração → Pico moderado / Pico severo**, seguido de **Normalizar consumo**. Observe a repartição e as suspensões. No fluxo legado, a autorização depende de MQTT; o tópico compartilhado pode acionar um ESP32 inscrito. O teste interativo deve usar a bancada prevista pelo grupo.

A referência comercial de preço-base é R$2,00/kWh. Os fatores de horário e ocupação são regras do projeto; não representam a tarifa de uma distribuidora. O preço aceito no pedido é preservado na sessão. Solar e restrição de rede afetam potência, sem mudar o preço.

## Limites e próximos passos

A aplicação é um protótipo acadêmico. Não há bateria estacionária integrada nem medição elétrica ao vivo. Os resultados não comprovam economia financeira ou redução de carbono em campo. Para uso comercial, faltam validação com HCA G2, autenticação completa, MQTT privado, persistência durável e conciliação dos pagamentos. O firmware de relé não substitui um carregador homologado.

Site, API e WebSocket podem ser hospedados juntos conforme `render.yaml`. Armazenamento local em hospedagem sem disco persistente pode ser perdido em reinícios e deploys.

## Equipe

| Nome | RM |
|---|---|
| Arthur Primo Brandão | 573572 |
| Felipe Gouveia Braga | 568956 |
| Isaías Hörlle Sobral | 568990 |
| Leandro Cavaccini Brito | 570556 |
| Lucas Dorice Dos Santos | 568692 |
| Vinicius de Oliveira Coppola | 571699 |
