# Autorização da recarga por MQTT

O controle segue o exemplo do painel ESP32: botões LIGAR/DESLIGAR, status da
conexão e log de comandos. Usa a biblioteca MQTT já incluída no projeto,
sem dependências novas.

## Fluxo no site

1. Inicie o backend (`npm start` em `server`) e sirva `chargegrid-hub` por HTTP.
2. Escolha estação e veículo. Pague com Pix ou selecione cartão e use o botão
   de demonstração para testar sem cobrança.
3. Na tela **Autorização da recarga**, clique **LIGAR · Autorizar** ou publique
   o comando pelo painel externo. A sessão só começa quando o navegador recebe
   LIGAR do broker e encaminha a autorização ao servidor.
4. Após a autorização, o totem volta à lista de estações. O cartão da estação
   mostra o veículo e a porcentagem simulada; tocar nele abre o acompanhamento.
   Voltar à lista não interrompe a recarga e permite atender outro motorista.
5. **DESLIGAR** durante a espera nega a autorização. No acompanhamento,
   os botões **DESLIGAR · Encerrar recarga** e **Encerrar Carregamento** enviam
   o identificador da sessão selecionada ao backend, em qualquer estação.
   Funcionam também após reconectar ou iniciar outra recarga. Se já estiver
   concluída, ambos mostram **Ver resumo e liberar estação**. Só a estação 1
   envia também o corte ao relé físico. Comandos externos MQTT continuam
   restritos à estação física 1.

Os botões de autorização ficam desabilitados quando não há conexão MQTT.
O encerramento pelo site depende da conexão com o backend. A espera expira em
120 segundos e pode ser cancelada ou repetida. Repetir a autorização não gera
uma nova cobrança. Cancelar a solicitação não estorna um Pix aprovado.

## Compatibilidade com o exemplo

- Broker: `wss://broker.emqx.io:8084/mqtt`
- Tópico de autorização: `meu_projeto/tomada/comando`
- Mensagens: texto puro `LIGAR` ou `DESLIGAR`, em maiúsculas, **sem retain**.

O painel HTML fornecido pode enviar os comandos diretamente. Os links de CDN
que vieram no texto colado precisam ser URLs normais nos atributos HTML;
o site do projeto já usa sua cópia local de MQTT.js.

O totem assina automaticamente o tópico e encaminha os comandos recebidos por
WebSocket. O backend mantém uma única solicitação pendente e só cria a sessão
após a autorização da conexão correspondente. Comandos fora da espera não
iniciam sessões; repetições de LIGAR não criam outra sessão. Mensagens retidas
são ignoradas pelo navegador. Cancelamento, desconexão e prazo expirado invalidam
a espera. As sessões ambiente do simulador continuam independentes.

## Relé e controle de demanda

O firmware ESP32 continua aceitando LIGAR/DESLIGAR em `meu_projeto/tomada/comando`.
O sensor de cabo mantém sua função no relé. A autorização no site não significa
que o hardware confirmou carga: é a recepção do comando, como no exemplo.

Comandos automáticos do motor (pausa/retomada por demanda e finalização) usam
`meu_projeto/tomada/rele`, também assinado pelo firmware atualizado. Separar esse
tráfego impede que uma suspensão automática encerre a sessão por engano.
O tópico `meu_projeto/tomada/status` permanece para telemetria do hardware.

## Limites do protótipo

O tópico é compartilhado, sem identificação de estação ou sessão no payload,
e controla uma única estação física legada (estação 1). As outras estações representam
sessões independentes no simulador e não enviam comandos automáticos a esse relé.
Um comando LIGAR autoriza a solicitação pendente. O broker público e a ponte WebSocket
não autenticam o emissor: isto é uma demonstração, não um mecanismo de acesso
pronto para produção. Para sessões Pix, o servidor confere a aprovação, o valor e o vínculo da cobrança
com estação, veículo e bateria/meta; cada pagamento libera somente uma sessão.
Esse vínculo fica na memória: reiniciar o backend exige tratamento pelo operador
para cobranças anteriores e não constitui conciliação financeira permanente.
A perda do navegador cancela somente a autorização pendente; sessões iniciadas
continuam no servidor. A ponte MQTT física ainda depende do navegador, portanto
esta mudança não oferece supervisão física durante uma desconexão. Reiniciar o
backend perde as sessões em andamento. Ao atingir a meta, uma sessão do totem
permanece visível como concluída até a consulta do resumo liberar sua estação.

## Verificação local

Execute `node --test test/*.test.js` dentro de `server` para validar o fluxo
sem enviar comandos ao broker público ou acionar equipamentos.
