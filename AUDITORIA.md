# Auditoria funcional e correções - ChargeGrid Hub

Revisão em 14/10/2026. Escopo: funcionalidades implementadas, fluxos normais,
cancelamentos, concorrência, entradas inválidas, indisponibilidade de serviços,
persistência, cálculo de energia/preço, relatórios e interface responsiva.

## Resultado automatizado

- Suíte anterior: 35 testes aprovados.
- Suíte ampliada: **71 testes aprovados, zero falhas, zero testes ignorados**.
- Um dos testes percorre **96 combinações**: oito veículos, quatro estações e
  três níveis de bateria de chegada.
- Sintaxe dos arquivos JavaScript conferida com `node --check`.
- Servidor completo iniciado em processo separado, com histórico temporário,
  credencial Pix inválida de propósito e IA desativada nos testes HTTP.
- Testes de pagamentos usam exclusivamente respostas controladas. Não foram
  criadas cobranças nem enviados comandos ao broker MQTT para acionar hardware.

Execução:

```powershell
Set-Location 'C:\Users\Pichau\Desktop\GOODWE-PROJETO\chargegrid-hub'
node --test --test-reporter=spec server/test/*.test.js
```

Saída da última execução: `output/auditoria/resultados-testes.txt`.
Esta contagem descreve testes automatizados, não uma prova de ausência de
qualquer erro possível. A matriz abaixo identifica o que foi efetivamente coberto.

## Problemas encontrados e solucionados

| Problema reproduzido ou identificado | Correção aplicada | Verificação |
| --- | --- | --- |
| Estação inválida caía silenciosamente na estação 1; bateria/meta/potência inválidas produziam estimativas sem sentido. | Validação de tipos e intervalos; rejeição de estação inexistente e meta abaixo da bateria inicial. | `robustness.test.js`, integração HTTP. |
| Capacidade zero e dados incompletos podiam contaminar uma sessão com NaN. | Validação no motor; o WebSocket resolve o veículo pelo catálogo do servidor. | Robustez e validação WebSocket. |
| Último tick podia ultrapassar a meta e cobrar energia além da necessária. | Energia, custo e tempo limitados à fração necessária do último intervalo. | Teste de término próximo da meta com intervalo longo. |
| Comandos inválidos do DEMO corrompiam a data ou velocidade do relógio compartilhado. | Validação no relógio e na entrada WebSocket; erros de comando controlados. | Robustez e WebSocket. |
| Pausar ou mudar velocidade não atualizava imediatamente o estado exibido. | Emissão de snapshot após comandos de demonstração. | Teste pausa/retomada pelo WebSocket. |
| Alterar dados do veículo pelo cliente permitia inserir capacidade e nome arbitrários. | Uso de dados canônicos do catálogo na autorização. | Teste com marca HTML e capacidade adulterada. |
| Indisponibilidade da estação era descoberta somente depois de aguardar LIGAR. | Rejeição antes da espera, mantendo a segunda verificação no momento de autorizar. | Teste de estação ocupada. |
| Pix usava uma nova chave em cada tentativa, permitindo cobranças repetidas em reenvios. | Identificador por pedido no cliente, deduplicação de chamadas concorrentes e mesma chave no retry ao provedor. | Testes de duplo clique, conflito de dados e falha de rede. |
| Valor Pix era aceito do navegador sem ligação com a estimativa da recarga. | Valor calculado pelo servidor quando há checkout; validação de valores e dados. | Teste de cliente enviando R$ 0,01 com estimativa superior. |
| Uma sessão podia ser marcada como Pix só pela indicação do cliente. | Backend verifica aprovação, valor, estação, veículo e bateria/meta; pagamento consumido uma única vez. | Provedor controlado, pagamentos pendentes, valor incorreto, reutilização e cancelamento durante verificação. |
| Cancelar a criação do Pix não invalidava uma resposta tardia. | Controle de geração da solicitação e descarte de callbacks antigos. | Teste assíncrono de cancelamento. |
| Consulta Pix parava definitivamente após a primeira falha de rede. | Repetição após falhas transitórias; encerramento explícito em erro permanente ou cancelamento. | Teste de falha seguida de aprovação e cancelamento em andamento. |
| Tela de pagamento podia perder o método selecionado enquanto a estimativa carregava. | Confirmação bloqueada até haver estimativa; seleção preservada e falha tratada. | Teste de seleção durante carregamento. |
| Escolher A/B/A podia deixar uma estimativa antiga sobrescrever a mais recente. | Identificador sequencial da requisição de estimativa. | Respostas devolvidas fora de ordem. |
| Tarifa e linha do tempo divergiam por relógio simulado ou fuso do servidor. | Cálculo tarifário em São Paulo e linha do tempo baseada no relógio real do mesmo fuso. | Limites de horário e fim de semana com processo em UTC; inspeção do painel. |
| Status Limitado podia ser aplicado à sessão por causa de outra estação. | Consulta da alocação da estação selecionada, em vez do estado agregado. | Inspeção da sessão sob pico e testes do controlador. |
| Cache do relatório escondia recargas recém-encerradas. | Reutilização só da organização da IA; indicadores e PDF recalculados a cada geração. | Teste de nova sessão dentro do cache e reprodução no navegador. |
| Registro antigo sem bateria/meta podia ser contado como meta atingida. | Separação dos registros sem dados válidos para comparação. | Teste de histórico legado incompleto. |
| Falha em um novo relatório mantinha o download de outro período disponível. | Limpeza do relatório selecionado e ocultação do download até nova geração bem-sucedida. | Teste de erro ao gerar novo período. |
| Histórico inválido podia falhar mais tarde durante o funcionamento; SEMS aceitava datas impossíveis. | Validação antes de carregar o histórico e de aceitar a importação; arquivo inválido preservado. | Testes de data impossível, ordem dos horários e arquivo preservado. |
| Tela desconectada anunciava tarifa zero ou disponibilidade antiga; envio podia falhar com exceção. | Estado explícito de indisponibilidade, controles bloqueados, envio protegido e liberação somente após snapshot novo. | Testes de reconexão e reprodução com servidor isolado desligado. |
| Cabeçalho administrativo escondia controles em telas estreitas. | Quebra de linha dos controles e ajuste do menu horizontal. | Medição e inspeção em 375x812; revisão em 768x1024. |
| Resumo de demonstração dizia Total pago e tela de cartão sugeria Modbus físico. | Rótulo Valor calculado da recarga e identificação explícita dos protocolos simulados. | Resumo conferido no navegador. |
| README mandava iniciar dois servidores e prometia nota fiscal e recomendações que não existem na versão atual. | Passo a passo da porta única 3001, capacidades reais e limitações atualizados. | Conferência com servidor, configuração e interface. |

## Matriz dos casos de uso

| Área | Casos cobertos | Método |
| --- | --- | --- |
| Inicialização | Health check; HTML do totem/admin; todos os assets locais; configuração local, IP e HTTPS/WSS. | Servidor real isolado, testes e navegador. |
| Arquivos privados | .env, fontes do backend, histórico, modelos e .git não publicados. | Requisições HTTP e resposta 404. |
| Seleção | Estação livre, ocupada, manutenção, veículo cadastrado e resposta de estimativa atrasada. | Navegador, motor e VM da interface. |
| Estimativa | Todos os carros/estações; baterias diferentes; meta atingida; valores inválidos; falha de rede. | 96 combinações, HTTP e testes assíncronos. |
| Pagamento | Pix pendente/aprovado/expirado; valor incorreto; checkout diferente; QR incompleto; sem token; recusa; retry; duplo clique; cancelamento e resposta tardia. | Provedor controlado e interface sem token. |
| Crédito/débito | Aviso de integração pendente; continuar sem cobrança. | Navegador. Não há maquininha implementada. |
| Autorização | Aguardar LIGAR, negar com DESLIGAR, expirar, cancelar, duplicar comando, desconectar e tentar por outro cliente. | Testes MQTT/WebSocket; espera e cancelamento no navegador sem publicação de LIGAR. |
| Sessões | Várias simultâneas; conclusão automática; voltar sem encerrar; encerrar a sessão escolhida; recarga antiga; segundo atendimento e reconexão. | Motor, WebSocket e navegador. |
| Distribuição | Capacidade normal; pico; redução de 1 A; corrente mínima; suspensão/retomada; potência liberada; limite do veículo; excedente solar. | Testes do controlador e picos no navegador. |
| Tarifação | Fora-ponta/intermediário/ponta e transições; sábado; execução em UTC; custo e segmentos sem energia excedente. | Testes e inspeção do terminal do painel. |
| Visão Geral | Base vazia e indicadores após encerramento; ocupação das estações. | Navegador e histórico controlado. |
| Estações | Disponível, carregando, limitado, suspenso, concluído e manutenção; reativação; manutenção com sessão ativa. | Motor, histórico e navegador. |
| Sessões/Faturamento | Registro único, datas reais, energia/valor estimados, ticket médio e separação das demonstrações. | Persistência, relatório e navegador. |
| SEMS+ | Importação existente, ausente, inválida, duplicada e com datas impossíveis; separação do totem. | Testes e tela do portal importado. |
| Relatórios | Hoje/semana/mês; calendário de São Paulo; duplicatas; datas futuras; ausência de dados; nova sessão no cache; histórico sem bateria/meta. | Testes e navegador. |
| IA | Resposta válida; dados omitidos/duplicados; mistura de grupos; provedor indisponível; modelo ausente; modelo remoto recusado; concorrência. | Respostas controladas; estado real registrado abaixo. |
| PDF | Exportação pelo ID; conteúdo PDF; nomes por período; ausência de outra chamada à IA; expiração e erro 404; download no navegador. | HTTP, testes e download real do arquivo. |
| Conexão | Backend desligado, reconexão com snapshot novo, falha durante envio e consulta Pix transitória. | Testes e desligamento do ambiente isolado. |
| Interface | Layout desktop, tablet e tela estreita; navegação entre as sete áreas; controles acessíveis e console sem erros não tratados nos fluxos inspecionados. | Navegador. Não equivale a uma auditoria completa de acessibilidade. |

## Evidências manuais e ambiente

O ambiente de revisão do navegador usou porta **3002**, histórico em
`tmp/audit-history.json`, token Pix propositalmente inválido e relatórios sem IA.
Foram criadas duas sessões somente pelo WebSocket local desse ambiente, com
autorização controlada, sem publicar LIGAR/DESLIGAR no broker MQTT externo.
Os testes não gravaram sessões no histórico principal da porta 3001.

Foi observado: 7,0/7,4 kW nas duas recargas, aproximadamente 3,2 kW por sessão
no pico moderado e 1,8 kW no severo, com status Limitado. Normalizar recuperou
a potência. Os dois botões de encerramento foram usados em sessões diferentes.
O relatório passou de uma para duas sessões dentro do minuto de cache.

O download manual gerou `chargegrid-relatorio-2026-10-14-2026-10-14.pdf` na
pasta Downloads do usuário. A versão de teste foi exportada com organização
padrão, claramente identificada como sem IA. Foram salvas capturas em
`output/auditoria/`. O console das duas telas não apresentou erros de execução
nos fluxos inspecionados. A viewport temporária foi restaurada.

O ambiente isolado foi desligado após verificar a tela sem conexão. O servidor
principal foi iniciado na porta 3001 com o histórico existente preservado.
Sem Ollama, o relatório principal foi gerado corretamente com fallback explícito.
Depois, o Ollama foi iniciado pelo script do projeto e uma geração real com
`qwen2.5:3b` concluiu no painel principal, identificada como dados organizados
com IA local. O modelo e o backend foram mantidos ligados. A captura está em
`output/auditoria/relatorio-com-ia-validado.png`.

## Limites que permanecem

- Maquininha de cartão, ajuste físico de corrente e telemetria automática GoodWe
  não estão implementados; não foram tratados como funcionalidades validadas.
- Pix foi testado com provedor controlado. Credenciais, recebimento, taxas,
  estorno, conciliação e comportamento de uma conta real exigem validação própria.
- A memória de checkout/idempotência e de relatórios pertence à execução do
  servidor. Reiniciar perde o vínculo das cobranças e as sessões ativas; a
  recuperação financeira permanente e a retomada de sessões exigem persistência
  adicional. Pagamento antigo não é aceito silenciosamente como comprovado.
- Uma chave de pedido evita repetição do mesmo pedido. Um atendimento novo ou
  recarregar o navegador não é uma recuperação automática de um Pix anterior.
- O Pix representa uma estimativa antecipada; cobrança complementar ou devolução
  da diferença para o custo final ainda não foi implementada.
- Não há reserva financeira da vaga durante todo o pagamento. Se outra sessão
  ocupar a estação antes da autorização, o início é recusado; remanejamento ou
  estorno de um pagamento já aprovado precisa de tratamento pelo operador.
- O broker é público e os comandos administrativos/WebSocket não possuem uma
  camada completa de autenticação e autorização de produção. A verificação Pix
  implementada não substitui essa camada nem confirma carga física.
- Não houve acionamento de relé, pagamento real, acesso por tablet físico,
  publicação de site ou alteração de firewall. Dimensões de tablet foram
  reproduzidas no navegador.
- O histórico inválido impede a inicialização com erro explícito para evitar
  sobrescrevê-lo. A correção de um arquivo corrompido é uma operação de recuperação
  de dados, não um apagamento automático.

As pendências acima são limites de integração e de produção, não resultados
aprovados de teste. A suíte e esta matriz permitem repetir a revisão após as
próximas implementações.
