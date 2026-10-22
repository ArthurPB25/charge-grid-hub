# Maquininha ChargeGrid — InfiniteTap v0.8

## Uso no estabelecimento

Instale o APK privado `mobile/tap-poc/build/local/chargegrid-maquininha-v0.8.apk`
por cima da versão anterior e abra o app. Ele já contém o servidor do Render,
a conta `arthur-primo` e a autorização do terminal. Nenhum campo precisa ser
preenchido. Mantenha este aplicativo aberto no celular fixo, com o InfinitePay
instalado e conectado na conta recebedora. O APK é exclusivo do estabelecimento;
não o publique no GitHub nem distribua aos clientes.

A tela de espera tem a identidade ChargeGrid. Quando o cliente escolhe cartão
no totem, o app busca o pedido e abre diretamente o InfiniteTap com R$1,00,
o meio de pagamento e o identificador do pedido. Aproximação, autorização e
conclusão do pagamento acontecem no aplicativo oficial InfinitePay.

O retorno é enviado ao servidor e o celular volta a aguardar o próximo pedido.
O totem avança automaticamente à página **Pagamento recebido**. A carga fica
parada até o cliente conectar o cabo e tocar em **Conectar**. O retorno financeiro
não cria sessão nem aciona o relé. O comando de início permanece na ponte
existente e só é solicitado após Conectar. Firmware e tópicos não foram alterados.

## Preparação técnica privada

`server/storage/tap-terminal-provisioning.json` contém a configuração privada,
fora do Git. O script `build-local.ps1 -ProvisioningFile CAMINHO` gera
TerminalConfig.java somente em build/local/generated, também ignorado. O fonte
público TerminalConfig.java contém apenas valores vazios e não autoriza terminal.

No Render configure TAP_DEMO_ENABLED=true, TAP_TERMINAL_KEY com o mesmo segredo
e TAP_TERMINAL_HANDLE com a conta recebedora. Nenhuma chave InfinitePay é usada.
A chave interna só autoriza a fila ChargeGrid. Para manutenção, mantenha o título
ChargeGrid pressionado para revelar os controles do estabelecimento.

A integração segue https://www.infinitepay.io/checkout-tap. Trata-se da
demonstração que usa retorno local do InfiniteTap, sem consulta bancária
independente. Não há captura de cartão ou implementação NFC própria.

## Recuperação e limites

- A mesma identidade recupera o mesmo pedido sem abrir outra cobrança.
- O app salva a abertura antes de chamar InfiniteTap e preserva retorno pendente.
- Retorno sem rede é reenviado automaticamente, sem novo pagamento.
- Conectar exige pagamento recebido e token exclusivo do totem; o celular
  não pode iniciar uma recarga. Repetições de Conectar não duplicam sessões.
- Estação indisponível bloqueia Conectar sem pedir novo pagamento.
- Configuração de conta diferente é recusada no backend.
- Pedidos e vínculo do terminal continuam na memória do serviço. Reinício ou
  deploy durante atendimento pode perder o acompanhamento. Não reinicie durante
  pagamento. A autorização é exclusiva de um dispositivo por execução.
- Cancelar ou limpar acompanhamento não estorna dinheiro. Falha financeira ou
  resultado ambíguo exigem conferência pelo estabelecimento no InfinitePay.
- Não há controle remoto do S21 FE neste computador; instalação e primeiro teste
  físico devem ser feitos no aparelho, começando por cancelamento sem cartão.

## APK verificado

Versão 0.8 / código 8, Android mínimo 11, assinatura APK v3 válida com o mesmo
certificado das versões anteriores.
SHA256: 16708800f8f52961087743c2069770494a9100c4d3b829c4b78b5fbda9c566d7.