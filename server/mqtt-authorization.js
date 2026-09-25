/** Espera por comandos recebidos pela ponte MQTT do navegador.
 * O protótipo não autentica o publicador MQTT nem o cliente WebSocket.
 */
export class MqttAuthorization {
  constructor({ timeoutMs = 120000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = null;
  }

  request(owner, stationId, notify, authorize) {
    if (this.pending && this.pending.owner !== owner) {
      notify({ status: 'error', message: 'Outro totem já aguarda autorização. Tente novamente depois.' });
      return;
    }
    this.cancel(owner);
    const timer = setTimeout(() => this.finish('expired', 'Autorização não recebida a tempo. Tente novamente.'), this.timeoutMs);
    timer.unref?.();
    this.pending = { owner, stationId, notify, authorize, timer, expiresAt: Date.now() + this.timeoutMs };
    notify({ status: 'waiting', stationId, message: 'Aguardando o comando LIGAR para autorizar a recarga.' });
  }

  receive(owner, command) {
    const pending = this.pending;
    if (!pending || pending.owner !== owner) return;
    if (Date.now() >= pending.expiresAt) {
      this.finish('expired', 'Autorização expirada. Tente novamente.');
      return;
    }
    if (command === 'DESLIGAR') {
      this.finish('denied', 'Recarga não autorizada: comando DESLIGAR recebido.');
    } else if (command === 'LIGAR') {
      this.pending = null;
      clearTimeout(pending.timer);
      try {
        pending.authorize();
        pending.notify({ status: 'approved', stationId: pending.stationId });
      } catch {
        pending.notify({ status: 'error', message: 'A estação não está mais disponível. Selecione uma estação livre.' });
      }
    }
  }

  finish(status, message) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.notify({ status, message });
  }

  cancel(owner) {
    if (this.pending?.owner === owner) this.finish('cancelled', 'Solicitação cancelada.');
  }
}
