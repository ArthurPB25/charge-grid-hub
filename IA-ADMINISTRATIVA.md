# Assistente administrativo

O painel **Assistente de Operação** apresenta indicadores, gráficos e próximos passos para o dono do estabelecimento. Energia, bateria e pausas do totem ainda são simuladas; a importação GoodWe/SEMS+ fica separada. Valores calculados não são receita conciliada com os provedores de pagamento.

## Funcionamento

- **Gerar relatório** calcula os indicadores, os três gráficos e as dicas sem consultar o Ollama Cloud.
- **Priorizar dicas com IA** exige o código administrativo e consulta o modelo somente quando não existe uma análise recente dos mesmos dados históricos. A IA escolhe até três dicas fundamentadas e o gráfico inicial. As demais visualizações continuam acessíveis.
- Cada dica apresenta evidência, uma ação possível e o que ainda precisa ser verificado. A IA só pode selecionar dicas válidas do catálogo do servidor: não pode inventar números, causas, lucro ou recomendações de investimento.
- A análise em cache vale por 60 minutos por padrão. Novos registros históricos mudam a assinatura; mudanças momentâneas de potência/solar não provocam uma nova chamada. Cálculos e evidências são atualizados em todo relatório.
- Abrir o painel, consultar o estado, trocar o gráfico e baixar o PDF não fazem inferência. O PDF usa o relatório já gerado.
- A IA não controla preços, pagamentos, conexão do veículo, energia, ESP ou MQTT.

## Consumo e falhas

O padrão permite **5 tentativas novas por dia**, no fuso de São Paulo, com uma chamada de cada vez, resposta curta (até 180 tokens de saída) e tempo máximo de 12 segundos. Não há repetição automática. Falhas e timeouts contam como tentativa; erros geram pausa de 5 minutos e resposta 429 do provedor gera pausa de 1 hora. A análise por regras permanece disponível.

O contador do aplicativo **não é o saldo da conta Ollama** e não mede uso de outros aplicativos. O plano gratuito e os modelos disponíveis dependem do provedor. O sistema não compra créditos nem ativa recarga automática.

O contador é salvo antes da requisição em `server/storage/ai-usage.json`, ou no caminho definido em `AI_USAGE_FILE`. Um arquivo inválido ou erro de gravação bloqueia novas chamadas. Em hospedagem sem disco persistente, como Render Free, reinícios e deploys podem apagar esse arquivo. Portanto o limite é uma proteção da instância, não uma garantia de limite mensal da conta. Para um limite durável entre deploys e múltiplas instâncias, usar armazenamento compartilhado persistente. O cache de análises é mantido em memória.

## Configuração

Configure no ambiente do backend, sem colocar chaves no Git ou no navegador:

```dotenv
AI_PROVIDER=ollama-cloud
OLLAMA_API_KEY=<chave da conta Ollama>
OLLAMA_CLOUD_MODEL=gemma4:31b
AI_ADMIN_KEY=<código aleatório exclusivo com ao menos 16 caracteres>
AI_DAILY_CALL_LIMIT=5
AI_CACHE_MINUTES=60
```

O código administrativo é independente da chave Ollama. Ele autoriza apenas o botão de IA; não substitui uma autenticação completa do painel. O frontend mantém o código somente na memória da página. Não distribua esse código aos clientes do totem.

Use `AI_PROVIDER=rules` para desativar todas as chamadas a modelos. A alternativa local `AI_PROVIDER=ollama` mantém compatibilidade com instalações anteriores e requer Ollama no computador do backend; não é a configuração indicada para o Render.

Ao modelo são enviados apenas período, totais agregados, energia diária, contagem por horário e bases das dicas. Não são enviados e-mails, identificadores de pedidos, dados de cartão, NSU, tokens de pagamento ou os registros brutos. O destino é fixo: `https://ollama.com/api/chat`, com redirecionamentos bloqueados. A resposta deve ser JSON com IDs autorizados e um gráfico conhecido; saídas inválidas são descartadas. Como a API Cloud ainda não oferece saída estruturada, não é usado o parâmetro `format` do Ollama local.

## Validação

Os testes de `server/test/cloud-advisor.test.js` usam provedor simulado: não gastam a franquia. Cobrem autorização, agregação, privacidade, cache, concorrência, limites persistidos, erros, respostas inválidas e continuidade dos relatórios/PDF. A configuração pronta no servidor não comprova acesso do modelo à conta; a primeira análise solicitada pelo dono valida a chamada real.

Referências oficiais: [Ollama Cloud](https://docs.ollama.com/cloud), [Chat API](https://docs.ollama.com/api/chat), [saída estruturada](https://docs.ollama.com/capabilities/structured-outputs), [planos](https://ollama.com/pricing).
