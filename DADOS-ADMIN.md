# Fontes de dados do painel

## Operações do totem

O painel usa sessões iniciadas pelo totem, recebidas pelo WebSocket do servidor.
As sessões artificiais e a manutenção fictícia da quarta estação foram removidas
da inicialização padrão. O cadastro de quatro pontos continua sendo configuração
do protótipo, não descoberta de quatro carregadores físicos no SEMS+.

Encerramentos pelo motorista, MQTT, conclusão automática, desconexão ou manutenção
registram a sessão uma única vez. Datas do histórico são do relógio real; o dia é
agrupado no fuso America/Sao_Paulo. Energia e valores calculados continuam marcados
como estimativas enquanto o motor de recarga usar simulação.

O meio informado pelo totem diferencia Pix e demonstração. **Pix informado não é
comprovante de recebimento conciliado** e pode ser sandbox. O admin não classifica
mais todas as sessões como Pix nem apresenta o custo simulado como receita recebida.

Sessões concluídas são gravadas em `server/storage/totem-sessions.json`, ignorado
pelo Git. `TOTEM_HISTORY_FILE` permite definir outro caminho. Em hospedagem, esse
arquivo exige armazenamento persistente; um disco efêmero não preserva os registros
entre reinicializações/redeploys. Sessões em andamento não são recuperadas após queda.

## GoodWe / SEMS+

A aba GoodWe / SEMS+ lê `server/storage/sems-import.json`, ou o caminho indicado por
`SEMS_IMPORT_FILE`, na inicialização do servidor. Esta versão contém uma **importação
pontual de registros visíveis no portal autenticado**, realizada em 25/09/2026.
O arquivo contém fonte, instante da consulta, identificação do dispositivo e os
horários/energias exibidos no portal; não contém senha, token ou cookie.

A interface informa que não há sincronização automática e não trata o estado
observado como telemetria ao vivo. O total representa apenas os registros importados.
Esses registros não são somados às estimativas do totem, pois ainda não existe uma
associação confiável entre a sessão local e a transação do carregador.

O arquivo de importação fica fora do Git. Ao hospedar, será necessário transferi-lo
para armazenamento privado do serviço ou substituí-lo por um conector autenticado.

## Integração automática pendente

O acesso pelo portal confirmou a disponibilidade de histórico e estado do carregador,
mas não estabeleceu uma API autenticada para uso do backend. O próximo passo é obter
com a GoodWe/FIAP a documentação e permissão da integração SEMS+ para EV_CHARGER,
incluindo autenticação, campos disponíveis e frequência de consulta permitida.
As credenciais devem ficar no servidor, nunca no HTML/JavaScript do totem.

A leitura dos dados do SEMS+ nesta etapa não envia comandos nem altera o carregador.
