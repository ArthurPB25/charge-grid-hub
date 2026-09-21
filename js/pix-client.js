/**
 * Cliente do Pix real, falando com o servidor local (server/server.js).
 *
 * O token do Mercado Pago nunca aparece aqui — este arquivo só sabe chamar
 * duas rotas HTTP num servidor que roda separado do site. Se esse servidor
 * não estiver no ar, ou não tiver o token configurado, os métodos abaixo
 * rejeitam a Promise com uma mensagem clara, e quem chamou decide como reagir
 * — o fluxo do totem cai de volta para a tela de pendência honesta em vez de
 * travar ou fingir que funcionou.
 *
 * O endereço do servidor acompanha o próprio host da página, não fica fixo
 * em "localhost": se o tótem abrir em localhost, chama localhost; se abrir a
 * partir de um tablet acessando pelo IP do computador na rede local (ex:
 * http://192.168.10.101:8322), chama esse mesmo IP na porta do servidor —
 * "localhost" no tablet apontaria para o próprio tablet, não para o
 * computador que roda o servidor do Pix.
 */
window.PixClient = {
  baseUrl: `http://${window.location.hostname}:3001`,

  async criarCobranca({ valor, descricao, email }) {
    let resposta;
    try {
      resposta = await fetch(`${this.baseUrl}/api/pix/criar-cobranca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor, descricao, email })
      });
    } catch (err) {
      throw new Error(
        `Não consegui conectar ao servidor de pagamento (${this.baseUrl}). ` +
        'Ele está rodando? (cd server && npm start)'
      );
    }

    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      throw new Error(dados.erro || 'O servidor de pagamento recusou o pedido.');
    }
    return dados;
  },

  async consultarStatus(paymentId) {
    const resposta = await fetch(`${this.baseUrl}/api/pix/status/${encodeURIComponent(paymentId)}`);
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      throw new Error(dados.erro || 'Não foi possível consultar o status do pagamento.');
    }
    return dados;
  },

  /**
   * Consulta o status a cada `intervaloMs` até aprovar, ser cancelado, ou
   * até `onTick` mandar parar (retornando false). Devolve uma função para
   * cancelar o polling manualmente (ex: quando o usuário fecha a tela).
   */
  acompanharStatus(paymentId, { intervaloMs = 3000, onStatus, onErro } = {}) {
    let ativo = true;

    const passo = async () => {
      if (!ativo) return;
      try {
        const { status, statusDetail } = await this.consultarStatus(paymentId);
        if (!ativo) return;
        const continuar = onStatus ? onStatus(status, statusDetail) : true;
        if (continuar === false || status === 'approved' || status === 'cancelled' || status === 'rejected') {
          return;
        }
      } catch (err) {
        if (onErro) onErro(err);
        return;
      }
      if (ativo) setTimeout(passo, intervaloMs);
    };

    setTimeout(passo, intervaloMs);
    return () => { ativo = false; };
  }
};
