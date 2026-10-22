# Hospedagem no Render

O `render.yaml` configura um Web Service gratuito, com Node 22, build
`npm ci --prefix server` e início `npm start --prefix server`.
Use a raiz do repositório, sem definir Root Directory como `server`.

O mesmo serviço entrega `/`, `/admin.html`, API e WebSocket `/ws`.
O navegador usa HTTPS e WSS automaticamente. O broker MQTT permanece
`wss://broker.emqx.io:8084/mqtt`.

O Blueprint habilita `TAP_DEMO_ENABLED=true` para a apresentação do grupo.
Esse modo continua usando retorno local do InfiniteTap, sem verificação bancária.
Em um serviço existente, confira essa variável no painel: enviar o YAML ao GitHub
não altera automaticamente configurações de serviços que não usam Blueprint.
No app Android v0.4, use a URL HTTPS do serviço Render como endereço do servidor,
sem caminho ou barra final. A chave de recuperação é salva antes da conexão;
se a resposta se perder, repita Conectar com a mesma conta, endereço e código.

`AI_PROVIDER=rules` serve relatórios factuais e PDF sem depender do Ollama local
do computador. Um Ollama no PC da Juliana não fica disponível automaticamente
dentro do servidor Render.

No painel do Render, configure `MP_ACCESS_TOKEN` como variável secreta caso
vá receber Pix. `MP_SANDBOX=false` desativa os parâmetros de simulação; use
credenciais de produção da conta recebedora. `MP_SANDBOX=true` mantém o modo de teste. Não coloque tokens
no GitHub. Sem token, o site funciona, mas a criação de Pix fica indisponível.

O Pix da apresentação cobra R$ 1,00, validado pelo servidor, e solicita o e-mail
do pagador. A energia continua estimada separadamente. A liberação exige consulta
aprovada ao Mercado Pago, correspondência de valor e pedido e uso único; não
dispensa o LIGAR por MQTT após aprovação. Veja [PIX-APRESENTACAO.md](PIX-APRESENTACAO.md).

Para os registros importados do SEMS, adicione o conteúdo do arquivo local
`server/storage/sems-import.json` como Secret File `sems-import.json`,
e configure `SEMS_IMPORT_FILE=/etc/secrets/sems-import.json`.
Essa importação é histórica e não fornece sincronização automática.

No plano gratuito, o serviço pode dormir após inatividade e o disco é
temporário: reinícios ou deploys podem apagar o histórico do totem.
Para uso contínuo, use armazenamento persistente e configure
`TOTEM_HISTORY_FILE` para o caminho persistente, ou adote um banco de dados.
Execute uma única instância, pois o motor mantém estado na memória.

A aplicação atual não possui autenticação de usuários: quem acessar a URL
pode abrir o admin e os controles. Antes de disponibilizar para operação
real, é necessário controlar o acesso. O broker público também mantém
o comportamento original de autorização por texto nos tópicos MQTT.

Verificação local: `npm.cmd start --prefix server`, depois abra
`http://localhost:3001/admin.html`. A rota `/healthz` deve retornar `ok: true`.
Arquivos do servidor, `.env` e armazenamento não são servidos pelo site.

Documentação: https://render.com/docs/free e https://render.com/docs/websocket.
