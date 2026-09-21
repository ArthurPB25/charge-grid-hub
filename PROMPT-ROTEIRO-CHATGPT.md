# Prompt para o ChatGPT gerar o Roteiro do Pitch — ChargeGrid Hub

Copie e cole o bloco abaixo inteiro no ChatGPT. Ele contém todo o contexto do
projeto (o ChatGPT não tem acesso a esta pasta nem ao briefing da GoodWe), os
números verificados do sistema, e as duas regras que corrigimos ao longo do
processo — para o roteiro não repetir os mesmos erros.

---

```
Você vai escrever o ROTEIRO DE GRAVAÇÃO de um vídeo pitch de 3 minutos para o
projeto "ChargeGrid Hub", submetido ao desafio EV Challenge 2026 (GoodWe +
FIAP), trilha "ChargeGrid Intelligence". O vídeo será assistido por
avaliadores da GoodWe que decidem quais projetos avançam de fase. Um roteiro
de gravação não é um texto corrido: é a instrução de produção — o que a
câmera mostra, o que se fala, e por que cada momento está ali.

## REGRA 1 — VENDA O PRODUTO, NÃO EXPLIQUE O MECANISMO

Isto é um documento de venda, não de documentação técnica. Cada bloco lidera
com o benefício de negócio, em linguagem que qualquer pessoa não-técnica
entenda ("o sistema reduz a velocidade da recarga antes de estourar a conta
de luz", não "o algoritmo projeta a janela de faturamento de 15 minutos").
Termos técnicos (Modbus, OCPP, IA, protocolo) podem aparecer, mas NUNCA como
explicação de como o mecanismo funciona por dentro — só como flash de
credibilidade, dito no máximo uma vez por bloco. Regra prática: se uma frase
só faz sentido pra quem programa, ela sai do roteiro. Evite também tom de
relatório acadêmico ou institucional.

## REGRA 2 — NÃO INVENTE FATOS, E DEIXE RASTREÁVEL O QUE É CADA COISA

Toda afirmação de fato no roteiro precisa vir de uma das três fontes abaixo,
e você deve conseguir apontar qual:
  (a) uma citação do briefing oficial da GoodWe/FIAP — está toda no bloco
      "CONTEXTO DO DESAFIO" abaixo, não existe nenhuma outra fonte além dela;
  (b) um comportamento verificado do próprio sistema construído — está no
      bloco "O PRODUTO" abaixo, com os números reais observados;
  (c) uma dramatização ou inferência sua — só pode ser usada se for
      genuinamente óbvia a partir de (a) ou (b), e mesmo assim escreva-a de
      forma que não pareça uma citação literal do briefing. NÃO invente o
      que "o mercado tradicionalmente faz", números, prazos, ou citações
      regulatórias que não estejam explicitamente listados abaixo. Se
      quiser dramatizar algo além do que está aqui, marque isso com
      "[inferência]" na primeira versão do roteiro para eu decidir se fica.

## CONTEXTO DO DESAFIO (fonte (a) — citações verificadas do briefing oficial)

- Frase de abertura do briefing: "A mobilidade elétrica do futuro não
  depende apenas da capacidade das baterias ou da espessura dos cabos.
  Depende do código que orquestra e distribui essa energia."
- O briefing declara: "o código é apenas o veículo; a avaliação foca no
  raciocínio arquitetônico, de negócios e de gestão de dados." Os quatro
  entregáveis exigidos: (1) Arquitetura Funcional — lógica clara de
  entradas e saídas de dados; (2) Papel da IA Integrada — IA como motor
  lógico, não penduricalho de interface; (3) Aderência ao Contexto —
  solução sob medida para o ambiente comercial, ecossistema GoodWe/FIAP;
  (4) Visão de Produto Real — para quem serve, que problema resolve hoje.
- Problema central definido pelo briefing: "a ausência de mecanismos
  integrados em eletropostos comerciais para orquestrar potência, registrar
  ciclos, faturar e comunicar."
- Pilar "Controle de Demanda" do briefing — Ação: "Gerenciamento da potência
  entregue aos eletropostos." Impacto: "Redução de custos de infraestrutura
  e otimização da rede elétrica." (O briefing NÃO detalha qual infraestrutura
  nem menciona obra civil, prazos ou valores — não invente esses detalhes.)
- Missão declarada no briefing (página 2): "A missão deixou de ser apenas
  carregar o veículo. O desafio é transformar cada sessão de recarga em
  dados estruturados e inteligência acionável."
- Base regulatória (citações do briefing, seção "A Base Regulatória"):
  Resolução Normativa ANEEL nº 1.000/2021 — "A recarga pública e comercial
  pode operar com preços livremente negociados"; e a mesma norma "determina
  comunicação prévia e padrões abertos" exigindo que "equipamentos não
  exclusivos para uso privado devem usar protocolos abertos para controle
  remoto".
- Existem duas trilhas no desafio: "ChargeGrid Intelligence" (comercial,
  operação em tempo real — a nossa) e "EV ChargeOps" (condomínios, gestão
  compartilhada — NÃO é a nossa, não confundir nem misturar conteúdo dela).

## O PRODUTO (fonte (b) — comportamento verificado do sistema já construído)

ChargeGrid Hub NÃO é um carregador. É um tótem que se acopla a um carregador
GoodWe HCA G2 já instalado, sem modificá-lo: lê os dados do carregador via
Modbus RTU e traduz para OCPP 1.6J, o protocolo aberto do setor.

Problema de negócio que resolve: um estabelecimento comercial tem uma
demanda contratada com a concessionária (exemplo usado na demonstração:
75 kW). Poucos carregadores ligados ao mesmo tempo já pedem mais que isso.
O ChargeGrid resolve isso via software, dentro do carregador que já existe,
sem exigir mudança física na instalação elétrica.

Três capacidades, com números reais observados na simulação:

1. Controle Dinâmico de Demanda — acompanha o consumo do prédio e projeta a
   janela de faturamento (15 minutos) antes de fechar. Antes de estourar o
   contrato, reduz sozinho a corrente de cada carregador. Comportamento
   real: corte de 32A para 18A (moderado) ou até 16A com suspensão de uma
   sessão (severo). Existe um piso de segurança de 6A (norma IEC 61851):
   abaixo disso o sistema não reduz mais, suspende a sessão de menor
   prioridade e retoma sozinho quando sobra espaço.

2. Tarifação Dinâmica (Smart Pricing) — o preço do kWh muda em tempo real a
   partir de três variáveis: ocupação do eletroposto, horário (tarifa
   branca: fora-ponta / intermediário / ponta) e excedente de geração solar
   do inversor híbrido GoodWe do estabelecimento. Faixa de preço real
   observada: R$ 0,96/kWh ao meio-dia com excedente solar e baixa ocupação,
   até R$ 3,08/kWh no horário de ponta com o eletroposto lotado.

3. Tradução de Protocolo — lê tensão, corrente, potência, energia e
   temperatura via Modbus, e emite mensagens OCPP 1.6J reais
   (BootNotification, Authorize, StartTransaction, MeterValues,
   StatusNotification, SetChargingProfile, StopTransaction).

O sistema simula múltiplos veículos carregando ao mesmo tempo em pontos
diferentes, cada um com curva de carga realista baseada em veículos reais do
mercado brasileiro (BYD, GWM, Volvo, Tesla, Chevrolet), respeitando o limite
de potência de cada carro. Duas interfaces conectadas ao mesmo motor de
simulação ao vivo (não são maquetes separadas): um totem para o motorista e
um painel administrativo para o operador.

O que está declaradamente fora do escopo (mencionar com honestidade
estratégica, nunca como desculpa): a integração de pagamento com API
bancária ainda não existe — o totem mostra uma tela avisando isso
claramente, em vez de simular um QR Code Pix ou maquininha de cartão falsos.
Também fora do escopo desta entrega, por pertencerem a outras disciplinas do
curso: leitor RFID/NFC, chatbot conversacional, circuito de priorização em
Arduino, análise estatística em Pandas.

## DIREÇÃO CRIATIVA (regras de produção, não de conteúdo)

- Abra no problema, não no nome do projeto — a primeira imagem é um número
  (a demanda contratada) e uma tela real do sistema, não uma introdução do
  time. O nome "ChargeGrid Hub" só aparece no fechamento.
- Todo bloco de demonstração deve indicar gravação REAL do sistema
  acontecendo (não uma animação nem uma screenshot estática) — ele existe e
  roda, então mostre ele rodando.
- Feche o vídeo devolvendo a frase de abertura do briefing ("depende do
  código que orquestra essa energia") como resposta, não como citação
  decorativa.
- Evite cortes estáticos de mais de 4–5 segundos fora dos blocos de
  demonstração.
- Não peça desculpas pelo pagamento não estar pronto — declarar o escopo é
  maturidade de produto, não falha.

## ESTRUTURA EXIGIDA DO ROTEIRO

Seis blocos, somando exatamente 3:00. Para cada bloco, produza uma tabela em
Markdown com estas quatro colunas:

| TEMPO | TELA (o que a câmera mostra) | NARRAÇÃO (o que se fala) | NOTA (por que esse momento está ali) |

Distribuição sugerida dos blocos (ajuste a ordem interna se fizer mais
sentido, mas cubra os seis temas):
1. Abertura com o problema de negócio (~15–20s)
2. Revelação do produto — o que é o ChargeGrid Hub (~25–30s)
3. Demonstração ao vivo do Controle de Demanda (~30–35s) — o bloco mais
   técnico permitido, mas ainda sem explicar o mecanismo em voz alta
4. A inteligência por trás do preço dinâmico (~25–30s)
5. Modelo de negócio e base regulatória (~25–30s)
6. Escopo honesto + fechamento com a frase do briefing (~35–40s)

## RESTRIÇÕES

- Narração total: aproximadamente 400 a 450 palavras (ritmo de ~150–160
  palavras/minuto, mais rápido que leitura de relatório).
- Idioma: português do Brasil.
- Não citar nome de função, arquivo ou classe do código.
- Não inventar números, prazos, ou afirmações de mercado além do que está
  listado nas seções CONTEXTO DO DESAFIO e O PRODUTO acima.
- Ao final, liste separadamente (fora da tabela) quaisquer frases marcadas
  como "[inferência]" para revisão.

## FORMATO DE SAÍDA

Markdown: uma tabela por bloco (com o tempo de início de cada uma no
título da seção), seguida de um resumo com a soma total de tempo e de
palavras.
```
