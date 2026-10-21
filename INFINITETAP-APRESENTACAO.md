# InfiniteTap conectado ao totem — apresentação do grupo

## O que está implementado

Pedido de cartão no totem → código de conexão → app Android abre o InfiniteTap
com **R$ 1,00** → app recebe retorno local → comunica o pedido ao backend →
backend inicia a sessão daquela estação → totem volta às estações.

Este é um modo de demonstração autorizado para uso do grupo. A liberação usa
indícios no callback local, sem consulta financeira independente à InfinitePay.
Não utilizar como integração bancária de produção. O custo simulado da energia
continua calculado normalmente e não é o valor cobrado na apresentação.
O fluxo Pix existente não muda de valor ou de provedor.

## Rodar

No `server/.env`, adicione `TAP_DEMO_ENABLED=true` e reinicie o backend:

```powershell
cd server
npm start
```

Para usar a porta 3002 nessa execução:

```powershell
$env:PORT='3002'
$env:TAP_DEMO_ENABLED='true'
node server.js
```

O recurso vem desativado por padrão. Com ele desativado, permanece o fluxo de
cartão de demonstração anterior. Não é necessário token da InfinitePay para
abrir o InfiniteTap por deeplink. O APK requer internet/rede para o servidor;
HTTP é permitido para a apresentação em rede local.

## Testar com S21 FE

1. Atualize o app ChargeGrid instalando o APK gerado em
   `mobile/tap-poc/build/local/chargegrid-tap-teste.apk` (código-fonte v0.4, código 4).
   Verifique a versão instalada: o APK v0.3 já copiado não contém as correções v0.4.
   Preserve a instalação anterior e a chave de assinatura local para atualizar.
2. Conecte celular e computador à mesma rede. O InfinitePay também precisa
   acessar a internet. O celular não deve usar `localhost` como endereço do PC.
3. No totem, escolha estação, carro e cartão (débito/crédito). Confirme para
   gerar o pedido de R$ 1,00 e o código de 8 caracteres.
4. No app ChargeGrid informe a InfiniteTag sem `$`, o endereço do computador
   (`http://IP-DO-COMPUTADOR:3002`) e o código. Toque em **Conectar pedido do totem**.
   O título deve mostrar **v0.3**. Se os campos estiverem bloqueados por um teste
   anterior, toque em **Novo pedido / digitar código**, confira a transação antiga
   e confirme a troca. Não é preciso limpar os dados nem reinstalar do zero.
   Um retorno pendente de envio precisa ser reenviado antes de trocar o pedido.
5. Confira estação e carro no app. Toque em **Preparar teste de R$ 1,00** e
   confirme a abertura da cobrança. O servidor confere se o pedido ainda está
   disponível antes de abrir o InfiniteTap.
6. Primeiro teste **cancelando sem aproximar cartão**. Retornos sem os dados
   exigidos ou com indicação de falha não iniciam sessão.
7. Quando o grupo autorizar um pagamento real, confira valor/conta no InfinitePay
   e conclua. O app envia o retorno local e o totem deve mostrar a estação
   carregando. Não há botão extra de LIGAR no fluxo do pedido Tap.
8. Se a rede cair depois de pagar, use **Reenviar retorno ao totem**, sem pagar
   novamente. O pedido idempotente não inicia outra sessão.

O endereço do computador pode mudar em outra rede. Use `ipconfig` para conferir.
Se não conectar, confira IP, porta, mesma rede, isolamento do Wi-Fi e as regras
do firewall. Nenhuma regra de firewall é aberta automaticamente por este projeto.
No aparelho final, instale o mesmo APK em Android compatível, configure o acesso
autorizado à conta e repita a conexão com um pedido novo. iOS precisa de outra ponte.

## Critério do retorno de demonstração

- Pedido e nonce do callback precisam corresponder ao teste salvo no celular.
- Handle retornado precisa corresponder à conta informada.
- Servidor exige token específico do celular para aquele pedido.
- NSU em formato UUID, autorização e bandeira não vazias.
- Nenhum warning, erro ou sinal de cancelamento; status explícito, se presente,
  precisa ser um dos valores de sucesso aceitos. Retornos vazios são recusados.
- Sessão inicia uma única vez; NSU já utilizado em outro pedido é recusado.
- Pedido cancelado/expirado ou estação ocupada não inicia recarga.

**Esse critério é uma heurística de demonstração, não autenticação financeira.**
A documentação pública do Tap tem campos semelhantes em exemplos de sucesso e
erro e não especifica todos os códigos de cancelamento. Um callback forjado ou
ambíguo pode passar na heurística. A ausência de erro não prova aprovação bancária.
Validar no aparelho como o InfinitePay realmente retorna cancelamentos e vendas.
O teste de cancelamento já realizado com o APK antigo validou ida/volta, não
comprovou o classificador novo. Não declarar que todas as recusas estão cobertas.

## Liberação e limites

- Sessão e estado aparecem pelo WebSocket já usado no site; atualização do pedido
  é consultada pelo totem a cada 1,5 segundo.
- O pedido expira em 10 minutos. Código conecta um único celular. Não compartilhar
  os códigos e tokens fora do grupo. Há um pedido pendente por estação nesse fluxo;
  outros comandos de demonstração ainda podem ocupar uma estação.
- A ponte MQTT legada continua associada à estação 1 e ao navegador que acompanha
  o pedido. Aprovação sem totem conectado não garante acionamento físico do relé.
  O backend recebe o retorno e inicia a simulação; o totem precisa permanecer aberto
  para a ponte MQTT. As outras estações continuam simuladas.
- Pedidos/NSUs ficam em memória; reiniciar o servidor perde a conciliação e pedidos
  pendentes. Não reiniciar durante pagamento, nem pagar de novo sem conferir a conta.
- Se já pagou e a estação ficou indisponível, consulte o operador. Não há estorno
  automático. Cancelar pedido no totem/encerrar acompanhamento no app não estorna.
- O histórico identifica `tap-demo`, R$ 1,00 e evidência de callback local, separados
  do custo calculado. Não há comprovante bancário emitido pelo ChargeGrid.
- Nenhuma transação real é executada pela suíte de testes ou pelo agente.

## Compilar e verificar

```powershell
powershell -NoProfile -File mobile/tap-poc/build-local.ps1 -JdkPath 'C:\Program Files\Java\jdk-21'
node --test server/test/*.test.js
```

O script requer SDK Android 36 e Build Tools 36.0.0. A chave local em
`mobile/tap-poc/build/local/test.keystore` deve ser preservada para atualizações.
Ela e os APKs ficam ignorados no Git. Não é necessário ativar modo desenvolvedor
no celular para instalar por arquivo. InfiniteTap exige esse modo desativado.

Contrato consultado: https://www.infinitepay.io/checkout-tap.
Investigação da confirmação independente: [INFINITETAP.md](INFINITETAP.md).
