# Pix de R$ 1,00 — apresentação

O backend fixa a cobrança em **R$ 1,00**, independentemente da estimativa de energia
ou do valor enviado pelo navegador. O pedido continua vinculado à estação, ao
veículo e à bateria/meta escolhidos. Cobranças sem esses dados são recusadas.

O pagador informa seu próprio e-mail, enviado ao Mercado Pago para gerar o Pix.
No modo real ele é obrigatório; não é substituído por endereço fictício.
QR Code e copia e cola vêm do provedor. O backend confirma a aprovação, o valor
de R$ 1,00 e a correspondência da recarga antes de iniciar uma sessão uma única
vez. Pix pendente ou recusado não libera. A liberação não espera MQTT manual.

## Configuração

- `MP_ACCESS_TOKEN`: credencial secreta de produção da conta que receberá o Pix.
- `MP_SANDBOX=false`: não envia o nome de simulação APRO. O Blueprint Render usa
  esse modo; confira também a variável no serviço existente.
- `/api/pix/saude` informa presença de token, modo configurado e valor fixo. Isso
  não comprova que a credencial pertence a uma conta real ou está habilitada.

Use `MP_SANDBOX=true` e credenciais de teste em desenvolvimento. O frontend
identifica cobranças sandbox; a simulação pode aprovar automaticamente sem
transferência real. Não confundir isso com recebimento financeiro.

As validações automatizadas usam provedor simulado, sem cobranças reais. Para
validar recebimento, o grupo deve conferir a conta recebedora no aplicativo do
banco antes de pagar e verificar tanto a confirmação no totem quanto o lançamento
no Mercado Pago. O agente não realizou esse pagamento.

Pedidos Pix e controle de uso continuam em memória: reinícios/deploys perdem o
acompanhamento. Sair da tela não cancela nem estorna uma transferência. Se houve
pagamento e a estação ficou indisponível ou o servidor reiniciou, procurar o
operador e conferir a transação antes de repetir a cobrança. A integração não
implementa estorno automático nem autenticação do painel.

Referência: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix
