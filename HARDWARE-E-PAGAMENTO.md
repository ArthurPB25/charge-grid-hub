# Hardware real e Pix — guia de configuração

Este documento cobre as duas partes que só vocês podem terminar: a montagem
física do ESP32 e a criação da conta do Mercado Pago. O código de ambos os
lados já está pronto e testado (veja "O que já foi validado" no fim).

**Atualização do fluxo MQTT:** o totem agora conecta automaticamente e aguarda
`LIGAR` em `meu_projeto/tomada/comando` para iniciar a recarga. `DESLIGAR` encerra
a sessão. O firmware também assina `meu_projeto/tomada/rele` para comandos
automáticos de demanda. Veja [MQTT-AUTORIZACAO.md](MQTT-AUTORIZACAO.md) para o
procedimento atual; as validações históricas abaixo não validam este novo fluxo.

## 1. Testar o firmware no Wokwi antes de montar de verdade

O arquivo `esp32/chargegrid-rele.ino` já está pronto para o
[Wokwi](https://wokwi.com) (por isso usa a rede `Wokwi-GUEST`). Antes de
mexer em tensão de rede de verdade, valide a lógica no simulador:

1. Crie um novo projeto ESP32 no Wokwi.
2. Cole o conteúdo de `esp32/chargegrid-rele.ino`.
3. No editor de diagrama, adicione um **módulo de relé** ligado ao pino 2, e
   um **pushbutton** ligado ao pino 4 e ao GND (ele representa a chave
   fim-de-curso do sensor de cabo).
4. Rode a simulação. No Serial Monitor, você deve ver o ESP32 conectar ao
   Wi-Fi e ao broker.
5. Publique manualmente `LIGAR` no tópico `meu_projeto/tomada/comando` (dá
   pra fazer isso por qualquer cliente MQTT, incluindo o
   [teste público do EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker) —
   veja a seção "Testar sem montar nada" abaixo) e confirme que o relé simulado
   só fecha se o pushbutton também estiver pressionado.

## 2. Montagem física — leia antes de mexer com a tomada

**Isto envolve tensão de rede (127V ou 220V) — risco real de choque e de
incêndio se malfeito.** Algumas regras não são negociáveis:

- Nunca mexa na fiação de força com o cabo ligado na tomada da parede.
- Use um **módulo relé pronto** (com opto-acoplador), não um relé nu — eles
  já vêm com o isolamento entre o lado de baixa tensão (ESP32) e o lado de
  alta tensão (relé/contatos) resolvido.
- O relé só precisa suportar a corrente de um carregador de celular (bem
  abaixo de 1A) — qualquer módulo comum de 5V/10A já sobra em margem de
  segurança.
- Deixe as conexões de alta tensão dentro de um invólucro (uma caixinha
  plástica, por exemplo) — nunca com fios de rede expostos ao toque.
- Se ninguém do grupo tem experiência com instalação elétrica, peça ajuda a
  alguém que tenha antes de energizar o circuito pela primeira vez.

### Ligação

```
ESP32 (GPIO 2) ───────────────▶ IN do módulo relé
ESP32 (5V)     ───────────────▶ VCC do módulo relé
ESP32 (GND)    ───────────────▶ GND do módulo relé

ESP32 (GPIO 4) ───┐
                   ├──▶ um terminal da chave fim-de-curso
ESP32 (GND)    ───┘    outro terminal da chave fim-de-curso
                        (INPUT_PULLUP já configurado no firmware —
                         não precisa de resistor externo)

Tomada de parede (fase) ──▶ COM do relé
                            NA (normalmente aberto) do relé ──▶ fase do
                            cabo que alimenta o carregador de celular
Tomada de parede (neutro) ──────────────────────────────────▶ neutro do
                            cabo que alimenta o carregador de celular
```

A chave fim-de-curso fica posicionada de forma que o ato de encaixar o
plugue do carregador de celular no seu suporte pressione a chave. Se vocês
preferirem algo ainda mais simples para a primeira versão, um reed switch +
ímã colado no plugue funciona do mesmo jeito e sem contato mecânico.

## 3. Rodar o sistema com o hardware real

1. Grave `esp32/chargegrid-rele.ino` no ESP32 de verdade (troque `ssid` e
   `password` pela rede Wi-Fi real antes de gravar — a rede `Wokwi-GUEST`
   só existe dentro do simulador).
2. Abra o totem (`index.html`) ou o painel (`admin.html`) normalmente.
3. Aperte **Ctrl+D** para abrir o painel de demonstração e clique em
   **"Conectar ao ESP32"**. O status deve mudar para "conectado" em poucos
   segundos.
4. Inicie uma recarga pelo totem — o site publica o comando real, e o relé
   deve fechar (se o sensor de cabo detectar o plugue conectado).

## 4. Testar a ponte MQTT sem montar nada ainda

Se o hardware ainda não estiver montado, dá pra confirmar que a parte do
site funciona sozinha, usando outro computador (ou o celular) como um
"ESP32 de mentira": entre em
[https://mqttx.app/web-client](https://mqttx.app/web-client) (cliente MQTT
gratuito no navegador), conecte em `broker.emqx.io` porta `8083` (WebSocket),
assine o tópico `meu_projeto/tomada/comando`, e clique em "Conectar ao ESP32"
no totem — as mensagens `LIGAR`/`DESLIGAR` devem aparecer lá em tempo real
conforme você inicia/encerra uma recarga.

## 5. Pix real via Mercado Pago

1. Crie uma conta em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers).
2. No painel, vá em **"Suas integrações" → "Criar aplicação"**.
3. Escolha **"Pagamentos online"** como o produto a integrar (não precisa de
   CNPJ para o modo de teste).
4. Na página da aplicação, aba **"Credenciais de teste"**, copie o
   **Access Token** de teste (começa com `TEST-`).
5. No projeto, copie `server/.env.example` para `server/.env` e cole o token
   ali.
6. Rode o servidor:
   ```bash
   cd server
   npm install
   npm start
   ```
7. Deixe esse servidor rodando **junto** com o servidor do site
   (`python .claude/serve.py 8322`) — são dois processos separados, em
   portas diferentes (3001 e 8322).
8. No totem, escolha Pix na tela de pagamento — agora deve aparecer um QR
   Code real, gerado pelo Mercado Pago em modo de teste.
9. Para simular a aprovação sem escanear de verdade, use as
   [contas de teste do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-test/test-cards)
   ou, mais simples, o próprio painel de desenvolvedor tem um botão para
   marcar um pagamento de teste como aprovado manualmente.

O cartão de débito/crédito continua mostrando a tela de "em desenvolvimento"
— só o Pix foi integrado de verdade nesta etapa.

## O que já foi validado nesta sessão (antes de vocês mexerem em nada)

- O caminho MQTT completo foi testado de ponta a ponta com um processo real
  fazendo o papel do ESP32: o navegador publicou `LIGAR` em
  `meu_projeto/tomada/comando` via WebSocket seguro
  (`wss://broker.emqx.io:8084/mqtt`), o "ESP32" recebeu por TCP puro
  (`mqtt://broker.emqx.io:1883` — o mesmo que o firmware usa), respondeu
  `CARREGANDO` no tópico de status, e o navegador exibiu esse status de
  volta no painel. Round-trip real, não simulado.
- O servidor do Pix sobe, detecta corretamente a ausência do token, e — com
  um token de teste inválido — a chamada chega de fato aos servidores do
  Mercado Pago e recebe a recusa deles (prova que a rota, os cabeçalhos e o
  formato do corpo da requisição estão certos; só falta um token válido de
  verdade).
- O fluxo do totem trata os dois tipos de falha (servidor fora do ar, token
  inválido) mostrando uma mensagem de erro clara — nunca finge que o
  pagamento passou.

O que **não** foi validado, porque exige hardware físico ou uma conta que só
vocês podem criar: o firmware rodando num ESP32 de verdade, o relé
fisicamente ligado, o sensor de cabo montado, e uma cobrança Pix aprovada de
ponta a ponta com um token de teste real.
