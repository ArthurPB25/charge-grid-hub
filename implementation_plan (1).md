# ⚡ Plano de Implementação — Sprint 2: Prova de Conceito

Este plano detalha o cronograma, a organização e as etapas técnicas para consolidar a Prova de Conceito (PoC) do ChargeGrid Hub na Sprint 2.

---

## 1. Organização e Gerenciamento (PCP)

1. **Quadro Kanban:** Criar imediatamente um Trello ou GitHub Projects público para rastrear as tarefas. **Nenhuma tarefa deve ser iniciada sem estar no quadro**.
2. **Arquitetura do Repositório:** Padronizar o repositório GitHub para a Sprint 2, separando as entregas de cada disciplina em pastas específicas.
3. **Documentação (README):** O integrante de PCP/SERS deve iniciar a escrita do README principal da PoC, abordando a viabilidade técnica e a sustentabilidade.

## 2. Implementação Técnica e Algoritmos

1. **Circuito de Prioridade (COA & CS):**
   * **Hardware Simulado:** Montar o circuito com 4 botões e 1 LED no Tinkercad.
   * **Regras de Negócio:** Mapear rigorosamente a tabela verdade para a regra "S = Carga Autorizada".
   * **Firmware:** Codificar o controle digital no Arduino (C++) via Tinkercad e criar a versão simulada em Python via terminal.
2. **Gerenciador de Múltiplas Sessões (DSA):**
   * Implementar o motor de simulação (Python/JS) que consiga rodar 3+ carregamentos simultâneos.
   * Embutir a lógica de Tarifação Dinâmica baseada em demanda/horário.
   * Criar *logs* simulando trocas de mensagens OCPP/MODBUS.

## 3. Inteligência e Análise de Dados

1. **Chatbot Operacional (PAI):**
   * Transferir o *System Prompt* da Sprint 1 para um código real (Google Colab ou script Python).
   * Implementar memória (histórico) na conversa utilizando LangChain ou a API nativa do LLM (Gemini/OpenAI).
   * Validar o chatbot contra os 5 cenários de teste documentados.
2. **Estatística e Insights (MLPAM):**
   * Importar a base de dados via Pandas.
   * Gerar os 4 tipos de gráficos exigidos (Setores, Barras, Histograma, Boxplot).
   * Compilar os cálculos estatísticos e gerar um PDF de *Insights* para a diretoria da GoodWe.

## 4. Integração e Validação

1. **Integração Conceitual:** Garantir que o Chatbot consiga responder perguntas sobre o cenário de múltiplas sessões do DSA, e que as métricas do MLPAM justifiquem a implementação do circuito do COA.
2. **Gravação dos Vídeos:**
   * Gravar o pitch principal e justificar sustentabilidade (PCP/SERS - 5 min).
   * Gravar a demonstração técnica do circuito (COA - 5 min).
   * Gravar o uso do Chatbot (PAI - 3 min).

## 5. Cronograma Sugerido

| Semana | Atividades Principais |
|---|---|
| **Semana 1** | Configurar Kanban. Montar base do circuito Tinkercad. Definir dataset e gerar gráficos base (MLPAM). Estruturar classes/funções do gerenciador DSA. |
| **Semana 2** | Extrair Tabela Verdade (COA). Simular Arduino em C++ (CS). Integrar histórico no LLM (PAI). Implementar simulador de MODBUS e tarifação dinâmica (DSA). |
| **Semana 3** | Redigir relatórios técnicos (MLPAM, MMC). Testar códigos. Refinar README principal (PCP/SERS). |
| **Semana 4** | Gravar todos os vídeos. Revisão final dos links (verificar acesso público do Kanban e YouTube). Empacotamento para envio ao Portal. |
