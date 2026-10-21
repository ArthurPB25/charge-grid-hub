# Prova de integração InfiniteTap — Android

**Histórico da prova isolada (versão 0.1).** Para a versão 0.2 conectada ao totem,
use [INFINITETAP-APRESENTACAO.md](INFINITETAP-APRESENTACAO.md). A investigação da
consulta financeira independente abaixo permanece válida; o novo modo usa uma
heurística local autorizada para a apresentação do grupo.

Esta prova é separada do totem. Abre uma cobrança REAL de R$ 1,00 pelo
InfiniteTap com pedido exclusivo e recebe o retorno no celular. Não faz chamadas
ao backend, não envia comandos MQTT e não libera uma recarga.

## Preparar o aparelho

1. Instale o InfinitePay oficial e conclua a validação da conta.
2. Ative o NFC e mantenha internet disponível. Android 11 ou superior.
3. Desative as opções de desenvolvedor antes de abrir o InfiniteTap.
4. Confira se a função de venda por aproximação está disponível.
5. Instale o APK ChargeGrid Teste Tap. Autorize temporariamente a instalação
   pela origem usada para transferir o APK; depois desative essa autorização.

Não envie senha, token ou CPF para configurar esta prova. O campo do app pede
somente o **handle**: identificador da conta InfinitePay, sem @. Confira esse
identificador na conta antes de iniciar, pois o aplicativo o envia para verificar
a conta recebedora no InfiniteTap.

## Primeiro teste: abertura e cancelamento

1. Abra ChargeGrid Teste Tap e informe o handle da conta.
2. Selecione débito ou crédito à vista.
3. Toque em Preparar teste de R$ 1,00 e leia a confirmação.
4. Abra o InfiniteTap; confira a conta, o valor e o meio de pagamento.
5. **Sem aproximar cartão**, cancele a operação no InfinitePay.
6. Volte ao teste. Se não houver retorno, confira o estado no InfinitePay.
7. Encerre o acompanhamento pelo botão que explica que não cancela/estorna.

## Segundo teste: pagamento real, somente quando autorizado pelo pagador

Repita a abertura, confira valor/conta e aproxime o cartão. Há movimentação de
dinheiro e taxas. Não existe promessa de sandbox físico grátis nesta prova.
Confira o lançamento e resultado no InfinitePay, além do retorno ao nosso app.
O app exibe somente pedido, NSU, autorização, bandeira e aviso, quando recebidos.
Não exibe nem persiste o documento do recebedor ou a URL completa de retorno.

O resultado fica salvo localmente para acompanhar um teste por vez. Não crie
outra cobrança se tiver dúvida sobre a anterior: confira a conta primeiro.
O botão de encerrar acompanhamento não estorna nem cancela a venda financeira.

## Trocar de aparelho

Em outro Android compatível, instale o mesmo APK e configure o acesso autorizado
ao InfinitePay. Não existe IMEI ou identificação do S21 FE no código. O handle
configurado é da conta; o pedido é exclusivo de cada teste. Uma cobrança em
andamento deve ser conferida e encerrada no aparelho original antes da troca.
Repita o teste de abertura/cancelamento no aparelho da apresentação. Um iPhone
exige uma ponte iOS, não executa o APK Android.

## Limites e próxima fase

- Retorno por esquema de URL não é comprovação financeira autenticada.
- Pedido e nonce ajudam a descartar retornos de outros testes, mas não provam
  a origem da mensagem. O app nunca apresenta esse retorno como aprovação verificada.
- A documentação pública consultada não apresenta assinatura do retorno nem
  consulta financeira específica do InfiniteTap: confirmar com a InfinitePay
  como validar pedido, valor, conta e estado antes de liberar automaticamente.
- Esta prova usa valor fixo, não recebe pedidos do totem e não reserva estação.
  A fase seguinte é parear o celular com o backend, criar pedidos no servidor,
  validar o resultado financeiro e só então habilitar a recarga.
- O fluxo completo exige testes no S21 FE; compilar o APK não valida NFC,
  aprovação do cartão, disponibilidade do app ou retorno real do provedor.

## Investigação da confirmação financeira — 18/10/2026

Resultado: integração de abertura/retorno disponível e já observada pelo usuário
no S21 FE, inclusive ao cancelar antes de aproximar o cartão. Confirmação
financeira independente no servidor ainda não comprovada para o InfiniteTap.

Na documentação de Tap, o retorno de sucesso contém `order_id`, `nsu`, `aut`,
`card_brand`, identificação de acesso e identificação do recebedor. O exemplo
de erro também contém esses campos; `warning` é descrito como aviso de campo
ausente ou malformado. Não há contrato explícito de estado final ou código de
cancelamento. Logo, presença de NSU/aut, ausência de warning e retorno ao app
não podem ser usados isoladamente como aprovação ou cancelamento financeiro.
Não inferir que todo retorno sem aprovação significa que o cliente cancelou.

O Checkout Integrado tem `POST https://api.checkout.infinitepay.io/payment_check`
com `handle`, `order_nsu`, `transaction_nsu` e `slug`. O `slug` é identificador
da fatura do checkout, não está listado no contrato de retorno do Tap. Não há
suporte documentado que permita substituir `slug` por NSU ou enviar uma venda
Tap a essa consulta. Também não foi localizada assinatura de callback ou webhook
específico do Tap no material oficial público consultado. Isso é uma lacuna de
confirmação pública, não prova de que não exista recurso para parceiros.

Não foram utilizados endpoints internos, sessão de conta, credenciais ou
transações reais nesta investigação. Não foi enviada mensagem ao suporte.
O APK atual continua sem liberar recarga a partir de um callback.

### Pergunta preparada para o suporte de integração

Canal indicado na documentação de integração: `parcerias@cloudwalk.io`.
Pode também ser encaminhada pelo atendimento autenticado no app InfinitePay.

> Integramos o InfiniteTap Android por `infinitepaydash://infinitetap-app`, com
> `order_id`, valor em centavos, handle e `result_url`. A abertura e o retorno
> após cancelar já funcionam em um Galaxy S21 FE. Precisamos liberar uma recarga
> somente após verificar a transação no nosso servidor.
>
> 1. Qual API oficial consulta uma venda InfiniteTap pelo NSU e/ou order_id,
>    verificando conta recebedora, valor, aprovação, cancelamento e estorno?
> 2. Qual autenticação e habilitação são necessárias? Há webhook ou assinatura
>    verificável do retorno do Tap?
> 3. Qual contrato exato distingue aprovação, recusa, cancelamento antes do
>    cartão e erro técnico no callback? Os exemplos públicos compartilham NSU/aut.
> 4. `payment_check` suporta vendas InfiniteTap? Se sim, como obter o `slug`
>    exigido, que não consta no retorno público do Tap?
> 5. Há sandbox ou roteiro de homologação sem cobrança real para esse fluxo?

Não compartilhar senha ou códigos de acesso. Uma eventual resposta técnica deve
ser conferida antes de implementar a aprovação automática. Enquanto isso, são
possíveis conferência por operador ou checkout por link, com fluxos distintos.

Fontes primárias:

- Tap: https://www.infinitepay.io/checkout-tap
- Checkout/consulta: https://www.infinitepay.io/checkout-documentacao

## Compilar

Projeto: `mobile/tap-poc`. Requisitos: JDK 21, Android SDK plataforma 36 e
Build Tools 36.0.0. O APK local é assinado com certificado de teste, sem
permissão de internet; chave, APK e pastas de build ficam fora do Git.

Com as ferramentas instaladas no Windows:

```powershell
powershell -NoProfile -File mobile/tap-poc/build-local.ps1 -JdkPath 'C:\Program Files\Java\jdk-21'
```

Use `-SdkPath` para outra localização. Saída:
`mobile/tap-poc/build/local/chargegrid-tap-teste.apk`.
O script compila Java, gera DEX, empacota, alinha, assina e verifica a assinatura.
Para atualizar a instalação, preserve a chave local em `build/local/test.keystore`;
uma chave diferente exige desinstalar o APK anterior, perdendo seu estado local.

Também há projeto Gradle para Android Studio (Gradle 8.14.3, plugin Android
8.10.1), dependente do acesso aos repositórios Google/Maven. O script local
dispensa essa busca de dependências. A compilação debug também é não depurável;
as opções de desenvolvedor do celular devem permanecer desativadas para o Tap.

## Fontes

- Integração e parâmetros: https://www.infinitepay.io/checkout-tap
- Compatibilidade: https://ajuda.infinitepay.io/pt-BR/articles/6610274-quais-aparelhos-celulares-sao-compativeis-com-o-infinitetap
- Documentação consultada em 18/10/2026. Nenhum pagamento foi realizado pelo agente.
