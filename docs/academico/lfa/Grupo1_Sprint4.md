# Diário de Sprint 4 — Investigação visual de subgrafos, explicabilidade e consolidação final
**Período:** Semana 5
**Grupo / tema:** Grupo 1 — NodeWatch: pontuação por Machine Learning (escala 0–1000, alerta a partir de 701) com motivos verificáveis e análise temporal de subgrafos egocêntricos sobre o IBM AML

**Equipe:** Grupo 1 — Guilherme Lombardi, Ryan dos Santos Veloso, Caio Winkler Marangoni, Guilherme Liborio Camargo
**Scrum Master do Sprint:** [PENDENTE: Inserir nome do Scrum Master da Sprint 4]
**Repositório GitHub:** pesquisa em https://github.com/Guilherme-Lombardi/AnaliseComplexidade_DeteccaoFraudes; sistema em https://github.com/NodeWatch-Team/NodeWatch (site: https://nodewatch-team.github.io/NodeWatch/)

> Pipeline integrado e medido na Sprint 3. Esta sprint **fecha o projeto**: entrega a vista de investigação com o grafo egocêntrico temporal, a camada de explicabilidade (motivos verificáveis, filtros e Assistente de Dúvidas), a análise formal de complexidade confrontada com os números empíricos, a consolidação dos achados no artigo e na documentação, a ficha técnica e a apresentação final. **Não há** sprint seguinte — esta é a entrega.

### Contrato desta sprint

| | Artefato | Origem / destino |
|---|---|---|
| **Entra** | Métricas de classificação no corte 701, benchmark operacional por bloco e auditoria de vazamento | Sprint 3 — **não gerar novos números sem justificar** |
| **Sai** | Vista de Investigação com grafo egocêntrico interativo (saltos, limites, agrupamento por moeda, ordem temporal) | Entrega final |
| **Sai** | Explicabilidade: motivos verificáveis, filtros da tabela e Assistente de Dúvidas (modo local e conectado) | Entrega final |
| **Sai** | Análise formal de complexidade assintótica (pior caso), teórica vs. empírica | Entrega final |
| **Sai** | Consolidação dos resultados: atualização do artigo/documentação metodológica, limitações e trabalhos futuros | Entrega final |
| **Sai** | Ficha técnica do sistema (model card simplificado) + apresentação final | Entrega final / mostra |

**Não há sprint seguinte.**

- [x] Confirmei que os números usados na análise são os da Sprint 3 (não refeitos sem registrar o porquê). *Única medição nova: o grafo egocêntrico em 60 contas reais (seção 1.3), que a Sprint 3 não cobria; feita só com leitura sobre a mesma análise LI-Small da Sprint 3.*

---

## 1. Vista de Investigação e grafo egocêntrico (`painel-grafo.js`)

- [x] Visualização SVG interativa centrada na conta em foco (zoom, arrasto, seleção de aresta e de sequência)
- [x] Controle de profundidade (saltos) e limites ativos informados na tela (`max_nos`, `max_arestas`, fronteira)
- [x] Arestas agrupadas por `(origem, destino, moeda)`, sem soma entre moedas
- [x] Distinção visual da ordem temporal: `direta` e `sequencia` contínuas, `simultanea` e `sem_ordem` tracejadas, sequência selecionada em destaque

### 1.1 Como o analista chega ao grafo

O painel tem 5 vistas (`interface/assets/painel-app.js`, `VISTAS`): **Análise** (dataset, execução e análises recentes), **Visão geral** (indicadores do recorte, faixas do score e prioridades), **Investigação** (contas de maior risco e grafo de transações), **Transações** (tabela com detalhes por linha) e **Detalhes** (interpretação do score e definições). A conta em foco vem de três lugares: um clique em **Contas de maior risco** (as 10 contas com mais transações em alerta no recorte; empate pelo maior score e depois pela ordem alfabética), o filtro **Conta de origem/destino** ou o botão de focar uma conta nos detalhes de uma transação. Se o número da conta existir em mais de um banco, o painel pede para escolher (`ambiguo`).

### 1.2 O que o grafo mostra

| Elemento | Regra | Onde |
|---|---|---|
| Coleta | BFS no SQLite a partir do foco, a jusante e a montante, com os mesmos filtros da tabela (menos os de conta) | `src/painel/armazenamento.py::grafo`, `GET /api/painel/analises/<aid>/grafo` |
| Saltos | Seletor "Saltos a partir do foco": 1, 2 ou 3 (padrão 2, máximo 3) | `painel-grafo.js` (`grafo-saltos`); `GRAFO_PROFUNDIDADE_PADRAO`, `GRAFO_PROFUNDIDADE_MAX` |
| Limites | Até **30 vértices** e **60 arestas** desenhados (prioridade: mais perto do foco, depois com alerta, depois mais transações); fronteira de **300 contas por salto** — se truncada, a legenda avisa que os totais do salto seguinte são parciais | `GRAFO_MAX_NOS`, `GRAFO_MAX_ARESTAS`, `GRAFO_FRONTEIRA`; legenda "Limites ativos" |
| Vértice | Conta `banco-conta`; foco com contorno duplo azul; conta ligada a alerta em vermelho com "!" | `LegendaGrafo` |
| Aresta | Uma por `(origem, destino, moeda)`; rótulo com quantidade, total e moeda, `⚠` se alguma transação tem alerta; traço grosso quando agrupada; laço para autotransferência | `rotuloAresta`, `descricaoAresta` |
| Ordem temporal | `direta` e `sequencia`: traço contínuo. `simultanea` e `sem_ordem`: **tracejado** (`stroke-dasharray: 7 6`), com o texto da ordem na descrição da aresta e a contagem "sem ordem confirmada (N no mesmo minuto)" no quadro Ordem no tempo | `semOrdem` em `painel-grafo.js`; `.g-aresta.sem-ordem` em `painel.css` |
| Sequências | Lista de sequências com horários compatíveis (a jusante, a montante e volta ao foco), alertas primeiro; ao selecionar, o caminho fica em azul brilhante | `_ordem_temporal` (até 12 listadas), `.g-aresta.na-sequencia` |
| Disposição | Circular (CYCLE), leque (FAN-IN/FAN-OUT) ou camadas — **só** pela tipologia registrada no arquivo de padrões, nunca pela aparência | `armazenamento.py::disposicao_para` (`DISPOSICOES`, `DISPOSICAO_CAMADAS`), legenda "Disposição" |
| Transações da aresta | Ao selecionar uma aresta, a tabela das transações dela (até 50, em ordem de horário, com score e faixa) | `TransacoesDaAresta` |
| Interação | Ctrl + roda ou botões: zoom de 0,4× a 4×; arraste do fundo para mover; teclado (Enter/Espaço) | `Grafo` em `painel-grafo.js` |

### 1.3 Medição do grafo em contas reais (nova nesta sprint)

Script só de leitura sobre a análise LI-Small da Sprint 3 (`an-20261115T145945-6b13f2`), chamando a mesma função `armazenamento.grafo` da API: 30 contas do topo de risco e 30 contas sorteadas entre as que têm alerta (semente 42).

| Grupo | Saltos | Arestas diretas | Indiretas | Em `sequencia` | `sem_ordem` + `simultanea` | **Indiretas sem ordem confirmada** | Sequências confirmadas | Fronteira truncada | Tempo da consulta (mediana / máx.) |
|---|---|---|---|---|---|---|---|---|---|
| Topo de risco | 2 | 601 | 932 | 402 | 530 + 0 | **56,9%** | 257 | 0 de 30 | 149 ms / 1.002 ms |
| Topo de risco | 3 | 601 | 1.101 | 406 | 695 + 0 | **63,1%** | 256 | 3 de 30 | 168 ms / 1.315 ms |
| Sorteio com alerta | 2 | 243 | 566 | 338 | 228 + 0 | **40,3%** | 337 | 0 de 30 | 137 ms / 481 ms |
| Sorteio com alerta | 3 | 243 | 940 | 396 | 544 + 0 | **57,9%** | 368 | 5 de 30 | 147 ms / 963 ms |

Em todos os grupos, a mediana de vértices desenhados foi 30 (o teto). **Entre 40% e 63% das relações indiretas desenhadas não têm horário compatível com uma cadeia** e aparecem tracejadas: sem a regra temporal, o desenho as mostraria como se fossem etapas seguintes do dinheiro. Nenhuma aresta caiu em `simultanea` nesta amostra. O tempo é medido no servidor, sem rede nem navegador.

**Evidências:** `c1cd135` (grafo com zoom, arrasto, dicas e estado de carregamento), `d9e33ea` (navegação por vistas), `55af383` (design system e vistas, `docs/ui/PAINEL_ANALISTA.md`), capturas em `docs/ui/capturas/depois_desktop_grafo.jpg`, `depois_desktop_sequencia.jpg`, `depois_desktop_legenda.jpg`; teste `testes/painel/test_ordem_valor_score.py::test_so_e_sequencia_o_que_tem_horario_compativel` e `testes/painel/test_armazenamento.py::test_grafo_respeita_limites_e_informa_x_de_y`.

## 2. Explicabilidade e Assistente Sentinel AI

- [x] Motivos verificáveis exibidos para transações em alerta (701–1000)
- [x] Filtros da tabela de transações aplicados de forma única a indicadores, tabela, contas e grafo
- [x] Assistente de Dúvidas com modo local (sem envio de dados) e modo conectado (Sentinel AI, com autorização)

### 2.1 Motivos verificáveis

Nos detalhes de cada transação (`painel-secoes.js`, cartão **Motivos verificáveis**), uma transação com $s \geq 701$ mostra a lista de fatos que dispararam, calculados por regras fixas (`src/ml/preparacao.py::motivos`):

1. formato com taxa de lavagem no treino ≥ 5× a média;
2. primeira transação entre origem e destino;
3. envios da origem em 24 h acima do p99 do treino;
4. destino com mais origens distintas que o p99 do treino;
5. origem com mais destinos distintos que o p99 do treino;
6. valor atípico para a origem ($|z| > 3$);
7. origem recebeu fundos há menos de 60 min;
8. moedas de pagamento e recebimento diferentes.

São **fatos conferíveis nos dados, não a explicação do modelo**: a floresta não grava explicação por transação. Sem alerta, a tela diz que os motivos só são calculados para transações com alerta. Os detalhes também mostram o score, a faixa, o score bruto, o limiar e a versão do modelo, o aviso de que nada é bloqueado e o `historico_incompleto`. O rótulo do dataset, quando existe, aparece em campo separado, com a legenda "não é previsão".

### 2.2 Filtros da tabela de transações

Um único conjunto de filtros (`armazenamento.Filtros`) gera o mesmo `WHERE` para indicadores, tabela e contas de maior risco; o grafo usa os mesmos, menos os de conta (que escolhem o foco):

| Filtro | Regra |
|---|---|
| Período (de / até) | Minuto inclusivo |
| Moeda de pagamento | Igualdade |
| Alerta | Sim / não |
| Valor mínimo | A partir de 1 unidade da moeda (não existe valor máximo) |
| Banco de origem / destino | Igualdade |
| Conta de origem / destino | Nó `banco-conta` ou número da conta |
| Score mínimo / máximo | 0–1000 |
| Ordenação | ID de exibição (cronológico), score ou valor pago |
| Paginação | 50 por página (máximo 200) |

Filtro inválido devolve o campo e a mensagem para a tela (`ErroFiltro`). Os IDs de exibição seguem a ordem cronológica do dataset e não mudam com filtro, ordem ou página.

### 2.3 Assistente de Dúvidas (Sentinel AI)

Um só assistente na tela (`painel-secoes.js`, `Assistente`), com dois modos (`POST /api/painel/assistente`):

| Modo | Quando | O que responde | O que sai do computador |
|---|---|---|---|
| **Local** (`src/painel/assistente.py`) | Padrão; também sem chave, sem autorização ou se o provedor falhar (a resposta diz o motivo) | Glossário e legendas da tela, ajuda de uso e fatos da análise ativa lidos do SQLite com os filtros atuais. Não gera texto livre; pergunta fora da base → diz que não sabe e lista o que sabe | Nada |
| **Conectado** (`src/sentinel_ia.py`) | Quando o analista autoriza na tela (`usar_sentinel`) e há chave do provedor (`GEMINI_API_KEY` ou chave Anthropic) | Resposta do modelo de linguagem com o histórico da conversa, o modo de linguagem (**leiga** ou **técnica**) e o contexto verificado (`src/painel/contexto_sentinel.py`): manifesto, recorte, até 10 alertas principais, transação em foco, resumo do modelo, avaliação histórica e a lista do que **não** pode ser afirmado | O contexto verificado (identificadores de contas e valores das transações listadas, não o arquivo) vai ao provedor configurado: Gemini (`gemini-2.5-flash`, padrão) ou Anthropic (`SENTINEL_PROVIDER=anthropic`) |

Em nenhum dos modos o assistente conclui que houve fraude ou lavagem. Nos detalhes de uma transação, o botão **Perguntar ao Assistente de dúvidas sobre esta transação** leva a transação como contexto. `POST /api/painel/assistente/verificar` testa a conexão com uma chamada mínima, sem dados da análise; os erros são classificados (limite, tempo, conexão, chave, biblioteca) e o detalhe técnico fica só no log. O mesmo motor ainda atende o chat da interface antiga (`/api/chat` em `src/sentinel_ai.py`).

**Evidências:** `af905f7` (Sentinel AI no Assistente de dúvidas com erros classificados), `docs/SENTINEL_AI.md`; testes `testes/painel/test_assistente_sentinel.py`, `test_sentinel_erros.py`, `test_api_painel.py::test_assistente_responde_so_com_base_verificavel`.

## 3. Análise de complexidade assintótica

- [x] Complexidade da alternativa descartada (DFS/Kosaraju e enumeração de ciclos sobre o grafo global) formalizada (notação O)
- [x] Complexidade de cada etapa do pipeline de pontuação formalizada
- [x] Complexidade do subgrafo egocêntrico sob demanda formalizada
- [x] Comparação explícita: em que condições a abordagem do NodeWatch reduz o custo no pior caso, e em que condições não ajuda

**Notação.** $N$ = transações do arquivo; $C$ = contas; $P$ = pares origem→destino distintos; $M$ = minutos distintos; $T = 100$ árvores; $d$ = profundidade média das árvores; $I = 10$ índices; $k \leq 3$ saltos; $F = 300$ contas de fronteira por salto; $\bar g$ = grau médio das contas da fronteira; $A \leq 60$ arestas desenhadas.

**Análise formal (com notação O):**

| Etapa | Custo de tempo | Memória | Comentário |
|---|---|---|---|
| Leitura e validação | $O(N)$ | $O(B)$ por bloco ($B$ = 200.000 linhas) | Uma passada, em blocos |
| Ordenação cronológica | $O(N \log N)$ | $O(N)$ | Ordenação estável por minuto |
| Atributos *point-in-time* | $O(N)$ amortizado | $O(N + C + P)$ | Cada janela (6/24/72 h) avança um cursor por evento: $O(1)$ amortizado por transação e janela; contagens distintas por dicionário, $O(1)$ esperado |
| Inferência (Random Forest) | $O(N \cdot T \cdot d)$ | $O(B)$ por bloco | Cada transação percorre $T$ caminhos raiz-folha |
| Gravação no SQLite | $O(N)$ | $O(B)$ | Inserção em lote, sem índices durante a pontuação |
| Índices e contagens | $O(I \cdot N \log N)$ | — | 10 índices B-tree criados depois da pontuação |
| **Pipeline completo** | $O(N \log N + N \cdot T \cdot d)$ | $O(N + C + P)$ | Com $T$ e $d$ fixos pelo modelo salvo: $O(N \log N)$ |
| Subgrafo egocêntrico (por consulta) | $O\big(k \cdot F \cdot (\log N + \bar g)\big) + O(A \log N)$ | $O(k \cdot F \cdot \bar g)$ | Cada salto consulta ≤ $F$ contas por índice; a ordem temporal faz ≤ 2 buscas indexadas por aresta desenhada; o desenho é limitado a 30 vértices e 60 arestas |
| *Alternativa descartada:* Kosaraju sobre o grafo global | $O(C + N)$ por execução; $O(M \cdot (C + N))$ se recalculado a cada minuto | $O(C + N)$ | Ignora o tempo: agrupa arestas de qualquer horário |
| *Alternativa descartada:* enumerar ciclos (Johnson) | $O\big((C + N)(\Psi + 1)\big)$, com $\Psi$ = nº de ciclos elementares, exponencial em $C$ no pior caso | $O(C + N)$ | Explosão combinatória; `find_cycles` do projeto não usa os conjuntos bloqueados de Johnson, então nem esse limite vale para ele |

**Quando a abordagem do NodeWatch reduz o custo no pior caso:**
- O score de cada transação custa $O(T \cdot d)$ mais $O(1)$ amortizado de atributos, **independente do tamanho do grafo**; a análise inteira cresce como $O(N \log N)$, contra $O(M(C+N))$ de recalcular SCCs a cada minuto e contra o pior caso exponencial da enumeração de ciclos.
- O grafo da investigação depende de $k$, $F$ e $\bar g$, não de $N$ (exceto pelo fator $\log N$ dos índices): uma conta comum custa o mesmo num arquivo de mil ou de cinco milhões de transações.

**Quando não ajuda:**
- **Contas-hub:** $\bar g$ não tem teto; uma fronteira de 300 contas muito conectadas pode exigir agregar uma fração grande das transações, chegando a $O(N)$ por consulta. O teto de 30/60 limita o **desenho**, não a coleta. A fronteira truncada (3 a 5 de 30 contas com 3 saltos, seção 1.3) mostra que isso acontece.
- **Pior caso de ordenação e índices:** $O(N \log N)$ não muda; para arquivos pequenos, o custo fixo (carregar o modelo, preparar o estado) domina.
- **O que o recorte não cobre:** padrões que só aparecem no grafo inteiro (componentes grandes, ciclos longos) não são vistos pela consulta egocêntrica. Essa perda foi medida e não fez falta (seção 5), mas não é garantida em outros dados.

## 4. Comparação teórica x empírica

- [x] Números da Sprint 3 confrontados com a análise teórica desta sprint
- [x] Convergências e divergências discutidas (o custo observado bate com o esperado teoricamente?)

**Discussão teórica x empírica:**

| Previsão teórica | Medição | Fonte | Converge? |
|---|---|---|---|
| Inferência $O(N \cdot T \cdot d)$ é a parte mais barata por transação depois de vetorizada | 22,3 s para 6.924.049 transações (3,2 µs/transação; 13% da pontuação) | Sprint 3, execução B | Sim |
| Atributos $O(N)$ amortizado | 72,3 s no total (10,4 µs/transação em média) | Sprint 3, execução B | Sim na média; ver divergência 1 |
| Gravação $O(N)$ | 76,5 s (11,1 µs/transação) | Sprint 3, execução B | Sim |
| Índices $O(I \cdot N \log N)$ | 74,3 s (27% da análise) para 10 índices | Sprint 3, execução B | Sim (segunda maior etapa) |
| Pipeline $O(N \log N)$ → HI-Small (5,08 M) em ≈ 2 min de pontuação | Projeção a partir de 40.469 transações/s: ≈ 125 s | Sprint 3 | [PENDENTE: medir o HI-Small no painel] |
| Grafo independe de $N$ | Mediana de 137 a 168 ms por consulta num SQLite de 6,9 M transações | Seção 1.3 | Sim |
| Mais saltos aumentam a coleta, mas o desenho fica no teto | 2 → 3 saltos: indiretas +18% (topo) e +66% (sorteio); vértices na mediana = 30 em todos os casos; máximo de 1,3 s | Seção 1.3 | Sim |
| Atributos de grafo locais com estado por conta são lineares | 3 atributos de grafo em 5.078.345 linhas: 3,1 s (reciprocidade 0,5 s; cadeia 2,6 s) | `docs/DECISAO_GRAFOS_ML.md`, seção 3 | Sim |

**Divergências.**
1. **Último bloco mais caro.** A média dos atributos é 10,4 µs por transação, mas o último bloco medido (8.437 transações) gastou 565,8 ms, ou 67 µs por transação (6,4× a média). Possíveis causas: custo fixo de fechar o estado num bloco menor, ou crescimento do estado com o histórico acumulado. Com uma só medição por bloco gravada, não dá para separar as duas.
2. **Arquivos pequenos.** O ambiente de teste (5.000 transações) teve vazão de 2.303 transações/s, contra 40.469 no LI-Small: o custo fixo domina, o que a análise assintótica não captura.
3. **Linearidade não demonstrada.** Só há um tamanho grande medido no painel (LI-Small). A projeção para o HI-Small é extrapolação.

## 5. Consolidação dos resultados e atualização do artigo / documentação metodológica

- [x] Seção de metodologia atualizada com a especificação formal (contrato de dados, score, faixas, ordem temporal)
- [x] Seção de resultados atualizada com as métricas, o benchmark e a análise de complexidade
- [ ] Revisão PRISMA atualizada, se aplicável ao escopo do grupo *([PENDENTE: confirmar se a revisão PRISMA do repositório de pesquisa precisa citar a migração para ML + grafo temporal])*

### 5.1 Achados

1. **A priorização por ML funciona em classe rara.** No teste do HI-Small: Precisão 0,627, Recall 0,407, F1 0,494 e Average Precision 0,464 — **419× a prevalência**. Em outro dataset (LI-Small, no painel, sem histórico anterior): AP 0,175 (339× a prevalência) e **97 lavagens entre as 100 transações de maior score**. A taxa de lavagem sobe de 0,032% (Baixa) para 3,41% (Intermediária) e 27,5% (Alta).
2. **A ordenação temporal reduz o ruído da investigação.** Em 60 contas reais, **40% a 63% das relações indiretas desenhadas não têm horário compatível com uma cadeia** e ficam tracejadas; as 257 a 368 sequências confirmadas são listadas e podem ser destacadas. Sem essa regra, o analista veria como caminho do dinheiro relações que aconteceram antes de o dinheiro chegar.
3. **Algoritmos globais de grafo não acrescentaram nada mensurável.** Atributos de grafo no modelo: AP +0,003 e precisão −2,5 p.p. Kosaraju, DFS e centralidade no grafo da conta em foco: nenhuma lavagem sem alerta encontrada nas 60 contas medidas; a centralidade repetia o desenho (`docs/DECISAO_GRAFOS_ML.md`, seções 3 e 5).
4. **O custo operacional cabe numa estação local.** ~40 mil transações/s na pontuação, pico de 2,7 GB de RAM para 6,9 M transações, grafo em ~150 ms (mediana).

### 5.2 Limitações conhecidas

- **Histórico < 72 h:** cada análise começa sem passado. No LI-Small, 41% das transações caíram nessa janela, com recall de 0,084 contra 0,242 nas demais.
- **Score bruto sem calibração probabilística nativa:** na faixa 0,1–0,2 do score bruto, 65% das transações são lavagem; o índice 0–1000 é ordem de prioridade. No LI-Small, o maior score foi 755, e a faixa 756–1000 não foi usada.
- **Viés de formato:** ACH concentra ≈ 87% da lavagem do treino; no LI-Small, 100% dos alertas foram ACH e os 954 positivos de outros formatos ficaram sem alerta.
- **Positivos sem padrão:** recall de 7/371 (1,9%) no teste do HI-Small; nenhum atributo de grafo testado resolveu.
- **Recorte do grafo:** teto de 30 vértices e 60 arestas; fronteira truncada em contas-hub; resolução de 1 minuto (ordem `simultanea`); horário compatível não prova que é o mesmo dinheiro.
- **Dados e avaliação:** dados sintéticos; o período de teste do HI-Small já foi consultado mais de uma vez; uma só rodada de benchmark.
- **Assistente conectado:** quando autorizado, envia identificadores de contas e valores ao provedor externo.

### 5.3 Trabalhos futuros

- Carga de histórico anterior ao arquivo (o estado incremental já tem `carga_inicial`) para eliminar o `historico_incompleto` no painel.
- Calibração do score bruto na validação (isotônica ou Platt), mantendo o corte em 701, para que as faixas possam ser lidas como risco.
- Atributos de grafo ainda não medidos (ciclo de 3 saltos com janela, grau distinto em janela), com várias sementes.
- Reduzir o viés de ACH (modelos ou limiares por formato) e investigar os positivos sem padrão.
- Avaliar o HI-Small no próprio painel, repetir o benchmark e gravar CPU e latência da API.
- Avaliação em dados reais, com a fusão de sinais registrada em `docs/ml/CONTRATO_INTEGRACAO.md`.

### 5.4 Trechos/links atualizados no artigo e na documentação

| Documento | Conteúdo |
|---|---|
| `docs/lfa/RFC_Grupo1_Automatos_Fraude.md` (v1.0) | Especificação-base congelada |
| `docs/lfa/Grupo1_Sprint1.md` a `Grupo1_Sprint4.md` | Formalização, implementação, avaliação e consolidação |
| `docs/DECISAO_GRAFOS_ML.md` | Diagnóstico, experimento e decisão sobre grafos + ML |
| `docs/ml/RELATORIO_ML.md` | Treino, avaliação e ressalvas do modelo |
| `docs/COMO_FUNCIONA_O_NODEWATCH.md` (seção 6.6) e `.pdf` | Explicação do sistema |
| `docs/APRESENTACAO_NODEWATCH.md` e `.pdf` | Roteiro e respostas da apresentação |
| `docs/SENTINEL_AI.md` | Assistente de Dúvidas |
| Site `https://nodewatch-team.github.io/NodeWatch/` (`index.html`) | Página de apresentação |
| Artigo do repositório de pesquisa | [PENDENTE: Inserir link do artigo atualizado (metodologia + resultados)] |

## 6. Ficha técnica do sistema (model card simplificado)

| Campo | Conteúdo |
|---|---|
| Pergunta de pesquisa | Em que medida um modelo de ML tabular com atributos *point-in-time*, combinado com um subgrafo egocêntrico temporalmente ordenado e gerado sob demanda, prioriza transações de lavagem para o analista (Precisão, Recall, F1, AP) com custo operacional compatível com uma estação local? |
| Especificação formal (score, faixas, esquema, ordem temporal) — link | `docs/lfa/Grupo1_Sprint1.md`, seção 2; implementação em `src/painel/score.py`, `src/painel/datasets.py`, `src/painel/armazenamento.py` |
| Modelo | Random Forest (100 árvores, `min_samples_leaf=50`, `max_samples=0.5`, `max_features="sqrt"`), 49 atributos, versão `lavagem-20261102T083253Z`, treinado até 07/09/2022, limiar $\theta_{\text{bruto}} = 0{,}09098$ (máx. F1 na validação), SHA-256 do artefato `7cbbfd39…059ff` |
| Uso pretendido | Triagem offline e assistida por analista de PLD; ordenação de prioridade. **Não** bloqueia, aprova nem paga transações; não prova lavagem |
| Dataset de teste usado | IBM AML **HI-Small** (teste temporal 09–11/09/2022, 862.792 transações) e **LI-Small** no painel (6.924.049 transações); sintéticos, CDLA-Sharing-1.0 |
| Resultado (resumo) | HI-Small: P 0,627 · R 0,407 · F1 0,494 · AP 0,464. LI-Small: P 0,275 · R 0,200 · F1 0,232 · AP 0,175; precisão@100 = 0,97. Pontuação a 40.469 transações/s; pico de 2,68 GB; grafo em ~150 ms |
| Explicabilidade | 8 motivos verificáveis por regras fixas (só com alerta); importâncias globais da floresta no contexto do assistente; nenhuma explicação por transação do modelo |
| Limitações conhecidas | Histórico < 72 h; score não calibrado; viés ACH; positivos sem padrão; recorte do grafo; dados sintéticos; teste reconsultado |
| Como reproduzir (repositório/commit) | `https://github.com/NodeWatch-Team/NodeWatch`, commit `bc90ecf`; `python -m venv .venv`, `pip install -r requirements.txt -r requirements-ml.txt`, `python src/sentinel_ai.py` → `http://127.0.0.1:5000/`; testes: `pytest -q` (473 passando em 15/11/2026); guia: `docs/guia-execucao-local.md` |

## 7. Apresentação final

- [x] Roteiro da apresentação definido (problema → dados e contrato → modelo e score → painel e grafo temporal → resultados → limitações → conclusão)
- [x] Material de apoio pronto (slides ou diagrama): `docs/APRESENTACAO_NODEWATCH.pdf`, site de apresentação e capturas em `docs/ui/capturas/`

**Roteiro.**
1. **Problema:** lavagem é rara (0,1%) e estrutural; o analista precisa saber por onde começar e conseguir verificar o caso.
2. **Dados e contrato:** IBM AML `HI-Small`, esquema `hismall_v1`, recusa sem preenchimento, rótulo isolado, moedas separadas, janela de 72 h.
3. **Modelo e score:** Random Forest com 49 atributos do passado; score 0–1000 ancorado no limiar (701); faixas; motivos verificáveis.
4. **Painel e grafo temporal (demonstração):** envio → análise em blocos → fila → detalhes → conta em foco → grafo com sequências e relações tracejadas → Assistente de Dúvidas.
5. **Resultados:** métricas sem Acurácia (com a prova de que ela engana), matriz de confusão, trade-off, benchmark, ruído reduzido no grafo.
6. **Limitações e trabalhos futuros.**
7. **Conclusão:** o score ordena sinais para investigação; não afirma fraude.

**Frase de referência:** "O NodeWatch modela as transações como um grafo direcionado. O Random Forest usa medidas de grafo calculadas só com o passado, como o grau de entrada e de saída de cada conta e se a aresta entre as duas contas é nova. No painel, a rede da conta investigada é explorada salto a salto, e o sistema mostra cadeias com horários compatíveis, inclusive o dinheiro voltando à conta. Testamos levar ciclos para dentro do modelo e algoritmos globais para a tela, e não houve ganho. O score não afirma fraude: ele ordena sinais para investigação." (`docs/DECISAO_GRAFOS_ML.md`, seção 5)

**Não afirmar:** "o modelo usa DFS ou Kosaraju"; "o painel detecta ciclos ou grupos fortemente conectados"; "a ordem no tempo usa DFS"; "probabilidade de lavagem"; "detecta fraude"; "a telemetria de rede ajuda a detectar lavagem".

## 8. Scrum

- [ ] Atualizações assíncronas semanais registradas
- [ ] Board refletindo o backlog, em andamento e concluído

**Link do board:** [PENDENTE: Inserir link do board (Jira/Trello/GitHub Projects)]

## 9. Diário de bordo (retrospectiva individual)

| Integrante | O que fiz nesta Sprint | Dificuldades | O que pretendo manter/ajustar |
|---|---|---|---|
| Guilherme Lombardi | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |
| Ryan dos Santos Veloso | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |
| Caio Winkler Marangoni | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |
| Guilherme Liborio Camargo | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |

---

## Rubrica de avaliação — Sprint 4 (nota de 0 a 4,0)

| Critério | Peso | O que caracteriza nota máxima | Nota atribuída | Observações |
|---|---|---|---|---|
| Análise de complexidade assintótica | 1,5 | Notação O correta para DFA, DFS/Kosaraju e pipeline completo; comparação clara | | |
| Comparação teórica x empírica | 1,0 | Confronto explícito com os dados da Sprint 3; divergências discutidas | | |
| Atualização do artigo e ficha técnica | 1,0 | Metodologia e resultados atualizados; ficha técnica completa | | |
| Apresentação final / Scrum + diário | 0,5 | Roteiro claro; board e diário atualizados | | |
| **Nota final da Sprint 4** | **4,0** | | **___ / 4,0** | |

> **Correspondência com o escopo atual** (a rubrica foi mantida literalmente, como fornecida pela disciplina): "Notação O para DFA, DFS/Kosaraju e pipeline completo" → seção 3 (pipeline de pontuação, subgrafo egocêntrico e as alternativas descartadas Kosaraju/ciclos); "Comparação teórica x empírica" → seção 4; "Atualização do artigo e ficha técnica" → seções 5 e 6; "Apresentação final" → seção 7. As seções 1 e 2 (vista de investigação e explicabilidade) são a entrega funcional final pedida para esta sprint.

---

## Registro de Revisão e Sincronização com o Código

| Seção / Item | Antes | Depois | Evidência no Código |
|---|---|---|---|
| Título e tema | "Análise de complexidade e redação final"; DFA/Kosaraju | "Investigação visual de subgrafos, explicabilidade e consolidação final" | RFC v1.0; Sprints 1–3 |
| Equipe | Em branco | 4 integrantes (o prompt pedia 5; Julia Emily Leonardo Barbosa saiu do grupo) | Informação da equipe |
| Contrato | Complexidade, artigo, ficha do autômato | + Vista de Investigação, explicabilidade e Assistente; complexidade do pipeline e do grafo | Seções 1–7 |
| Estrutura | 7 seções | 9 seções: as 2 novas (vista e explicabilidade) vêm antes das 5 originais, que foram mantidas e renumeradas, mais Scrum e diário | — |
| Parâmetros do grafo | Resumo: `max_nos`, `max_arestas` controláveis | Só os **saltos** são controláveis na tela (1–3, padrão 2); 30 vértices, 60 arestas e fronteira de 300 são constantes do servidor, informadas na legenda | `armazenamento.py` (`GRAFO_*`); `painel-grafo.js` (`grafo-saltos`, `LegendaGrafo`) |
| Ordem temporal na tela | Resumo: "linha tracejada para `sem_ordem`" | `simultanea` **também** é tracejada (`semOrdem = sem_ordem ∨ simultanea`); a diferença aparece no texto da aresta e na contagem "N no mesmo minuto" | `painel-grafo.js:76`, `painel.css:680` |
| Vistas | — | Análise, Visão geral, Investigação, Transações, Detalhes | `painel-app.js` (`VISTAS`) |
| Contas de maior risco | — | 10 contas; ordem por nº de alertas, maior score, alfabética | `armazenamento.py` (`MAX_CONTAS_RISCO`, `REGRA_CONTAS`) |
| Motivos verificáveis | — | 8 regras, só com alerta, no cartão de detalhes | `preparacao.py::motivos`; `painel-secoes.js:595` |
| Filtros | — | Período, moeda, alerta, valor mínimo, bancos, contas, score mín./máx.; ordenação e paginação 50/200 | `armazenamento.py` (`Filtros`, `TAMANHO_PAGINA_*`) |
| Assistente | Resumo: Sentinel AI em `src/sentinel_ai.py` | Rota em `src/api_painel.py` (`/assistente`, `/assistente/verificar`); modo local em `src/painel/assistente.py`; motor em `src/sentinel_ia.py`; contexto em `src/painel/contexto_sentinel.py`; `sentinel_ai.py` só serve o app e o chat antigo | Arquivos citados |
| Provedores | — | Gemini `gemini-2.5-flash` (padrão) ou Anthropic (`SENTINEL_PROVIDER`, `SENTINEL_MODEL`); modos de linguagem leiga e técnica | `src/sentinel_ia.py` |
| Complexidade | DFA + Kosaraju | Pipeline $O(N \log N + N T d)$; grafo $O(k F (\log N + \bar g)) + O(A \log N)$; alternativas descartadas | Seção 3 |
| Medição nova | — | Grafo em 60 contas da análise LI-Small (somente leitura, `mode=ro&immutable=1`): 40–63% das indiretas sem ordem confirmada; mediana de 137–168 ms | Script de medição chamando `armazenamento.grafo`; análise `an-20261115T145945-6b13f2` |
| Divergência empírica | — | Último bloco 6,4× mais caro por transação que a média dos atributos | Manifesto da Sprint 3 (`ultimo_bloco`) |
| Ficha técnica | Ficha do autômato | Model card do sistema, com commit `bc90ecf` e 473 testes | `modelos/MANIFESTO_MODELO.json`, `pytest -q` |
| Diário de bordo | Linha vazia | 4 integrantes | — |
| Rubrica | Texto original | Mantida literalmente, com nota de correspondência | — |

- [REVISAR: o prompt descreve `max_nos` e `max_arestas` como controles da vista; no código eles são constantes do servidor (30 e 60) mostradas na legenda, e só os saltos são escolhidos na tela. Decidir se a interface deve ganhar esses controles ou se o texto do prompt fica como está neste documento.]
- [REVISAR: o prompt pede "linha tracejada para `sem_ordem`" com distinção visual para `simultanea`; no código, `simultanea` também é desenhada tracejada e só se distingue pelo texto. Avaliar um estilo próprio (ex.: pontilhado) se a distinção visual for exigida.]
- [REVISAR: a medição do grafo (seção 1.3) foi feita por script sobre a mesma análise da Sprint 3, chamando a função da API sem HTTP; não inclui rede nem navegador. Os 60 casos são de um dataset sintético.]
- [REVISAR: o custo por transação do último bloco (67 µs nos atributos) é 6,4× a média; repetir o benchmark gravando os tempos de cada bloco para separar custo fixo de crescimento do estado.]
- [REVISAR: a rubrica foi mantida literalmente ("DFA", "DFS/Kosaraju"); confirmar com o docente se a nota de correspondência basta.]
