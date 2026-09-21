# Prompt para o ChatGPT gerar o Relatório de Pitch — ChargeGrid Hub

Copie e cole o bloco abaixo inteiro no ChatGPT. Ele já contém todo o contexto do
projeto (o ChatGPT não tem acesso a esta pasta nem ao briefing da GoodWe), os
números verificados do sistema, e as regras de tom que corrigimos no roteiro do
vídeo — para o relatório escrito não cair no mesmo erro de soar técnico demais.

---

```
Você vai escrever um RELATÓRIO DE PITCH escrito — não um roteiro de vídeo, não
um relatório técnico de engenharia — para o projeto "ChargeGrid Hub", submetido
ao desafio EV Challenge 2026 (GoodWe + FIAP), trilha "ChargeGrid Intelligence".
Este relatório acompanha um vídeo pitch de 3 minutos e será lido por
avaliadores da GoodWe que decidem quais projetos avançam de fase.

## REGRA DE TOM MAIS IMPORTANTE

Isto é um documento de VENDA de produto, não de explicação de mecanismo. Já
cometemos esse erro uma vez no roteiro do vídeo e fomos corrigidos por isso —
não repita. Cada seção lidera com o problema de negócio e o benefício
entregue, em linguagem que qualquer pessoa não-técnica entenda. Termos
técnicos (Modbus, OCPP, IA, algoritmo, CRC16, registrador) podem aparecer, mas
NUNCA como explicação de como o mecanismo funciona por dentro — só como prova
rápida, dita uma vez, de que a solução é real. Regra prática: se uma frase só
faz sentido pra quem programa, reescreva-a em benefício de negócio ou corte-a.
Evite também o tom de relatório acadêmico (linguagem passiva, "o presente
trabalho tem como objetivo...", bullets genéricos) — escreva como quem
apresenta um produto pronto para uma empresa que vai decidir investir nele.

## CONTEXTO DO DESAFIO (não invente nada além disto)

- Desafio: "EV Challenge 2026", parceria FIAP + GoodWe. Frase de abertura do
  briefing oficial: "A mobilidade elétrica do futuro não depende apenas da
  capacidade das baterias ou da espessura dos cabos. Depende do código que
  orquestra e distribui essa energia."
- O briefing declara: "o código é apenas o veículo; a avaliação foca no
  raciocínio arquitetônico, de negócios e de gestão de dados." Os quatro
  entregáveis exigidos são: (1) Arquitetura Funcional — lógica clara de
  entradas e saídas de dados; (2) Papel da IA Integrada — IA como motor
  lógico da solução, não penduricalho de interface; (3) Aderência ao
  Contexto — solução sob medida para o ambiente comercial, usando o
  ecossistema GoodWe/FIAP; (4) Visão de Produto Real — para quem serve, que
  problema resolve hoje.
- O problema central definido pelo próprio briefing: "a ausência de
  mecanismos integrados em eletropostos comerciais para orquestrar potência,
  registrar ciclos, faturar e comunicar."
- Existem duas trilhas no desafio: "ChargeGrid Intelligence" (comercial,
  operação em tempo real — a nossa) e "EV ChargeOps" (condomínios, gestão
  compartilhada — NÃO é a nossa, não confundir).

## O PRODUTO (fatos verificados — use exatamente estes números e afirmações,
## não invente outros)

ChargeGrid Hub NÃO é um carregador. É um tótem que se acopla a um carregador
GoodWe HCA G2 já instalado, sem modificá-lo: lê os dados do carregador via
Modbus RTU e traduz para OCPP 1.6J, o protocolo aberto do setor — permitindo
que um carregador que só fala Modbus se conecte a qualquer plataforma de
gestão do mercado.

Problema de negócio concreto que resolve: um estabelecimento comercial tem uma
demanda contratada com a concessionária (exemplo real usado na demonstração:
75 kW). Poucos carros carregando ao mesmo tempo já pedem mais que isso. O
Pilar 1 do briefing oficial da GoodWe ("Controle de Demanda") define o
impacto esperado como "redução de custos de infraestrutura e otimização da
rede elétrica" — o ChargeGrid entrega isso via software, dentro do
carregador que já existe, sem exigir nenhuma mudança física na instalação
elétrica.

[NOTA — NÃO É FATO DO BRIEFING: o briefing não detalha qual é o custo de
infraestrutura evitado. Se quiser dramatizar isso no relatório (ex.: "evita
obra de aumento de carga"), isso é uma inferência plausível, não uma citação
— avise o ChatGPT que é interpretação sua, ou remova a dramatização e fique
só com a frase citada acima.]

Como funciona, em três capacidades:

1. Controle Dinâmico de Demanda — o sistema acompanha o consumo do prédio e
   projeta como a próxima janela de faturamento (15 minutos, que é como a
   concessionária realmente mede) vai fechar. Antes de estourar o contrato,
   ele reduz sozinho a corrente entregue a cada carregador. Comportamento real
   observado na simulação: corte de 32A para 18A (moderado) ou até 16A com
   suspensão de uma sessão (severo) — o mesmo exemplo citado no relatório
   técnico da Sprint 1 do próprio time. Existe um piso de segurança: abaixo de
   6A (norma IEC 61851) o sistema não reduz mais, suspende a sessão de menor
   prioridade e retoma sozinho quando sobra espaço.

2. Tarifação Dinâmica (Smart Pricing) — o preço do kWh cobrado do motorista
   muda em tempo real a partir de três variáveis, exatamente como descrito no
   briefing oficial da GoodWe: ocupação do eletroposto, horário (tarifa
   branca da ANEEL: fora-ponta / intermediário / ponta) e excedente de
   geração solar do próprio inversor híbrido GoodWe do estabelecimento.
   Faixa de preço real observada: R$ 0,96/kWh ao meio-dia com excedente
   solar e baixa ocupação, até R$ 3,08/kWh no horário de ponta com o
   eletroposto lotado — mais de 3x de variação, tudo justificado por
   condições reais, não uma tarifa fixa.

3. Tradução de Protocolo — o sistema lê tensão, corrente, potência, energia e
   temperatura do carregador via Modbus, e emite mensagens OCPP 1.6J reais
   (BootNotification, Authorize, StartTransaction, MeterValues,
   StatusNotification, SetChargingProfile, StopTransaction), provando que a
   interoperabilidade entre hardware GoodWe e qualquer nuvem de gestão é
   viável.

O sistema simula múltiplos veículos carregando ao mesmo tempo em pontos
diferentes, cada um com curva de carga realista baseada em veículos reais do
mercado brasileiro (BYD, GWM, Volvo, Tesla, Chevrolet), respeitando o limite
de potência de cada carro — é essa concorrência real entre veículos que dá ao
controle de demanda algo de fato para gerenciar.

Existem duas interfaces, ambas conectadas ao mesmo motor de simulação ao vivo
(não são maquetes separadas): um totem para o motorista (seleção de estação,
seleção de veículo, monitoramento ao vivo com o aviso de controle de demanda
e um painel técnico com o tráfego Modbus/OCPP real) e um painel administrativo
para o operador (visão de energia multi-ponto, composição do preço em tempo
real, log de protocolo).

## BASE REGULATÓRIA E MODELO DE NEGÓCIO (use para a seção de negócio)

A Resolução Normativa 1.000/2021 da ANEEL libera a recarga comercial para
praticar preço livremente negociado — é a base legal que sustenta a
tarifação dinâmica como modelo de negócio, não só como recurso técnico. A
mesma norma exige comunicação prévia e protocolos abertos para controle
remoto de equipamentos não exclusivos para uso privado — é a justificativa
regulatória para a arquitetura Modbus/OCPP. Argumento de negócio, apoiado na
própria missão declarada no briefing ("transformar cada sessão de recarga em
dados estruturados e inteligência acionável"): o operador deixa de vender só
quilowatt-hora e passa a vender inteligência sobre a energia.

## O QUE ESTÁ DECLARADAMENTE FORA DO ESCOPO (mencione com honestidade
## estratégica, nunca como desculpa)

A integração de pagamento com API bancária ainda não existe — o totem mostra
uma tela avisando isso claramente, em vez de simular um QR Code Pix ou
maquininha de cartão falsos. Isso deve ser apresentado como maturidade de
produto (saber o que ainda não está pronto), não como falha. Também fora do
escopo desta entrega, por pertencerem a outras disciplinas do curso: leitor
RFID/NFC, chatbot conversacional (ChargeGrid Assistant), circuito de
priorização em Arduino, e análise estatística em Pandas.

## ESTRUTURA EXIGIDA DO RELATÓRIO

1. O Problema — a dor real de negócio (demanda contratada estourando, custo
   de infraestrutura), não uma introdução genérica sobre "o crescimento dos
   veículos elétricos".
2. A Solução — o que é o ChargeGrid Hub, em uma ou duas frases que um
   executivo não-técnico entenderia sem re-ler.
3. Como Funciona — as três capacidades (controle de demanda, tarifação
   dinâmica, tradução de protocolo), cada uma amarrada ao benefício que
   entrega, com os números reais como prova.
4. O Papel da Inteligência Artificial — por que a IA é o motor de decisão
   (não uma interface bonita por cima), citando interpretação, previsão e
   precificação como capacidades, sem entrar em como o algoritmo é
   implementado.
5. Modelo de Negócio e Base Regulatória — a redução de custo de
   infraestrutura, a nova fonte de receita, a base legal na ANEEL.
6. Prova em Números — uma tabela ou lista curta com os números centrais
   (demanda contratada, corte de corrente, faixa de preço) como evidência de
   que o sistema roda de verdade, não é conceito.
7. Escopo e Maturidade — o que está pronto, o que é declaradamente próxima
   etapa, com a honestidade estratégica descrita acima.
8. Fechamento — feche retomando a frase de abertura do briefing da GoodWe
   como resposta, não como citação decorativa.

## RESTRIÇÕES

- Extensão: 800 a 1000 palavras (aproximadamente 2 páginas A4).
- Idioma: português do Brasil.
- Não inventar funcionalidades, números ou citações regulatórias além das
  listadas acima.
- Não usar formatação de relatório acadêmico (sem "resumo", "objetivo geral",
  "metodologia" como seções — isto é pitch, não TCC).
- Título do documento: algo como "ChargeGrid Hub — Relatório de Pitch" (pode
  sugerir variações).

## FORMATO DE SAÍDA

Markdown com títulos (##) para cada seção da estrutura acima, pronto para
colar em um editor e exportar para PDF ou Word.
```
