# Preço comercial de referência — consulta em 21/10/2026

Adotado **R$ 2,00/kWh como base para recarga AC**. É preço de serviço de recarga,
não custo da distribuidora nem média nacional comprovada.

- Fonte primária: Volvo Brasil, comunicado de 02/06/2026, informa R$2,00/kWh AC
  a partir de 15/06/2026: https://www.volvocars.com/br/media/press-releases/BC28C2E96CE1476C/
- Referência complementar: levantamento FLAK em setembro de 2026 apresenta
  mediana R$1,99/kWh em 114 estações AC de 7–22 kW em São Paulo:
  https://flakenergy.com.br/guias/preco-da-recarga-de-carro-eletrico-em-sp
  Mediana não é média aritmética e a amostra não representa todo o Brasil.

Os fatores de horário são **política do projeto**, não médias de mercado:
fora-ponta R$2,00, intermediário (+5%) R$2,10, ponta (+12%) R$2,24/kWh.
Mantêm-se as faixas existentes: dias úteis 18–21h ponta, 17–18h e 21–22h
intermediário, demais horários fora-ponta (São Paulo). Não são horários
validados para um contrato específico de distribuidora.

Cada carro ativo adicional acrescenta 5% do preço-base (R$0,10/kWh), uma regra
comercial escolhida pelo usuário, sem relação com uma média de mercado. A mudança
ocorre somente no início de uma recarga. Fora de ponta: 1carroR$2,00;2carrosR$2,10;
3carrosR$2,20;4carrosR$2,30. O patamar não diminui enquanto houver sessões no local:
saídas e oscilações elétricas não o reduzem. Repor uma vaga mantém o patamar já
atingido se a ocupação não exigir um valor maior. Só volta à base da faixa quando
todas as sessões forem encerradas e liberadas, inclusive o resumo do totem.
Mudanças de faixa horária só podem elevar o patamar numa nova entrada; não mudam
o preço no meio de uma recarga. Solar e escassez só afetam a potência.

O preço fica registrado na
criação do pedido de pagamento, antes de pagar, e é preservado na sessão.
Novas sessões de demonstração sem pedido usam o preço no início.
O painel mostra a referência e a política de horário, sem apresentar impostos
e margens fictícios como justificativa desses preços comerciais.

Pix e InfiniteTap usam o valor fixo de R$1,00 na apresentação; Pix está em sandbox
no Render e InfiniteTap pode cobrar de verdade. O custo de energia estimado é
separado. Solar, demanda contratada e consumo do prédio seguem
simulados; esta alteração não substitui esses parâmetros por medições reais.
