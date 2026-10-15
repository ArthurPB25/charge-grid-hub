# ChargeGrid Hub
## 1. Visão geral e situação do projeto

Relatório de funcionalidades e execução - revisão do código em 14/10/2026.

O ChargeGrid Hub é um protótipo de totem compartilhado e painel administrativo para recarga de veículos elétricos, no contexto do desafio GoodWe + FIAP. O projeto usa o GoodWe HCA G2 como referência de carregador e combina atendimento ao motorista, tarifação, simulação de recarga, distribuição de potência e análise da operação.

### O que está disponível

| Recurso | Situação atual |
| --- | --- |
| Totem e painel administrativo | Implementados e conectados ao mesmo backend. |
| Várias recargas simultâneas | Implementadas no simulador, em quatro estações cadastradas. |
| Redistribuição de potência | Implementada no simulador; ajuste de corrente no equipamento real pendente. |
| Pix | Integração com Mercado Pago; cobrança e recebimento reais exigem validação operacional. |
| Cartão e maquininha | Opções visíveis; processamento de crédito/débito não implementado. |
| GoodWe / SEMS+ | Importação pontual de registros reais; atualização automática pendente. |
| IA e relatório em PDF | Análise factual do sistema; Ollama organiza os indicadores, sem recomendações. |
| ESP32 / MQTT | Ponte de autorização e acionamento liga/desliga do protótipo. Não regula corrente. |
| Histórico | Sessões concluídas salvas em arquivo; sessões ativas permanecem na memória. |

### Como as partes se conectam

Totem e administrativo acessam o servidor Node.js/Express na porta 3001. O servidor entrega o HTML, CSS e JavaScript, atende as APIs e transmite o estado compartilhado pelo WebSocket /ws. O motor de simulação roda somente no backend.

O servidor acessa o Mercado Pago para Pix e o Ollama local para organizar os indicadores dos relatórios. O navegador faz a ponte com o broker MQTT usado pelo ESP32. Esses serviços têm papéis separados: receber LIGAR não comprova pagamento nem confirma fornecimento físico de energia.

Este documento descreve a implementação encontrada. Não representa nova homologação de pagamentos ou equipamentos físicos. Dados simulados são identificados nas telas e devem ser apresentados dessa forma na competição.

## 2. Totem: experiência do motorista

### Início e escolha da estação

A tela inicial mostra o número de estações disponíveis, o horário do dispositivo e o preço vigente por kWh. O botão Iniciar Carregamento abre a lista de quatro estações. Cada uma representa um ponto AC Tipo 2, de aproximadamente 7,4 kW; não existe uma opção DC rápida nesse cadastro.

O motorista escolhe uma estação livre. Estações ocupadas mostram veículo, porcentagem de bateria e potência simulados; tocar nelas abre o acompanhamento. Pontos em manutenção deixam de ficar disponíveis para novos atendimentos. A área Distribuição de energia mostra a potência alocada por estação e o orçamento disponível.

### Veículo e estimativa

Há oito modelos cadastrados: BYD Dolphin Mini, Dolphin, Dolphin Plus e Seal; GWM Ora 03; Volvo EX30; Tesla Model 3; Chevrolet Equinox EV. Os cartões usam ícones de carro. Não há modelos 3D, pesquisa por qualquer veículo ou consulta automática a uma API de catálogo.

Após a escolha, aparecem capacidade de bateria, energia necessária, tempo, autonomia recuperada, custo estimado e tarifa atual. O cálculo considera características cadastradas do veículo e o limite da estação. As especificações são dados locais de demonstração, não uma consulta ao fabricante durante o atendimento.

Na interface atual, a bateria de chegada é sorteada por veículo, entre 8% e 62%, e a meta é definida em 80%. Esses valores não são lidos do carro; a tela não oferece controles para digitá-los. Reescolher o mesmo modelo conserva o valor sorteado dentro daquele atendimento.

### Pagamento, autorização e recarga

Pix solicita uma cobrança ao backend, que usa a API de Orders do Mercado Pago. O totem exibe o QR Code e consulta o status. O token fica no servidor. Crédito e débito mostram que a integração está em desenvolvimento e oferecem Prosseguir para a recarga (demonstração), sem cobrança.

Depois do Pix aprovado ou da escolha da demonstração, a tela aguarda autorização MQTT. A sessão começa quando o navegador recebe LIGAR e o servidor aceita a solicitação pendente. A espera pode ser cancelada ou repetida e expira em 120 segundos. Repetir autorização não cria outra cobrança; cancelar a espera não estorna um Pix aprovado.

Após autorizar, o totem volta à lista para atender outro motorista. Nos detalhes, mostra bateria, potência, corrente, energia, custo, tempo decorrido e estimativa restante. Voltar às estações mantém a recarga. Encerrar Carregamento finaliza apenas a sessão selecionada. Ao atingir a meta, a sessão fica concluída até consultar o resumo e liberar a estação.

O resumo separa energia estimada no medidor e na bateria, duração e custo por faixa tarifária. Não é nota fiscal. No modo demonstração não há pagamento, ainda que o resumo use o rótulo Total pago. Há alternância entre tema claro e escuro e adaptação para telas menores.

## 3. Redistribuição de energia e formação do preço

### Orçamento de potência

O controlador considera a demanda contratada configurada, uma margem de segurança, o consumo simulado do prédio e a geração solar simulada. A configuração atual usa contrato de 75 kW e margem de 5%, resultando em limite de importação de 71,25 kW. A geração instalada de referência é 90 kWp; esses parâmetros são do cenário de demonstração.

Em termos simplificados: potência disponível para carros = limite da rede - consumo do prédio + geração solar. O controlador respeita os limites de cada carregador e do veículo. Se um carro aceita menos potência, a sobra pode atender outros. A prioridade considera a energia que falta para chegar à meta e o tempo de espera.

Quando uma sessão começa, termina ou atinge a meta, a distribuição é recalculada imediatamente, sem criar energia ou cobrança extras. Reduções são aplicadas de imediato; aumentos periódicos têm estabilização para evitar alternâncias rápidas. Se não houver capacidade para a corrente mínima configurada de 6 A, algumas sessões podem ficar pausadas e retomar quando houver folga.

Exemplo didático: duas sessões com necessidade de 7 kW cada podem receber aproximadamente 3 kW cada se restarem apenas 6 kW. A divisão não precisa ser exatamente igual: prioridade, limites dos carros e arredondamento da corrente influenciam o resultado. Encerrar uma sessão libera capacidade para as demais, até seus limites.

### Tarifa dinâmica

O preço considera TE, TUSD, bandeira e tributos configurados, margem do operador, ocupação, faixa horária, participação solar e condição de restrição de potência. Há piso de R$ 0,55/kWh e teto de R$ 3,20/kWh no modelo. Esses valores não são atualizados automaticamente por uma concessionária.

A configuração distingue ponta das 18h às 21h e intermediário das 17h às 18h e das 21h às 22h, em dias úteis. Os demais horários e fins de semana usam fora-ponta. O código não consulta um calendário de feriados. Esses horários e parâmetros representam o modelo configurado, não uma validação de contrato tarifário específico.

O custo é acumulado com o preço vigente durante a sessão, e o resumo discrimina os segmentos. A estimativa inicial pode diferir do custo final. O posto tarifário usa o relógio real de execução; o relógio acelerado governa a física da recarga e as curvas do cenário. Mudar o horário do modo DEMO não deve ser apresentado como alteração do relógio real da cobrança.

### Limite da integração física

Perfis OCPP e escritas Modbus do controlador ainda são simulados. O relé do protótipo da estação 1 apenas liga ou desliga. Aplicar essa redistribuição a carregadores reais depende de medições reais e da integração de controle de corrente com o equipamento.

## 4. Painel administrativo

### Visão Geral

Exibe sessões encerradas no dia, energia estimada, valor calculado, ocupação das estações cadastradas, últimas sessões e gráfico por dia. Datas e registros vêm das operações salvas; energia e custo continuam estimados. Ocupação do cadastro não é descoberta automática de quatro carregadores físicos.

### Estações

Mostra disponibilidade, veículo, bateria, potência, corrente e estado de cada ponto. O operador pode colocar uma estação em manutenção ou reativá-la. Colocar um ponto ocupado em manutenção encerra sua sessão; portanto, esse botão interfere no atendimento. A corrente exibida representa o cenário do simulador, salvo informações específicas identificadas como hardware.

### Sessões

Apresenta o histórico das recargas concluídas, com identificador, estação, veículo, data, início/fim, energia, valor e indicação de pagamento. Demonstrações aparecem como sem cobrança. O acompanhamento das sessões em andamento fica nas estações. Os identificadores permitem encerrar a sessão escolhida sem atingir outra recarga.

### Faturamento

Consolida valores calculados por dia, energia, número de sessões concluídas, ticket médio, valor médio por kWh e quantidade de sessões com Pix informado. Não há conciliação bancária, apuração de lucro ou confirmação de receita recebida nessa tela. Pix informado pelo totem e recebimento conciliado são conceitos diferentes.

### GoodWe / SEMS+

Mostra uma importação do portal SEMS+, com origem, instante da consulta, estado observado e registros de recarga. A base revisada contém 20 registros, com 135,09 kWh, consultados em 25/09/2026. O estado observado naquela consulta não é o estado atual do equipamento. A importação não é somada à energia simulada do totem e não se atualiza sozinha.

### Tarifação

Abre a composição do preço e a linha do tempo das faixas tarifárias. O terminal mostra mensagens produzidas pelo motor, como Authorize, StartTransaction, MeterValues, StopTransaction, SetChargingProfile e escritas Modbus. Esse terminal ajuda a demonstrar a lógica, mas não comprova comunicação OCPP/Modbus com um carregador físico.

### Assistente de Operação

Permite escolher Hoje, Últimos 7 dias ou Últimos 30 dias, gerar a análise e baixar o PDF. A versão atual descreve uso, médias, conclusão da meta, pausas e situação atual. Foram retiradas recomendações automáticas e diagnósticos sem evidência. O funcionamento da IA e a persistência são detalhados a seguir.

## 5. IA, dados armazenados e MQTT

### Papel da IA

O servidor filtra sessões concluídas pelo calendário de São Paulo, exclui duplicatas e calcula indicadores. A análise textual é factual e determinada pelo sistema. O Ollama, com qwen2.5:3b, recebe os indicadores agregados e organiza seus identificadores em três grupos: operações do período, situação atual e importação GoodWe.

A IA não busca dados no carregador, não calcula faturamento e não escreve diagnósticos ou recomendações. A resposta é validada para impedir indicadores desconhecidos, omissões, duplicatas e mistura dos grupos. Sem uma resposta válida, a mesma análise usa organização padrão, identificada como sem IA. Não há fallback para API paga.

O PDF é montado pelo backend com PDFKit e conserva valores e fontes. O botão baixa o relatório já gerado, sem uma segunda chamada ao modelo. O servidor mantém até 50 relatórios por até 30 minutos. Reiniciar o backend invalida esses downloads; é necessário gerar novamente. Arquivos já baixados continuam disponíveis no dispositivo.

### Persistência e origem dos dados

As sessões concluídas são gravadas em server/storage/totem-sessions.json. A importação SEMS+ fica em server/storage/sems-import.json. Preserve esses arquivos ao copiar o projeto e faça uma cópia antes de alterar dados. O diretório de modelos Ollama também pode ser grande e não acompanha necessariamente uma cópia do repositório.

Sessões ativas ficam na memória do servidor: sobrevivem à navegação ou recarga da página, mas não à reinicialização do backend. Não há uma base histórica de fila, procura não atendida, motivos de encerramento ou custos operacionais que sustente decisões de expansão ou lucro.

### MQTT e ESP32

O navegador conecta a wss://broker.emqx.io:8084/mqtt. O tópico meu_projeto/tomada/comando recebe LIGAR e DESLIGAR, em texto puro e sem retain. O backend aceita apenas uma solicitação de autorização pendente por vez. A conexão que solicitou a sessão deve encaminhar a autorização.

O tópico meu_projeto/tomada/rele transporta comandos automáticos de pausa/retomada e encerramento; meu_projeto/tomada/status transporta informações do ESP32. O firmware esp32/chargegrid-rele.ino combina autorização com um sensor de cabo e publica o estado do protótipo.

A ponte física legada corresponde à estação 1. As demais representam sessões independentes do simulador. O tópico de autorização é compartilhado e também pode alcançar o ESP32 inscrito nele. O broker público e o WebSocket não oferecem autenticação de produção. A ponte física depende do navegador conectado; essas limitações precisam ser resolvidas antes de uso comercial.

## 6. Passo a passo: iniciar o servidor

### 1. Abrir a pasta correta

Abra o PowerShell. Os comandos abaixo usam a localização deste computador. Em outro computador, ajuste somente o caminho da pasta.

```powershell
Set-Location 'C:\Users\Pichau\Desktop\GOODWE-PROJETO\chargegrid-hub'
node --version
npm --version
```

Na revisão, o ambiente retornou Node.js v22.16.0 e npm 10.9.2. Use um ambiente Node compatível com os módulos ES e fetch utilizados pelo backend. Se os comandos não forem reconhecidos, instale Node.js com npm pelo site oficial https://nodejs.org/ e reabra o terminal.

### 2. Instalar as dependências

Execute na pasta chargegrid-hub:

```powershell
npm ci --prefix server
```

O comando usa server/package-lock.json. Se não houver lockfile na cópia recebida, use npm install --prefix server. Esta etapa precisa de internet. Não é necessário instalar dependências para o front-end separadamente.

### 3. Criar a configuração sem apagar a existente

```powershell
if (-not (Test-Path 'server/.env')) {
    Copy-Item 'server/.env.example' 'server/.env'
}
notepad server/.env
```

Mantenha PORT=3001. Para a IA, use AI_PROVIDER=ollama, OLLAMA_BASE_URL=http://127.0.0.1:11434 e OLLAMA_MODEL=qwen2.5:3b. Se quiser rodar sem IA, use AI_PROVIDER=rules; o relatório factual continua funcionando.

MP_ACCESS_TOKEN só precisa de uma credencial válida se você for testar Pix. Use credenciais do ambiente de teste apropriado e MP_SANDBOX=true para o fluxo de teste configurado. Esse parâmetro modifica o comportamento da requisição; sozinho não transforma uma credencial de produção em credencial de teste. Não publique o arquivo .env. Para testar sem cobrança, use a opção de demonstração do cartão.

### 4. Iniciar e abrir

```powershell
npm start --prefix server
```

Deixe esse terminal aberto. A mensagem esperada informa que o servidor está em http://localhost:3001. Abra o totem em http://localhost:3001/ e o administrativo em http://localhost:3001/admin.html.

O mesmo servidor entrega as telas, APIs e WebSocket. Não precisa de Python, servidor estático na porta 8322 ou etapa de build do front-end. Em um segundo PowerShell, Invoke-RestMethod http://localhost:3001/healthz deve retornar ok = True. Isso verifica o backend, não o Pix ou o equipamento físico.

## 7. Passo a passo: IA local e acesso pelo tablet

### 5. Iniciar o Ollama em outro terminal

Na pasta chargegrid-hub, use o inicializador do projeto:

```powershell
powershell -NoProfile -File server/start-ollama.ps1
```

Ele procura primeiro server/storage/ollama/runtime/ollama.exe e depois uma instalação normal do Ollama. Define o serviço em 127.0.0.1:11434, desativa a nuvem e usa server/storage/ollama/models para os modelos. Deixe esse terminal aberto junto com o servidor.

Se o executável não estiver disponível, instale o Ollama pelo site oficial https://ollama.com/download/windows. Execute novamente o script do projeto. Se já houver outro Ollama ocupando 11434, encerre a instância duplicada antes de usar esse inicializador.

### 6. Baixar o modelo, se necessário

O script imprime o caminho do executável e o comando para baixar o modelo. Com a versão portátil, abra um terceiro terminal na pasta chargegrid-hub e execute:

```powershell
& '.\server\storage\ollama\runtime\ollama.exe' pull qwen2.5:3b
```

Se o script encontrou uma instalação normal, use o caminho que ele imprimiu no lugar do caminho portátil. Inicie o serviço pelo script antes do pull para que o download seja armazenado no diretório correto. O download inicial precisa de internet e ocupa aproximadamente 1,9 GB; não precisa ser repetido se o modelo já estiver disponível.

### 7. Conferir e gerar

```powershell
Invoke-RestMethod http://localhost:3001/api/reports/status
```

Com tudo pronto, ready deve ser True e o modelo informado deve ser qwen2.5:3b. No administrativo, abra Assistente de Operação, escolha o período, clique em Gerar relatório e depois em Baixar PDF. A organização por IA pode levar até cerca de um minuto. Se Ollama falhar, o relatório continua com organização padrão.

O relatório local pode funcionar sem internet após baixar dependências e modelo. O fluxo completo de autorização MQTT e o Pix continuam dependendo dos serviços externos. Instalar Ollama não elimina essa dependência do atendimento.

### 8. Abrir no tablet

Conecte o tablet e o computador à mesma rede. No computador, execute ipconfig e identifique o IPv4 da conexão usada. No tablet, abra http://IP-DO-COMPUTADOR:3001/ para o totem ou http://IP-DO-COMPUTADOR:3001/admin.html para o painel.

O computador precisa permanecer ligado, com backend e Ollama abertos. O tablet só exibe a interface; não executa o modelo. Se necessário, permita a porta 3001 na rede privada do firewall. Não use localhost no tablet para acessar o computador e mantenha a porta 11434 do Ollama restrita ao próprio computador.

## 8. Roteiro de demonstração das funcionalidades

### Preparar as duas telas

Abra o totem e o administrativo em abas separadas. Confira que não aparece aviso de servidor desconectado. O histórico pode começar vazio ou conter demonstrações anteriores. Nenhum dado precisa ser apagado para apresentar o projeto.

### Criar e acompanhar uma recarga

1. No totem, clique em Iniciar Carregamento e escolha uma estação livre.
2. Clique em Continuar para Veículo e selecione um modelo. Observe bateria de chegada, meta de 80%, energia, duração e custo estimados.
3. Avance ao pagamento. Para demonstrar sem cobrança, escolha Débito ou Crédito, confirme a opção e clique em Prosseguir para a recarga (demonstração).
4. Na autorização, confira a conexão MQTT. Clique em LIGAR - Autorizar para iniciar. Esse comando é publicado no tópico compartilhado e pode acionar um ESP32 conectado; usar uma estação simulada não isola o comando público de autorização do hardware.
5. O totem volta às estações. Toque no cartão ocupado para acompanhar a sessão e volte à lista sem encerrá-la.
6. Inicie outra sessão em uma estação livre. Compare os dois cartões e o administrativo. A espera por autorização é sequencial, mas as recargas autorizadas coexistem.

### Mostrar redistribuição

Abra o painel DEMO pela aba na borda ou por Ctrl+D, quando o atalho não for interceptado pelo navegador. Use Pico moderado e observe a redução da potência disponível. Use Pico severo e observe nova redução; pode haver pausa se faltar a corrente mínima. Não prometa uma pausa em todo cenário.

Use Normalizar consumo para recuperar o orçamento. Teste 1x, 60x ou 240x para alterar a velocidade da física simulada; Pausar congela o relógio do cenário. Há botões de horário, ajustes de minutos, dia da semana e conexão com o ESP32. Esses controles afetam o estado compartilhado e não são um cadastro de tarifas reais.

### Encerrar e conferir o histórico

Nos detalhes de uma sessão, clique em Encerrar Carregamento. Confira energia, duração, segmentos tarifários e valor calculado no resumo. Volte às estações e confirme que apenas aquela estação ficou livre e que a outra continuou. No administrativo, abra Sessões, Visão Geral e Faturamento para conferir o registro.

### Mostrar manutenção e relatório

Em Estações, coloque um ponto livre em manutenção, confira sua indisponibilidade no totem e reative-o. Depois abra GoodWe / SEMS+ e explique a data da importação. Em Tarifação, mostre o preço aberto e os protocolos simulados. Por fim, gere o relatório de Hoje e baixe o PDF. Alterar o período muda as sessões encerradas consideradas, não transforma o estado atual em histórico.

## 9. Diagnóstico, manutenção e referências do código

### Problemas frequentes

| Sintoma | Verificação e solução |
| --- | --- |
| localhost:3001 não abre | Confira o terminal do backend e a pasta usada. Rode npm start --prefix server na raiz chargegrid-hub e consulte /healthz. |
| Porta 3001 ou 11434 ocupada | Verifique se já existe backend ou Ollama aberto. Use a instância correta ou encerre apenas a duplicada. |
| Tela abre, mas mostra sem conexão | Backend e WebSocket precisam estar disponíveis na mesma origem. Abra a URL 3001, não o HTML por duplo clique. |
| Pix indisponível | Confira token no .env e ambiente das credenciais. A demonstração sem cobrança continua sendo uma alternativa. |
| LIGAR desabilitado | Aguarde a conexão MQTT e confira acesso à internet/broker. Ollama conectado não significa MQTT conectado. |
| IA sem modelo ou indisponível | Inicie start-ollama.ps1, baixe qwen2.5:3b pelo executável indicado e consulte /api/reports/status. |
| PDF expirou | Gere novamente. O relatório guardado no servidor expira após 30 minutos ou ao reiniciar o backend. |
| Tablet não conecta | Use o IPv4 do computador, confira a rede e a liberação da porta 3001 na rede privada. |

### Encerrar, reiniciar e preservar dados

Antes de desligar o backend, encerre as sessões de teste que deseja registrar. Use Ctrl+C no terminal do servidor; faça o mesmo no terminal do Ollama. Sessões ativas não são recuperadas após reiniciar. Não apague server/storage/totem-sessions.json ou server/storage/sems-import.json para resolver um problema de conexão.

Após editar server/.env, reinicie o backend. A IA local não exige conta OpenAI nem chave de API paga.

### Verificação automatizada

```powershell
Set-Location 'C:\Users\Pichau\Desktop\GOODWE-PROJETO\chargegrid-hub'
node --test server/test/*.test.js
```

A suíte cobre distribuição, MQTT, sessões, persistência e relatórios/PDF em cenários controlados. Não substitui validação de pagamento ou hardware. Esta revisão não executou transações ou ensaios elétricos.

### Onde cada funcionalidade está implementada

server/server.js: servidor, arquivos estáticos e Pix. server/ws.js: canal compartilhado e comandos. js/app.js e js/charging.js: fluxo do totem e acompanhamento. js/admin.js: áreas administrativas. server/sim/demand.js e engine.js: alocação e motor. server/sim/smart-pricing.js e js/sim/tariff.js: formação do preço. data/mock-data.js: veículos; data/site-config.js: cenário elétrico. server/operational-reports.js e report-pdf.js: análise, Ollama e PDF. server/totem-history.js: persistência. esp32/chargegrid-rele.ino: firmware do protótipo.

Documentação complementar: IA-ADMIN.md, DADOS-ADMIN.md, MQTT-AUTORIZACAO.md, HARDWARE-E-PAGAMENTO.md e HOSPEDAGEM.md. O README contém trechos antigos; este passo a passo foi conferido contra a implementação atual. Funcionalidades pendentes incluem maquininha, telemetria automática, controle físico de corrente, conciliação financeira, nota fiscal e autenticação apropriada para produção.
