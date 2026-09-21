/**
 * Estado do pedido no tótem.
 *
 * A integração de pagamento (Pix via API bancária, adquirente de cartão) ainda
 * não foi construída, e este módulo não a simula: o QR Code gerado por
 * JavaScript, a maquininha animada e o comprovante com NSU inventado foram
 * removidos porque encenavam uma integração inexistente — algo que não se
 * sustenta diante de qualquer pergunta sobre como o dinheiro chega ao operador.
 *
 * O que resta é apenas o que o tótem de fato sabe hoje: qual estação, qual
 * veículo, qual meio o motorista escolheu e quanto a recarga deve custar.
 */
window.PaymentController = {
  orderData: null,
  selectedMethod: null, // 'pix', 'debit' ou 'credit'

  methodLabels: {
    pix: 'Pix',
    debit: 'Cartão de débito',
    credit: 'Cartão de crédito'
  },

  startPayment(orderData) {
    this.orderData = orderData;
    this.selectedMethod = null;
    return this.getOrderSummary();
  },

  selectMethod(method) {
    this.selectedMethod = method;
  },

  selectedMethodLabel() {
    return this.methodLabels[this.selectedMethod] || 'não informado';
  },

  getOrderSummary() {
    return this.orderData;
  },

  cancelPayment() {
    this.selectedMethod = null;
    this.orderData = null;
  }
};
