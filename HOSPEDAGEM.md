# Hospedagem no Render

O `render.yaml` configura um Web Service gratuito, com Node 22, build
`npm ci --prefix server` e início `npm start --prefix server`.
Use a raiz do repositório, sem definir Root Directory como `server`.

O mesmo serviço entrega `/`, `/admin.html`, API e WebSocket `/ws`.
O navegador usa HTTPS e WSS automaticamente. O broker MQTT permanece
`wss://broker.emqx.io:8084/mqtt`.

No painel do Render, configure `MP_ACCESS_TOKEN` como variável secreta caso
vá testar Pix. `MP_SANDBOX=true` mantém o modo de teste. Não coloque tokens
no GitHub. Sem token, o site funciona, mas a criação de Pix fica indisponível.

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
