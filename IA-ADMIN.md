# Assistente de Operação com Ollama

Abra **Assistente de Operação**, escolha o período e clique em **Gerar relatório**.
O servidor calcula os indicadores e produz uma análise factual: uso, energia e
valor médio por recarga, conclusão da meta, pausas e estado atual. Não há
recomendações automáticas, diagnósticos de falha ou decisões de investimento.
**Baixar PDF** exporta a mesma análise e os dados utilizados, com suas fontes.

O Ollama recebe os indicadores agregados e organiza a ordem dos dados em três
grupos: operações do período, retrato atual e importação GoodWe. Ele devolve
somente identificadores. Valores, datas, fontes e análise permanecem sob controle
do servidor. A IA não busca medições externas nem gera o arquivo PDF diretamente.

## Configuração

O Ollama roda no mesmo computador do backend. Não exige conta ou chave de API.
Instale pelo [site oficial](https://ollama.com/download/windows) e baixe o modelo:

```powershell
ollama pull qwen2.5:3b
```

O download inicial ocupa aproximadamente 1,9 GB. Depois, as análises locais
funcionam sem internet. A velocidade depende do computador.
Os padrões abaixo funcionam sem alterar `server/.env`:

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

Para iniciar somente com recursos locais, feche o aplicativo Ollama e execute:

```powershell
$env:OLLAMA_NO_CLOUD = '1'
ollama serve
```

Se houver runtime portátil em `server/storage/ollama/runtime`, o comando
`powershell -File server/start-ollama.ps1` o inicia com nuvem desativada e modelos
armazenados em `server/storage/ollama/models`. Também encontra uma instalação
normal. Baixe o modelo em outro terminal usando o executável indicado.

Reinicie o backend após alterar configurações. `AI_PROVIDER=rules` desativa a IA.
`OPENAI_API_KEY` e `OPENAI_MODEL` são ignorados: não há fallback para API paga.

## Tablet

Mantenha o computador com backend e Ollama ligados. No tablet conectado à mesma
rede, abra `http://IP-DO-COMPUTADOR:3001/admin.html`. O computador executa a IA e
retorna o relatório. Não instale Ollama no tablet nem exponha sua porta na rede.
O firewall deve permitir a porta do painel na rede privada.

## Dados e limites

- Sessões encerradas são filtradas pelo calendário de São Paulo. Duplicatas e
  sessões ambiente são excluídas.
- Energia, bateria, pausas e custo do totem são simulados. Valor calculado não
  representa faturamento recebido nem lucro.
- SEMS+ é importação separada, filtrada pela data exibida no portal. Não é
  telemetria ao vivo e não é somada às estimativas do totem.
- Potência, ocupação e geração atuais são um retrato do simulador, não uma
  média histórica. Faltam fila, demanda não atendida, causa de interrupção e
  custos operacionais para fundamentar decisões de expansão.

A saída estruturada da IA deve conter cada indicador exatamente uma vez no grupo
correto. O servidor rejeita indicadores desconhecidos, omissões, duplicatas,
campos de texto livre e mistura entre dados históricos, atuais e SEMS+.
A integração aceita apenas o Ollama local e rejeita modelos de nuvem.

Sem Ollama, modelo instalado ou organização válida, a mesma análise factual fica
disponível com a ordem padrão, identificada como **sem IA**. A disponibilidade da
IA afeta a organização dos dados, não os cálculos ou as conclusões.

`GET /api/reports/status` informa conexão e disponibilidade do modelo.
`POST /api/reports/generate` aceita `{ "period": "today" | "week" | "month" }`.
Uma geração por vez e timeout de um minuto. A organização da IA é reutilizada
por um minuto; os indicadores e o identificador do PDF são atualizados em cada geração.
Falhas não ficam em cache: a próxima tentativa pode funcionar após ligar Ollama.
O relatório não altera carregadores ou tarifas.

`GET /api/reports/:id/pdf` baixa o relatório já gerado, sem outra chamada à IA.
O documento fica disponível por até trinta minutos, enquanto o backend permanecer
ligado; são mantidos os cinquenta relatórios mais recentes. Após a expiração ou
reiniciar o backend, gere um novo relatório para baixar.

Testes: `node --test server/test/*.test.js`. Testes automatizados usam respostas
controladas; inferência real exige modelo instalado.

Referências: [chat](https://docs.ollama.com/api/chat),
[saída estruturada](https://docs.ollama.com/capabilities/structured-outputs),
[modo sem nuvem](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features),
[Qwen](https://ollama.com/library/qwen2.5:3b).
