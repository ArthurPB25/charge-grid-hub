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
4. **DESLIGAR** durante a espera nega a autorização; durante a recarga encerra
   a sessão e abre o resumo. O botão de encerrar já existente continua funcionando.

Os botões ficam desabilitados quando não há conexão MQTT. A espera expira em
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
e controla uma única sessão do motorista. Um comando novo atua na sessão que
estiver aguardando/ativa naquele momento. O broker público e a ponte WebSocket
não autenticam o emissor: isto é uma demonstração, não um mecanismo de acesso
pronto para produção. Também não substitui a verificação de pagamento no servidor.
A perda do navegador encerra a simulação, mas não garante corte do relé físico.

## Verificação local

Execute `node --test test/*.test.js` dentro de `server` para validar o fluxo
sem enviar comandos ao broker público ou acionar equipamentos.
