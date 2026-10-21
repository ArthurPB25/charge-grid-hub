# Correções InfiniteTap — 21/10/2026

- NSUs UUID são normalizados antes de verificar reutilização, inclusive quando o retorno muda maiúsculas/minúsculas.
- O totem distingue HTTP 404 de falhas temporárias: encerra acompanhamento de pedido desaparecido e orienta conferir o InfinitePay, sem anunciar cancelamento financeiro ou estorno.
- Erros e cancelamentos atrasados não limpam um pedido posterior. Falhas temporárias mantêm o acompanhamento.
- O código do app Android v0.4 salva uma chave secreta de conexão antes do envio. Repetir a mesma tentativa recupera o token; outros aparelhos/chaves e contas divergentes continuam bloqueados. O backend permanece compatível com v0.3, mas a recuperação exige v0.4.

Validação: 87 testes da suíte aprovados, incluindo regressões de NSU, dez conexões concorrentes com a mesma chave, rejeição de outras chaves/contas, expiração, recuperação 404 e falhas temporárias.

Na auditoria adicional, 17 de 20 cenários passaram. Continuam pendentes os cenários de retorno depois da expiração, consulta inicial lenta e falha de localStorage. Os testes que documentam falta de autenticação continuam reproduzindo essa limitação; passar nesses testes não indica proteção de acesso.

O APK v0.4 ainda precisa ser compilado com JDK/Android SDK e a mesma chave local, e validado no aparelho. O APK v0.3 anterior não é atualizado pela alteração do código-fonte. Nenhum teste movimentou dinheiro ou publicou comandos no broker MQTT.

O Blueprint Render está configurado para a apresentação com Tap habilitado e relatórios por regras. A hospedagem não transforma o retorno local em verificação financeira, nem adiciona autenticação ou persistência dos pedidos.
