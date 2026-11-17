# RFC: Proposta de Projeto — Grupo 1

| Campo | Valor |
|---|---|
| **Título** | NodeWatch — Painel do Analista para Prevenção à Lavagem de Dinheiro (AML): pontuação por Machine Learning (escala 0–1000, alerta a partir de 701) com motivos verificáveis e análise temporal de subgrafos egocêntricos sob demanda |
| **Trilha** | Extensão de sistema existente — camada de Machine Learning tabular/comportamental + investigação em grafo com ordem temporal sobre o IBM Transactions for AML (`HI-Small`) |
| **Equipe** | Grupo 1 |
| **Autores** | Guilherme Lombardi, Ryan dos Santos Veloso, Caio Winkler Marangoni, Guilherme Liborio Camargo |
| **Status** | Congelado — especificação-base do projeto (v1.0) |
| **Data** | 15/11/2026 |
| **Sprint de referência** | 1 (especificação-base; revista em 15/11/2026 para refletir o código atual) |

> Este RFC formaliza o **NodeWatch**, um painel local de triagem assistida para Prevenção à Lavagem de Dinheiro (AML). O sistema pontua cada transação com um modelo de Machine Learning já treinado e distribuído (`modelos/modelo_unificado.joblib`), converte o score para um índice inteiro de 0 a 1000 com faixas de prioridade, anexa **motivos verificáveis** por regras fixas e, sob demanda, monta o **subgrafo egocêntrico** da conta em foco com validação de **ordem temporal**. O NodeWatch **não bloqueia, não aprova e não paga nada**: não há integração bancária, e score alto é sinal para investigação, não prova de lavagem.
>
> Repositórios: pesquisa em `https://github.com/Guilherme-Lombardi/AnaliseComplexidade_DeteccaoFraudes`; sistema em `https://github.com/NodeWatch-Team/NodeWatch` (site: `https://nodewatch-team.github.io/NodeWatch/`).

---

## 1. Resumo (TL;DR)

O NodeWatch lê um arquivo de transações no formato IBM AML `HI-Small` (`hismall_v1`), valida cada linha (recusando explicitamente as inválidas), pontua as transações em blocos com um Random Forest de 49 atributos *point-in-time* (sem retreino na interface), grava tudo em SQLite e apresenta ao analista uma fila priorizada (0–300 baixa, 301–700 intermediária, 701–1000 alta com `⚠`). Para a conta que o analista investiga, o sistema monta um subgrafo egocêntrico limitado (até 3 saltos, 30 contas e 60 arestas desenhadas), agrupado por `(origem, destino, moeda)` e classificado por ordem temporal (`direta`, `sequencia`, `simultanea`, `sem_ordem`). O projeto mede a qualidade do modelo com Precisão, Recall, F1 e Average Precision (sem Acurácia) e o desempenho operacional por bloco (atributos, inferência, gravação, vazão, RAM, CPU e latência da API).

---

## 2. Contexto e motivação

Lavagem de dinheiro é um evento raro (0,11% das transações no conjunto de teste do `HI-Small`) e estrutural: os padrões conhecidos (FAN-IN, FAN-OUT, CYCLE, STACK, SCATTER-GATHER, GATHER-SCATTER, BIPARTITE, RANDOM) aparecem como cadeias de transações entre contas ao longo do tempo. O analista precisa de duas coisas: **saber por onde começar** (priorização) e **conseguir verificar o caso** (contexto da conta, com a ordem real dos movimentos).

A proposta inicial do grupo (v0.1) previa um Autômato Finito Determinístico (DFA/CEP) como pré-filtro de uma busca global de Componentes Fortemente Conectados (Kosaraju/DFS) sobre todo o grafo de transações. Essa abordagem foi **substituída** pelos seguintes motivos técnicos:

1. **Explosão combinatória.** Enumerar todos os ciclos de um grafo é exponencial no pior caso (`src/algoritmos/cycle_detection.py`), e recalcular SCCs sobre o histórico inteiro custaria O(V+E) a cada minuto processado. Com 5.078.345 transações no `HI-Small`, isso é incompatível com um painel que pontua minuto a minuto.
2. **Falsas cadeias temporais.** Kosaraju e DFS ignoram o tempo: juntam arestas de horários quaisquer e "fecham ciclos" com transações que aconteceram *antes* do dinheiro chegar. Uma cadeia de lavagem só é plausível se cada etapa ocorre depois da anterior. O subgrafo egocêntrico do NodeWatch só marca uma aresta indireta como `sequencia` quando há transação em minuto posterior à chegada; o mesmo minuto fica como `simultanea` (ordem não confirmada) e o resto como `sem_ordem` (tracejado).
3. **Ganho medido nulo.** O experimento `scripts/experimento_atributos_grafo.py` (49 atributos contra 49 + 3 de grafo: reciprocidade, profundidade de cadeia e fechamento de ciclo) deu AP de teste 0,4657 → 0,4691 (+0,003) com queda de precisão de 2,5 p.p. Levar Kosaraju, DFS e centralidade para o painel também foi implementado, medido e descartado: nas 60 contas analisadas, a estrutura não apontou nenhuma lavagem que o modelo tivesse deixado passar (`docs/DECISAO_GRAFOS_ML.md`, seções 3 e 5).
4. **Linguagem regular insuficiente.** Um DFA reconhece padrões de sequência com memória finita, mas não conta contrapartes distintas, não compara valores com o histórico da conta e não lida com várias moedas. Esses sinais são justamente os que o modelo usa.

A arquitetura atual combina, portanto, **ML tabular/comportamental** (barato, *point-in-time*, avaliado em métricas de classe rara) para priorizar, e **subgrafo egocêntrico com ordenação temporal, gerado sob demanda e com tetos fixos** para investigar. Os algoritmos clássicos de grafo (DFS, Kosaraju, centralidade, fan-in/fan-out) continuam implementados e testados em `src/algoritmos/`, disponíveis na linha de comando e na interface antiga (`/legado`), mas **não entram no score nem no painel**.

---

## 3. Problema formal e pergunta de pesquisa

| Pergunta | Resposta |
|---|---|
| Pergunta de pesquisa | Em que medida um modelo de ML tabular com atributos comportamentais *point-in-time*, combinado com um subgrafo egocêntrico temporalmente ordenado e gerado sob demanda, prioriza transações de lavagem para o analista (medido por Precisão, Recall, F1 e Average Precision) com custo operacional por bloco compatível com uma estação local? |
| Objeto de decisão (substitui a "linguagem regular reconhecida") | Cada transação do arquivo enviado: o sistema decide se ela **passa o limiar de alerta** do modelo (`score_bruto >= θ_bruto`, equivalente a `score >= 701`) e em que faixa de prioridade fica |
| Entrada do modelo (substitui o "alfabeto Σ") | 49 atributos por transação, calculados só com minutos estritamente anteriores: 27 comportamentais (valor em USD, envios e recebimentos da origem e do destino em 6/24/72 h, par origem→destino novo, contrapartes distintas, `z` do valor, minutos desde o último movimento, indicadores de sem histórico), 7 de formato de pagamento (one-hot) e 15 de moeda de pagamento (one-hot). Rótulo (`Is Laundering`) e tipologias (`HI-Small_Patterns.txt`) **nunca** são atributos |
| Decisão do sistema (substitui "aceitar/rejeitar do autômato") | Score bruto em `[0, 1]` (não calibrado) → índice inteiro 0–1000 por mapeamento linear por partes ancorado no limiar (`0 → 0`, `θ_bruto⁻ → 700`, `θ_bruto → 701`, `1 → 1000`). Alerta (`⚠`) somente na faixa alta; motivos verificáveis anexados às transações em alerta. Nenhuma transação é bloqueada |

O limiar do modelo distribuído é `θ_bruto = 0,09098` (maior F1 na validação temporal; versão `lavagem-20261102T083253Z`, `modelos/MANIFESTO_MODELO.json`). Scores de versões com limiares diferentes não são comparáveis; o limiar e a versão ficam gravados no manifesto de cada análise.

---

## 4. Escopo

| Pergunta | Resposta |
|---|---|
| Dentro do escopo | Validação e ingestão do formato `hismall_v1` com recusa explícita de linhas inválidas; pontuação em blocos com o modelo salvo; conversão para a escala 0–1000 e faixas; motivos verificáveis por regras fixas; persistência em SQLite; painel React com fila priorizada, detalhes da transação, contas com mais alertas e grafo da conta em foco; subgrafo egocêntrico com ordem temporal; tipologias opcionais (`HI-Small_Patterns.txt`) só para exibição e avaliação; métricas de classificação e de desempenho operacional; Assistente de Dúvidas (Sentinel AI) em modo local ou conectado |
| Fora de escopo | Bloqueio, aprovação ou pagamento de transações (sem integração bancária); retreino do modelo pela interface; uso do rótulo ou das tipologias como atributo; busca global de ciclos ou SCCs sobre o histórico inteiro; uso de DFS/Kosaraju/centralidade no score; operação em produção ou exposição em rede (o servidor é local); fusão com a telemetria de rede (`dataset_final.csv`), que é um modelo independente sem vínculo com as transações |

> O modelo de ML já está treinado e versionado — o produto do grupo é o pipeline de triagem (dados → score → faixas → motivos → grafo temporal) e a evidência de que ele prioriza bem com custo operacional aceitável.

### 4.1 Requisitos funcionais

| ID | Requisito | Onde está no código |
|---|---|---|
| RF01 | Receber CSV ou ZIP no formato `hismall_v1` (até 256 MB enviados, 2 GB descompactados) e, opcionalmente, o arquivo de padrões (até 32 MB) | `src/painel/datasets.py` |
| RF02 | Validar linha a linha e informar `lidas`, `validas` e `recusadas`, com o motivo de cada recusa; o dataset fica `valido`, `valido_com_recusas` ou `invalido` | `src/painel/datasets.py` |
| RF03 | Pontuar em blocos de 20.000 transações (o bloco termina na virada do minuto), com atributos incrementais e inferência pelo modelo salvo | `src/painel/pipeline.py` (`BLOCO`), `src/ml/incremental.py`, `src/ml/previsao.py` |
| RF04 | Converter o score bruto para 0–1000 e classificar em `baixa`, `intermediaria` ou `alta` | `src/painel/score.py` |
| RF05 | Anexar motivos verificáveis às transações em alerta | `src/ml/preparacao.py` (`motivos`), `src/ml/previsao.py` (`pontuar_lavagem`) |
| RF06 | Gravar transações, score, score bruto, alerta, motivos e `historico_incompleto` em SQLite, com filtros e paginação | `src/painel/armazenamento.py` |
| RF07 | Montar, sob demanda, o subgrafo egocêntrico da conta em foco com ordem temporal | `src/painel/armazenamento.py` (`grafo`), rota `GET /api/painel/analises/<aid>/grafo`, `interface/assets/painel-grafo.js` |
| RF08 | Mostrar tipologias registradas (quando o arquivo de padrões existir) sem deduzi-las da forma do grafo | `src/painel/tipologias.py`, `painel-grafo.js` |
| RF09 | Expor desempenho operacional e logs da análise | `GET /api/painel/operacao/desempenho`, `/operacao/logs`, `/operacao/metricas` |
| RF10 | Responder dúvidas do analista com o Sentinel AI (modo local sem chave; modo conectado com Gemini ou Anthropic, mediante autorização na tela) | `src/sentinel_ia.py`, `src/painel/assistente.py`, `POST /api/painel/assistente` |
| RF11 | Manter a sessão da interface viva por heartbeat e encerrar análises órfãs | `POST /api/painel/sessao/pulso`, `src/ml/sessoes.py` |

### 4.2 Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF01 | **Execução local:** servidor Flask em `http://127.0.0.1:5000/` (`src/sentinel_ai.py`); recusa pedidos com `Host` não local e pedidos de outra origem às rotas `/api` (`src/seguranca_local.py`) |
| RNF02 | **Inferência determinística:** o mesmo arquivo e o mesmo modelo produzem os mesmos scores (`testes/ml/test_inferencia_deterministica.py`) |
| RNF03 | **Integridade do modelo:** o artefato é instalado a partir de `modelos/` (ou baixado) e conferido por SHA-256 contra `MANIFESTO_MODELO.json` antes de servir; sem modelo válido, novas análises ficam bloqueadas e o painel mostra o motivo |
| RNF04 | **Rastreabilidade do dado:** o SHA-256 do arquivo analisado, o formato, a versão e o limiar do modelo ficam no manifesto de cada análise |
| RNF05 | **Custo limitado do grafo:** profundidade padrão 2 e máxima 3 saltos, fronteira de 300 contas por salto, no máximo 30 nós e 60 arestas desenhados (`GRAFO_*` em `armazenamento.py`) |
| RNF06 | **Observabilidade:** tempo de atributos, inferência e gravação por bloco, vazão (transações/s), pico de RAM do processo na pontuação, CPU e latência mediana por operação da API |
| RNF07 | **Retenção:** até 20 análises guardadas (`MAX_ANALISES`); cancelamento atendido no próximo ponto seguro entre blocos |

### 4.3 Restrições de integridade

| Restrição | Regra | Evidência |
|---|---|---|
| Isolamento do rótulo | `Is Laundering` é mapeado para `rotulo` e usado só para métricas parciais (VP/FP/FN) e exibição. Nunca entra nos atributos nem no score. O mesmo vale para as tipologias de `HI-Small_Patterns.txt` | `datasets.py` (mapa de colunas), `pipeline.py` (métricas parciais), `ml_config.exemplo.toml` ("nunca atributo") |
| Moedas distintas | Valores **nunca são somados entre moedas** na exibição: a aresta do grafo agrupa por `(origem, destino, moeda)`, e filtros e totais são por moeda. No modelo, os atributos de valor usam conversão para USD por taxa implícita aprendida no treino (`log_valor_usd`, `soma_env_origem_usd_24h`) | `armazenamento.py`, `preparacao.py` |
| Janela de 72 h | Cada análise começa sem histórico anterior ao arquivo. Transações cujas contas têm menos de 72 h observadas são marcadas com `historico_incompleto` (o que tende a baixar o score); dataset com menos de 72 h de cobertura gera aviso | `datasets.py`, `pipeline.py`, `assistente.py` |
| Point-in-time | Cada transação só enxerga minutos estritamente anteriores; o minuto inteiro é pontuado antes de ser incorporado ao estado | `preparacao.py`, `incremental.py` |
| Sem preenchimento silencioso | Linha com campo ausente ou inválido (incluindo rótulo diferente de 0 e 1) é recusada com motivo, nunca corrigida em silêncio | `datasets.py`, `src/ml/analises.py` |
| Sem bloqueio automático | As faixas são recomendações de uma análise offline. Não há integração bancária | `score.py` (`AVISO_FAIXAS`) |

---

## 5. Usuários e decisão apoiada

O **analista de Prevenção à Lavagem de Dinheiro** usa o painel para decidir **quais transações e contas investigar primeiro**. A decisão final (arquivar, escalar, comunicar) é sempre humana e fora do sistema. O NodeWatch apoia essa decisão com:

- a fila ordenada por score (0–1000), com a faixa e o `⚠` nas transações em alerta;
- os motivos verificáveis, que o analista consegue conferir nos dados;
- o grafo da conta em foco, que mostra se o dinheiro seguiu uma sequência temporal plausível;
- o Assistente de Dúvidas (Sentinel AI), que explica telas e indicadores sem afirmar fraude.

---

## 6. Dados e fontes

| Fonte | O que fornece | Papel no projeto |
|---|---|---|
| IBM Transactions for AML — `HI-Small_Trans` (sintético, CDLA-Sharing-1.0; 5.078.345 transações, setembro de 2022) | `data_hora`, `banco_origem`, `conta_origem`, `banco_destino`, `conta_destino`, `valor_pago`, `moeda_pagamento`, `valor_recebido`, `moeda_recebimento`, `formato` e rótulo opcional `Is Laundering`; contas identificadas como `banco-conta` | Treino e avaliação do modelo (divisão temporal); entrada do painel |
| `HI-Small_Patterns.txt` (opcional) | Blocos `BEGIN/END LAUNDERING ATTEMPT` com a tipologia (ex.: `FAN-OUT`) | Avaliação do recall por tipologia e exibição no painel; **nunca** atributo |
| `HI-Small_accounts.csv` (opcional) | Cadastro de contas | Só auditoria |
| `modelos/modelo_unificado.joblib` + `MANIFESTO_MODELO.json` | Modelo distribuído (cabeça `lavagem`: Random Forest, 100 árvores, `min_samples_leaf=50`, `max_samples=0.5`, 49 colunas, treinado até 07/09/2022) e seus hashes | Inferência no painel, sem retreino |

Os arquivos do `HI-Small` ficam fora do repositório (`.gitignore` cobre `dados/HI-Small_*`).

---

## 7. Custo dos erros do modelo

| Tipo de erro | O que significa | Custo/consequência |
|---|---|---|
| Falso negativo (lavagem fica abaixo de 701) | A transação não recebe alerta e pode não ser vista pelo analista | Alto — risco regulatório e reputacional; mitigado pela faixa intermediária (301–700), pelo grafo da conta em foco e pela revisão humana |
| Falso positivo (transação legítima com score ≥ 701) | O analista gasta tempo investigando um caso sem lavagem | Médio — custo operacional de fila; **não** há bloqueio do cliente, porque o sistema não age sobre a transação |

O limiar foi escolhido pelo maior F1 na validação, equilibrando os dois erros. Como o score não é probabilidade calibrada, o corte em 701 é a única âncora validada; as faixas abaixo dele ordenam prioridade, não risco absoluto.

---

## 8. Abordagem proposta (visão de alto nível)

```
arquivo HI-Small (CSV/ZIP) [+ Patterns opcional]
  → validação linha a linha (recusas explícitas, SHA-256 do arquivo)
  → ordenação por minuto
  → pontuação em blocos de 20.000:
       atributos point-in-time (estado incremental por conta)
       → inferência do Random Forest salvo (score bruto 0–1)
       → conversão 0–1000 ancorada no limiar + motivos verificáveis
       → gravação no SQLite
  → índices e manifesto (versão, limiar, hashes, desempenho)
  → Painel React (fila, detalhes, contas com alerta, operação)
  → sob demanda: subgrafo egocêntrico da conta em foco
       (BFS por SQL até 3 saltos, agrupado por origem-destino-moeda,
        tetos de 30 nós / 60 arestas, ordem temporal por aresta)
  → Sentinel AI (modo local ou conectado) para dúvidas
```

**Componentes**

| Camada | Arquivos |
|---|---|
| Servidor e rotas | `src/sentinel_ai.py` (Flask, `/`, `/health`, `/legado`), `src/api_painel.py` (`/api/painel/*`), `src/seguranca_local.py` |
| Pipeline e persistência | `src/painel/pipeline.py`, `src/painel/armazenamento.py` (SQLite), `src/painel/datasets.py`, `src/painel/score.py`, `src/painel/tipologias.py`, `src/painel/sistema.py` |
| ML | `src/ml/preparacao.py`, `src/ml/incremental.py`, `src/ml/previsao.py`, `src/ml/provisionamento.py` |
| Interface | `interface/painel.html`, `interface/assets/painel-app.js`, `painel-base.js`, `painel-grafo.js`, `painel-log.js`, `painel-secoes.js` |
| Assistente | `src/sentinel_ia.py`, `src/painel/assistente.py`, `src/painel/contexto_sentinel.py` |

**Justificativa da combinação.** O ML avalia cada transação com custo constante por conta (estado O(1) ou O(grau)), o que permite processar milhões de linhas em blocos. O grafo só é montado para **uma** conta de cada vez, com tetos fixos, então seu custo não cresce com o tamanho do dataset; e a classificação temporal de cada aresta impede que o desenho sugira cadeias impossíveis no tempo. A disposição do desenho (circular, leque ou camadas) vem **só** da tipologia registrada no arquivo de padrões e nunca é deduzida da forma do grafo.

---

## 9. Riscos e limitações conhecidas

- **Dados sintéticos:** o `HI-Small` é gerado; os resultados não se transferem automaticamente para dados reais.
- **Concentração em ACH:** cerca de 87% da lavagem usa o formato ACH, o que favorece atributos de formato.
- **Positivos sem padrão:** 39% dos positivos do teste (371 de 956) não estão em `Patterns`, e o recall ali é de 1,9%; nenhum atributo de grafo testado resolveu isso.
- **Score não calibrado:** na faixa de 0,1 a 0,2 do score bruto, 65% das transações são lavagem; o índice 0–1000 é ordem de prioridade, não probabilidade.
- **Histórico incompleto:** cada análise começa sem passado anterior ao arquivo; arquivos curtos (< 72 h) geram scores mais baixos.
- **Teto do grafo:** com 30 nós e 60 arestas, contas-hub aparecem recortadas; o desenho é um recorte da investigação, não o grafo completo.
- **Dependência de versões:** o modelo exige scikit-learn igual e numpy/pandas/joblib na mesma versão principal (`politica_compatibilidade`).
- **Assistente conectado:** depende de chave de API e de rede; sem ela, o assistente funciona só no modo local.

---

## 10. Critérios de sucesso (aceite)

- Arquivo `hismall_v1` validado com contagem de linhas lidas, válidas e recusadas, e motivo de cada recusa.
- Pontuação em blocos concluída com o modelo salvo, sem retreino, e com resultado determinístico.
- Escala 0–1000 monótona, com `score >= 701` equivalente a `score_bruto >= θ_bruto` (regra em `src/painel/score.py`, testada em `testes/painel/test_ordem_valor_score.py`).
- Transações em alerta com `⚠` e motivos verificáveis por regras fixas.
- `Is Laundering` e tipologias ausentes de todos os atributos; nenhuma soma entre moedas diferentes na interface.
- Subgrafo egocêntrico respeitando os tetos e classificando cada aresta em `direta`, `sequencia`, `simultanea` ou `sem_ordem` (tracejada).
- Avaliação por Precisão, Recall, F1 e Average Precision (PR-AUC), sem Acurácia. Referência do modelo distribuído no teste: Precisão 0,6274, Recall 0,4069, F1 0,4937, AP 0,4640, com prevalência de 0,1108% (`docs/ml/resultados/avaliacao_lavagem.json`).
- Desempenho por bloco registrado: tempo de atributos, inferência e gravação, vazão (transações/s), pico de RAM, CPU e latência mediana da API.
- Suíte `pytest` verde na `main`.

---

## 11. Alternativas consideradas *(opcional)*

| Alternativa | Situação | Motivo |
|---|---|---|
| DFA/CEP como pré-filtro de Kosaraju/DFS (proposta v0.1) | Descartada | Linguagem regular não captura contagens, contrapartes distintas, valores relativos nem moedas; o filtro só faria sentido sobre uma busca global que também foi descartada |
| Busca global de ciclos e SCCs sobre todo o histórico | Descartada | Enumeração de ciclos exponencial no pior caso; O(V+E) por minuto; ignora a ordem temporal e gera falsas cadeias |
| Atributos de grafo no Random Forest (reciprocidade, profundidade de cadeia, fecha ciclo) | Medida e não adotada | AP +0,003 e precisão −2,5 p.p.; sem ganho consistente por tipologia (`docs/DECISAO_GRAFOS_ML.md`, seção 3) |
| Kosaraju, DFS e centralidade sobre o grafo desenhado no painel | Implementada, medida e removida | Não apontou lavagem que o modelo tivesse deixado passar; a centralidade repetia o desenho (seção 5 do mesmo documento) |
| Multiplicar o score bruto por 1000 | Descartada | Colocaria todo alerta na faixa "baixa" (limiar ≈ 0,09) e sugeriria uma probabilidade que o modelo não entrega |

---

## 12. Perguntas em aberto

- Atributos de grafo ainda não medidos (ciclo de 3 saltos com janela, grau distinto em janela) trariam ganho real nos positivos sem padrão?
- O resultado do experimento de atributos de grafo se mantém com outras sementes (rodou uma vez só)?
- Uma calibração do score bruto (ex.: isotônica na validação) ajudaria o analista a ler as faixas, sem mudar o corte em 701?
- Como manter scores comparáveis entre versões futuras do modelo, se o limiar mudar?

---

## 13. Cronograma e contrato entre sprints

| Sprint | Período | Produz (sai) | A próxima sprint é obrigada a usar |
|---|---|---|---|
| 1 | Semana 1 | Contrato de dados `hismall_v1` (colunas, contas `banco-conta`, regras de recusa, isolamento do rótulo, moedas), divisão temporal treino/validação/teste e métricas de classe rara definidas (Precisão, Recall, F1, AP) | Esse contrato de dados e esse protocolo de avaliação, sem alterações |
| 2 | Semana 2 | 49 atributos *point-in-time*, modelo treinado e escolhido por AP na validação, limiar por máximo F1, conversão 0–1000 e motivos verificáveis; modelo salvo com manifesto e SHA-256 | O modelo salvo, seu limiar e a escala 0–1000, sem retreino |
| 3 | Semanas 3–4 | Pipeline do painel (validação, pontuação em blocos, SQLite), interface React, subgrafo egocêntrico com ordem temporal e medições de desempenho por bloco | Os resultados experimentais e as medições desta sprint |
| 4 | Semana 5 | Avaliação final (métricas, recall por tipologia, desempenho), Sentinel AI, documentação, site e apresentação | — (entrega final) |

---

## 14. Histórico de revisões

| Versão | Data | Autor | O que mudou |
|---|---|---|---|
| v0.1 | | Grupo 1 | Primeira versão do RFC (Sprint 1): pré-filtro DFA/CEP antes de Kosaraju/DFS |
| v1.0 | 15/11/2026 | Grupo 1 | Reescrita para o escopo atual do NodeWatch: ML com escala 0–1000 e motivos verificáveis, subgrafo egocêntrico com ordem temporal, IBM AML `HI-Small`, restrições de integridade e critérios de aceite sincronizados com o código. Documento congelado como especificação-base |

---

## Registro de Revisão e Sincronização com o Código

### Tabela de sincronização

| Seção / Item | Antes (Escopo Antigo / Desatualizado) | Depois (Código Atual) | Evidência no Código |
|---|---|---|---|
| Título e trilha | Pré-filtragem por DFA/CEP antes de Kosaraju/DFS | Painel AML com ML (0–1000, alerta em 701) + subgrafo egocêntrico temporal | `src/painel/score.py`, `src/painel/armazenamento.py` |
| Autores | Em branco (o resumo de contexto listava 5 integrantes) | 4 integrantes; Julia Emily Leonardo Barbosa não faz mais parte do grupo | Informação da equipe |
| Pergunta de pesquisa | Redução de nós/arestas antes do Kosaraju | Priorização por ML (P, R, F1, AP) + custo operacional por bloco | `src/ml/avaliacao.py`, `src/api_painel.py` (`/operacao/desempenho`) |
| Linguagem regular / alfabeto Σ | Eventos categorizados reconhecidos por DFA | 49 atributos *point-in-time* (27 comportamentais + 7 formato + 15 moeda) | `src/ml/preparacao.py` (`atributos_financeiros`), `MANIFESTO_MODELO.json` (`"colunas": 49`) |
| Decisão | Aceitar/rejeitar subgrafo | Score bruto → 0–1000 linear por partes; alerta se `score >= 701` | `score.py` (`converter`, `SCORE_ALERTA = 701`) |
| Limiar | Não existia | `θ_bruto = 0,09098389…` (máximo F1 na validação) | `MANIFESTO_MODELO.json` (`limiar_alerta`) |
| Modelo | "Não é escopo alterar o ML" | Random Forest, 100 árvores, `min_samples_leaf=50`, `max_samples=0.5`, versão `lavagem-20261102T083253Z` | `MANIFESTO_MODELO.json`, `src/ml/modelos.py` |
| Textos das faixas | Resumo: baixa "sem alerta"; intermediária "sem alerta automático"; alta "com alerta" | Código: baixa "sugestão de aprovação automática"; intermediária "área cinzenta: sugestão de análise manual"; alta "sugestão de recusa ou bloqueio (gera alerta)", com o aviso de que nada é bloqueado | `score.py` (`FAIXAS`, `AVISO_FAIXAS`) |
| Motivos verificáveis | Não existiam | 8 regras fixas, só para quem passa o limiar: formato ≥ 5× a taxa média; par novo; envios 24 h > p99; origens distintas > p99; destinos distintos > p99; \|z\| > 3; recebeu fundos há < 60 min; moedas diferentes | `src/ml/preparacao.py` (`motivos`), `src/ml/previsao.py` |
| Grafo | Busca global de SCCs/ciclos | BFS por SQL a partir da conta em foco; profundidade padrão 2, máxima 3; fronteira 300/salto | `armazenamento.py` (`GRAFO_PROFUNDIDADE_PADRAO`, `GRAFO_PROFUNDIDADE_MAX`, `GRAFO_FRONTEIRA`) |
| Tetos do grafo | — (resumo: `max_nos`, `max_arestas`) | Constantes `GRAFO_MAX_NOS = 30` e `GRAFO_MAX_ARESTAS = 60` | `armazenamento.py` |
| Ordem temporal | Não existia | `direta`, `sequencia`, `simultanea`, `sem_ordem` (tracejada) | `armazenamento.py` (descrições das ordens), `painel-grafo.js` |
| Disposição do grafo | — | Vem só da tipologia registrada (CYCLE circular; FAN-IN/FAN-OUT leque; demais camadas) | `armazenamento.py`, `painel-grafo.js` |
| Algoritmos clássicos | Núcleo do projeto | Mantidos em `src/algoritmos/` (CLI e `/legado`); fora do score e do painel | `src/algoritmos/*.py`, `docs/DECISAO_GRAFOS_ML.md` |
| Dataset | "Dataset do artigo (real ou sintético)" / PaySim | IBM AML `HI-Small`, formato `hismall_v1`; `exemplo_transacoes.csv` (PaySim) é recusado pelo painel | `src/painel/datasets.py`, `docs/ml/esquemas/hismall_v1.json` |
| Pontuação em blocos | — | `BLOCO = 20_000`, terminando na virada do minuto | `src/painel/pipeline.py` |
| Limites de envio | — | 256 MB enviados, 2 GB descompactados, 32 MB para padrões | `datasets.py` (`LIMITE_*`) |
| Heartbeat | Resumo: `/sessao/pulso` | `POST /api/painel/sessao/pulso` (blueprint com prefixo `/api/painel`) | `src/api_painel.py` |
| Endpoint do painel | Resumo: `/api/painel` | Família de rotas `/api/painel/*` (`/estado`, `/datasets`, `/analises`, `/analises/<aid>/grafo`, `/operacao/*`, `/assistente`) | `src/api_painel.py` |
| Janela de 72 h | Resumo: "janela histórica mínima por conta" | Marca `historico_incompleto` na transação (não recusa); aviso quando o dataset cobre < 72 h | `datasets.py`, `pipeline.py`, `armazenamento.py` |
| Moedas | Resumo: "nunca somados entre moedas" | Verdadeiro na interface e no grafo; os atributos do modelo convertem para USD por taxa implícita | `armazenamento.py`, `preparacao.py` |
| SHA-256 | Resumo: "conferência de integridade" | SHA-256 do arquivo do dataset no manifesto da análise e do modelo/metadados contra `MANIFESTO_MODELO.json` | `datasets.py` (`sha256_arquivo`), `src/ml/provisionamento.py` |
| Métricas operacionais | Nós/arestas processados e tempo do Kosaraju | Tempo de atributos, inferência e gravação; vazão; pico de RAM; CPU; latência mediana por operação | `pipeline.py` (`_fechar_pontuacao`), `src/painel/sistema.py` |
| Sentinel AI | Não existia | Modo local (sem chave) ou conectado (Gemini padrão, Anthropic opcional) | `src/sentinel_ia.py`, `src/painel/assistente.py` |
| Cronograma | DFA → implementação → integração → complexidade | Dados → modelo e score → painel e grafo → avaliação e entrega | Seção 13 |

### Nota de congelamento

> **Este documento (RFC) constitui a especificação-base congelada do projeto NodeWatch.** Ele **não deve ser alterado automaticamente** em atualizações futuras dos documentos de sprint (`Grupo1_Sprint1.md` a `Grupo1_Sprint4.md`) nem por mudanças no código **sem autorização expressa da equipe**. Divergências encontradas depois desta versão devem ser registradas nos documentos de sprint e, se a equipe aprovar, incorporadas aqui como nova linha no Histórico de revisões. O nome do arquivo (`RFC_Grupo1_Automatos_Fraude.md`) foi mantido apenas por rastreabilidade com a entrega original.

### Pontos para validação humana

- [REVISAR: o resumo de contexto descreve "proibição de soma entre moedas distintas", mas os atributos do modelo (`log_valor_usd`, `soma_env_origem_usd_24h`) convertem valores para USD por taxa implícita e somam em USD. A regra vale integralmente para a interface e o grafo; confirmar se a redação "nunca somados" deve ficar restrita à exibição.]
- [REVISAR: os textos de recomendação das faixas no código ("sugestão de aprovação automática", "sugestão de recusa ou bloqueio") diferem da descrição do resumo ("sem alerta", "sem alerta automático"). O RFC segue o código e reforça que nada é bloqueado; confirmar se a equipe quer manter esses textos na interface.]
- [REVISAR: `README.md` (comandos `git clone`) e `MANIFESTO_MODELO.json` (`download.url`) ainda apontam para `github.com/1s4ntos/NodeWatch`, enquanto o remoto atual é `github.com/NodeWatch-Team/NodeWatch`. Confirmar qual é o endereço oficial antes da entrega.]
