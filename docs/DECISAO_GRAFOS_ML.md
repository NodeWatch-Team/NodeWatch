# NodeWatch: decisão sobre grafos + ML

> **Atualização (17/11/2026).** Na reorganização do repositório, a CLI de grafos (`src/main.py`), os algoritmos de `src/algoritmos/` (DFS de ciclos, SCC de Kosaraju, centralidade, fan-in/fan-out), `src/grafo/`, `src/leitura/`, os scripts de benchmark da fase de grafos e `dados/exemplo_transacoes.csv` foram **removidos**, assim como a interface antiga. O diagnóstico abaixo descreve o código até o commit `1a7a119`, onde ele continua disponível. A conclusão não muda: o modelo usa só a estrutura de 1 salto e o grafo do painel é uma consulta ao SQLite.

Data: 15/11/2026. Decisão final: **D**. A opção A foi implementada, medida e **descartada** (seção 5). Ficam as correções de texto e as evidências.
O diagnóstico (seções 1 e 2) foi feito só com leitura. O experimento (seção 3) rodou fora do projeto e não gravou nada em `artefatos_ml/` nem em `modelos/`. O modelo oficial não mudou.

**Resumo em 5 linhas**
1. Hoje grafo e ML são independentes. Nenhum arquivo de `src/ml` ou `src/painel` importa `src.algoritmos`/`src.grafo`. A interface antiga mostra resultados de DFS/SCC **escritos à mão no HTML**, não calculados na hora.
2. O modelo já tem recall de 0,55 a 0,72 em todas as 8 tipologias estruturais. O grande buraco é `sem_padrao` (7 de 371, 1,9%), que nenhum atributo de grafo resolve.
3. Experimento: 49 atributos contra 49 + 3 de grafo (reciprocidade, profundidade de cadeia, fecha ciclo), com mesma semente, split e hiperparâmetros. AP de teste 0,4657 → 0,4691 (+0,003); precisão 0,642 → 0,617 (−2,5 p.p.); recall por tipologia oscila ±1 a 4 casos, sem ganho consistente. **C não passa na regra de decisão.**
4. **Recomendação inicial: A**. Ela foi implementada e medida numa análise real e depois **descartada** por falta de relevância (seção 5). Decisão final: D, com as correções de texto. C vira trabalho futuro, com o número negativo como evidência.
5. Datasets: **alternativa 1** para os dois (manter e documentar). `dataset_final.zip` **não está no repositório** (fica em `D:\Estudos\...`). Não mencione a telemetria de rede no vídeo.

---

## 1. Diagnóstico

### 1.1 Algoritmos de grafo

| Algoritmo | Arquivo | Entrada | Saída | Complexidade | Quem chama |
|---|---|---|---|---|---|
| Ciclos (DFS iterativa, restrita a cada SCC, heurística do menor vértice) | `src/algoritmos/cycle_detection.py:380` `find_cycles` | `Graph` | `List[CycleResult]` (caminho, categoria CICLO/ANOMALIA, prioridade pelo `type`, valor, perda) | O(V+E) por DFS; enumerar todos os ciclos é exponencial no pior caso (`:270-275`) | CLI `src/main.py:143`, `scripts/benchmark.py:44`, testes (`test_cycle_detection`, `test_escala`, `test_centralidade`, `test_exportador`) |
| `has_cycle` (3 cores) | `cycle_detection.py:529` | `Graph` | bool | O(V+E) | só testes |
| SCC (Kosaraju, 2 DFS iterativas) | `src/algoritmos/scc.py:807` `find_scc` | `Graph` | `List[SCCResult]` (contas, tamanho, volume interno, `is_suspicious = size>1`) | O(V+E) | CLI `main.py:148`, `scripts/benchmark*.py`, `scripts/analise_por_padrao.py:123`, testes |
| Centralidade de grau + risk_score (RN04) | `src/algoritmos/centralidade.py:127` `compute_centrality` | `Graph` + ciclos | `List[AccountCentrality]` | O(V+E+C·P) | CLI `main.py:147`, testes |
| Fan-in/fan-out por janela | `src/algoritmos/fan_detection.py:624` `find_fan_patterns` | `Graph` com `Edge.step` | `List[FanResult]` | O(E log E) | **só** `scripts/benchmark_fan.py:101` e `testes/test_fan_detection.py`. Não aparece em nenhum fluxo real: `main.py` não o importa. |

**Formato de entrada.** O único leitor é `src/leitura/file_reader.py:33` (`load_graph_from_csv`). Ele exige `nameOrig,nameDest,amount` e aceita `step,type,isFraud` como opcionais (`:26`, `:85-87`). O IBM AML usa `Timestamp, From Bank, Account, To Bank, Account, Amount Received/Paid, moedas, Payment Format, Is Laundering`. É um formato diferente, mas **não é obstáculo**:
- já existe `scripts/converter_ibm_aml.py`, que gera `step` em horas (`:201`) e um `type` a partir de `Payment Format` por um mapa arbitrário (`MAPA_TIPOS`, `:81-90`);
- para SCC e ciclos, `type` e `step` são dispensáveis: `Graph.add_edge` aceita `transaction_type=None, step=None` (`src/grafo/graph.py:57-83`).

Achado lateral: `Graph.add_edges_from` descarta o `step` (`graph.py:130-139`). Não afeta nenhum fluxo atual.

**Interface antiga.** `interface/index.html:34-120` contém as 16 transações, os 3 ciclos, os 3 SCCs e a tabela de centralidade **escritos à mão**, inclusive o log `'Iniciando DFS'` (`:3597-3604`). Ela não chama Python para calcular. A saída real da CLI confere com o que está escrito: rodei `python -m src.main --scc` e obtive os mesmos 3 SCCs (4, 3 e 3 contas).

### 1.2 O modelo de ML

**Atributos** (lista em `docs/ml/resultados/treino_lavagem.json:124-173`; cálculo em `src/ml/preparacao.py:316-429`). Todos usam só minutos estritamente anteriores (`preparacao.py:9-14`).

| Família | Atributos | Qtde |
|---|---|---|
| Transação em si | `log_valor_usd`, `sem_taxa_cambio`, `moeda_diferente`, `mesmo_banco`, `auto_transferencia` | 5 |
| Envios da origem | `n_env_origem_6h/24h/72h`, `soma_env_origem_usd_24h`, `n_env_origem_total`, `z_valor_origem`, `min_desde_env_origem` | 7 |
| Destino como emissor | `n_env_destino_24h` | 1 |
| Recebimentos da origem | `n_rec_origem_24h`, `soma_rec_origem_usd_24h`, `razao_saida_entrada_24h`, `min_desde_rec_origem` | 4 |
| Recebimentos do destino | `n_rec_destino_24h/72h`, `min_desde_rec_destino` | 3 |
| Par e contrapartes (grau) | `par_novo`, `n_par_previas`, `dest_distintos_origem`, `orig_distintas_destino` | 4 |
| Indicadores de sem histórico | `sem_historico_env_origem/rec_origem/rec_destino` | 3 |
| **Comportamento (subtotal)** | | **27** |
| Formato (one-hot) | ACH, Bitcoin, Cash, Cheque, Credit Card, Reinvestment, Wire | **7** |
| Moeda de pagamento (one-hot) | 15 moedas | **15** |
| **Total** | | **49** ✔ |

**Treino** (`src/ml/experimentos.py:333-433`, configuração em `src/ml/config.py:47-56`):
- Divisão temporal: treino de 01/09 a 07/09/2022, validação de 07/09 a 09/09, teste de 09/09 a 11/09 e cauda a partir de 11/09, reportada à parte. Tamanhos: treino 3.248.921 (2.530 positivos), validação 965.524 (1.036), teste 862.792 (956), cauda 1.108 (655) (`treino_lavagem.json:199-215`).
- Subamostragem: só negativos do treino, fração de 0,2, com peso 1/0,2 = 5 para os negativos mantidos; validação e teste não são subamostrados (`preparacao.py:444-460`, `config.py:56`).
- Grade: 2 regressões logísticas (C de 0,1 e 1,0), 1 Random Forest e 2 HistGradientBoosting (`src/ml/modelos.py:114-131`).
- Escolhido: `random_forest[n_estimators=100, min_samples_leaf=50, max_samples=0.5]`, com `max_features="sqrt"` (`modelos.py:64`), semente 42. AP na validação: RF 0,4990; HGB 0,4449 e 0,4276; logística 0,1895 e 0,1870 (`treino_lavagem.json:19-122`).
- Critério de seleção: maior AP na validação (`experimentos.py:396`, `:409`). Limiar: maior F1 na validação, 0,09098 (`:410`; `treino_lavagem.json:13-18`).

**Informação estrutural já presente.** Só há estrutura de **1 salto**: grau distinto acumulado (`dest_distintos_origem` e `orig_distintas_destino`, `preparacao.py:405-411`), novidade e contagem do par (`:401-404`) e contagens por conta. **Não há** reciprocidade, grau distinto em janela, caminhos de 2 ou mais saltos, componentes nem ciclos.

### 1.3 Resultados medidos (teste, `docs/ml/resultados/avaliacao_lavagem.json`)

| Referência | Prevalência | Precisão | Recall | F1 | AP | Fonte |
|---|---|---|---|---|---|---|
| Modelo (limiar 0,0910) | 0,1108% | 0,6274 | 0,4069 | 0,4937 | **0,4640** | `:14-26` |
| Baseline prevalência | 0,1108% | 0,0011 | 1,000 | 0,0022 | 0,0011 | `:136-148` |
| Baseline taxa do formato | 0,1108% | 0,0070 | 0,8724 | 0,0139 | 0,0064 | `:228-240` |

Contagens do modelo: 389 VP, 231 FP, 567 FN, 2,68 falsos alertas por 10 mil (`:19-25`).

**Recall por tipologia** (`:378-424`):

| BIPARTITE | CYCLE | FAN-IN | FAN-OUT | GATHER-SCATTER | RANDOM | SCATTER-GATHER | STACK | sem_padrao |
|---|---|---|---|---|---|---|---|---|
| 24/44 = 0,545 | 33/55 = 0,600 | 39/57 = 0,684 | 47/65 = 0,723 | 85/127 = 0,669 | 24/43 = 0,558 | 74/110 = 0,673 | 56/84 = 0,667 | **7/371 = 0,019** |

**Recall por início da tentativa** (`:425-441`): `iniciada_antes` 272/375 = 0,725; `nova` 110/210 = 0,524; `sem_padrao` 0,019.

**Recall@k por dia** (`:105-133`):

| Dia | Positivos | @50 | @100 | @500 | @1000 | @5000 |
|---|---|---|---|---|---|---|
| 09/09 | 514 | 0,097 | 0,183 | 0,440 | 0,539 | 0,712 |
| 10/09 | 442 | 0,109 | 0,210 | 0,500 | 0,615 | 0,830 |

**Cauda (à parte)** (`:444-457`): prevalência de 59%, AP 0,969, precisão 0,961, recall 0,785. Isso é um artefato do gerador, e o relatório o mantém fora das métricas (`docs/ml/RELATORIO_ML.md:243-249`).

**Calibração** (`:350-375`): na faixa de score 0,1 a 0,2, a média prevista é 0,136 e a frequência observada é 0,648. Isso confirma que o score não é probabilidade.

**Ressalvas do próprio sistema** (`RELATORIO_ML.md:299-311`):
- os dados são sintéticos;
- ACH concentra cerca de 87% da lavagem;
- 1.968 dos 5.177 positivos não estão em `Patterns`;
- 206 das 370 tentativas atravessam períodos (por isso `iniciada_antes` é otimista);
- o teste já foi reutilizado na auditoria (seção 6).

**Leitura:** 39% dos positivos do teste (371/956) são `sem_padrao`, e é ali que o recall cai. Entre os positivos com padrão, o recall é de 382/585 = 65%. Os tipos estruturais já estão em 0,55 a 0,72.

### 1.4 O grafo que aparece na tela

`src/painel/armazenamento.py:658-783` (`grafo`):
- **Coleta:** faz BFS por SQL a partir do foco. A jusante segue `no_origem`→destino e a montante segue destino→origem (`:682-713`). A profundidade padrão é 2, com máximo de 3; a fronteira é de 300 contas por salto (`:46-50`, `:671`, `:705-707`).
- **Agrupamento:** uma aresta junta todas as transações com mesma origem, destino e moeda (`:640-643`, `:693-699`). Moedas nunca são somadas.
- **O que se desenha:** no máximo 30 nós e 60 arestas, partindo do foco para fora e com alertas primeiro (`:742-757`).
- **"Ordem temporal":** uma aresta indireta só vira "sequência" se houver transação em minuto posterior à chegada (`:823-925`). No mesmo minuto ela fica como "ordem não confirmada".
- **Disposição:** vem **só da tipologia registrada no dataset** (`HI-Small_Patterns.txt`). CYCLE vira circular; FAN-OUT e FAN-IN viram leque; qualquer outra vira camadas (`:591-601`, `:928-937`). O próprio front diz: "A tipologia nunca é deduzida pela aparência do grafo" (`interface/assets/painel-grafo.js:138-139`). Sem o arquivo de padrões, a disposição é sempre em camadas.
- **Front:** `painel-grafo.js` recebe nós, arestas, totais, tipologias e ordem, e só calcula posição e desenho (`:2`, `:13-31`).

### 1.5 Pontes entre grafo e ML

**Não há pontes no código.** `src/painel/pipeline.py:55-62` importa `EstadoFinanceiro`, `pontuar_lavagem`, `armazenamento`, `score` e `tipologias`. Nada de `src.algoritmos`. A própria documentação já admite isso: `docs/APRESENTACAO_NODEWATCH.md:254` diz que "O ML não usa esses resultados…; os grafos são uma demonstração estática".

**Lugares que dizem "49 atributos"** (todos precisariam mudar se C fosse adotada):
- `README.md:136`, `README.md:517`
- `index.html:240` (site), `site-assets/js/artigo.js:77`, `:195`
- `docs/APRESENTACAO_NODEWATCH.md:39`, `:340`
- `docs/COMO_FUNCIONA_O_NODEWATCH.md:105`, `:388`, `:500` (e os PDFs gerados)
- `src/sentinel_ia.py:427`, `src/painel/contexto_sentinel.py:36`
- `docs/img/arquitetura.svg:39`
- `docs/ml/EVENTOS.md:77`, `:255`, `docs/ml/BENCHMARK_EVENTOS.md:105`, `docs/ml/RELATORIO_ML.md:194`, `:338`, `docs/ml/README.md:106`, `docs/ml/notas_relatorio.md:76`
- `src/ml/incremental.py:3`, `src/ml/analises.py:30`
- `modelos/MANIFESTO_MODELO.json` (`"colunas": 49`) e `scripts/hi_large/*`.

### 1.6 Inventário de datasets e legado

| Arquivo | Formato/esquema | O que representa | Quem lê (código) | Painel novo? | Legado/CLI? | Testes? | Posso apagar sem quebrar? |
|---|---|---|---|---|---|---|---|
| `dados/exemplo_transacoes.csv` (16 tx, versionado) | `step,type,amount,nameOrig,nameDest,isFraud` | demonstração PaySim com 3 ciclos | `src/main.py:27` (`DEFAULT_INPUT`); copiado à mão em `interface/index.html:34-55`; nome padrão em `exportador.py:52` | **Não**: recusado de propósito em `src/painel/datasets.py:201-203` ("não o CSV do grafo antigo") | Sim | Não (os testes montam grafos próprios) | **Não**: `python -m src.main` sem `--input` quebraria |
| `dataset_final.zip` → `dataset_final.csv` (**fora do repo**, em `D:\Estudos\Arquivos NodeWatch\...`; 2 cópias com o mesmo SHA-256 `95cb83b5…`) | `rede_v1`, 28 colunas (`id_fluxo, anchor_id, probe_id, timestamp, split, classe_atual, perda_pct, rtt_*, jitter_*, …, alvo`), **333.954 linhas**, de **28/09/2026 18:00 a 05/10/2026 17:55 UTC** (medido) | telemetria de fluxos de rede | `ml_config.exemplo.toml:13` → `ler_rede` → treino da cabeça `estado_rede` | **Não**: recusado em `datasets.py:197-200` | Sim: resultados em `/legado#ml` via `src/api_ml.py`; a cabeça está dentro de `modelos/modelo_unificado.joblib` (`MANIFESTO_MODELO.json`, `outras_cabecas`) | Não (`test_rede.py` usa CSV sintético) | Não está no repo; nada a apagar |
| `HI-Small_Trans.zip` (fora do repo; `.gitignore` cobre `dados/HI-Small_*`) | `hismall_v1` | 5.078.345 transações sintéticas | `ler_hismall` (treino, avaliação); envio manual no painel | Sim | — | Não | — |
| `HI-Small_Patterns.txt` (fora do repo) | blocos `BEGIN/END LAUNDERING ATTEMPT` | tipologias | avaliação (`experimentos.py:462-480`) e etapa "tipologias" do painel (`pipeline.py:434-439`) | Sim (opcional) | — | Testes usam texto sintético (`testes/painel/conftest.py`) | — |
| `HI-Small_accounts.csv` (fora do repo) | contas | só auditoria | `ler_contas` | Não | — | Não | — |
| `docs/exemplos/*_inventadas*.csv` | `transacao_v1`, HI-Small e `rede_v1` | exemplos de documentação | só o gerador e a documentação | Indiretamente (exemplo de envio) | — | Não | Sim, mas são úteis à documentação |
| `docs/ml/exemplos/previsoes_*_amostra.csv` | previsões | amostras versionadas | `src/ml/exploracao.py:59` (legado "Analisar dataset") | Não | Sim | `test_exploracao.py` cria cópias sintéticas | Quebraria a exploração no legado |
| `modelos/modelo_unificado.joblib` (38 MB, versionado) | joblib, 3 cabeças | modelo distribuído | instalação, `api_*` | Sim | Sim | `test_inferencia_deterministica` | **Não** |

**Rotas.**
- `/` é o painel novo (envio do HI-Small, score, tabela, grafo da conta em foco, Sentinel contextual).
- `/legado` (`src/sentinel_ai.py:98`) tem coisas que só existem lá:
  - grafos de demonstração estáticos com DFS, SCC e centralidade;
  - ML de rede (`#ml`) e "Analisar dataset";
  - Eventos (`#ml/eventos`);
  - chat Sentinel AI antigo.
- O painel não tem link para o legado. Só há o redirecionamento de endereços antigos (`interface/painel.html:10-11`).

**Peso no repositório:** o maior arquivo versionado é o `modelo_unificado.joblib` (cerca de 37,9 MB). O pack inteiro tem 45,2 MB. Os datasets grandes estão fora do git.

**Divergências com a sua descrição:**
- (a) `datasetfinal.zip` não está no repositório, só fora dele.
- (b) Os grafos do `/legado` não são calculados: estão escritos à mão no HTML.
- (c) `exemplo_transacoes.csv` não é lido por nenhum teste.

---

## 2. Random Forest neste projeto

1. **Funcionamento.** São 100 árvores (`n_estimators=100`). Cada árvore treina numa subamostra de 50% das linhas (`max_samples=0.5`). A cada divisão, ela sorteia √49 ≈ 7 atributos candidatos (`max_features="sqrt"`, `modelos.py:64`) e escolhe o corte que mais separa lavagem de normal. Uma folha precisa de pelo menos 50 linhas (`min_samples_leaf=50`). O `predict_proba` é a **média, entre as árvores, da proporção ponderada de lavagem na folha** em que a transação cai. **Não é probabilidade calibrada** por três motivos: o treino foi subamostrado e repesado; as folhas são grandes e ficam rasas; e a média de proporções não corrige o viés. O resultado medido confirma isso: na faixa de 0,1 a 0,2 do score, 65% são lavagem (`avaliacao_lavagem.json:363-366`). Por isso o limiar é escolhido na validação, e não fixado em 0,5.
2. **Uma linha de números.** O RF recebe um `DataFrame` com 49 colunas (`atributos_financeiros` devolve exatamente isso, `preparacao.py:425-429`). Ele não sabe que existem contas nem arestas. Só sabe, por exemplo, que `orig_distintas_destino = 37`.
3. **Como um grafo entra num RF.** Uma propriedade do grafo vira uma **coluna por transação**. O grafo não é "treinado com DFS". No código, os pontos de entrada seriam:
   - lote: um bloco novo em `atributos_financeiros` (`preparacao.py:316-429`), ao lado de "Pares origem→destino" (`:393-411`);
   - incremental: `EstadoFinanceiro._atributos` e `_incorporar` (`src/ml/incremental.py:255`, `:317`). Por exemplo, a reciprocidade é `self.pares.get(d*_PAR+o)` (`:149`, `:292`).
4. **Regra de ouro.** O atributo precisa ser point-in-time: o minuto `t` só vê minutos anteriores a `t`, e o minuto inteiro é pontuado antes de ser incorporado (`incremental.py:11-17`). Precisa também ter estado O(1) ou O(grau) por conta, porque o painel processa minuto a minuto. Isso exclui `find_cycles` (exponencial e global) e `find_scc` sobre o histórico inteiro (recalcular a cada minuto custaria O(V+E) por minuto). Restam versões **locais, com janela e com limite de saltos**: reciprocidade (1 consulta), profundidade de cadeia pela última entrada (estado de 3 números por conta) e ciclo curto com janela (interseção de vizinhanças, caro em contas-hub).
5. **Limitações.**
   - Interpretabilidade: "fecha ciclo de cadeia" é intuitivo, mas o RF o combina com 49 outros, e a importância medida foi quase nula (seção 3).
   - Tempo de cálculo: medido em 3,1 s para 5 milhões de linhas, então barato.
   - Vazamento: qualquer atributo que olhe o mesmo minuto ou o futuro, ou que use `Patterns`/rótulo, contamina o resultado. Os 3 testados usam só minutos anteriores.

---

## 3. Viabilidade

### Experimento de decisão (rodado)

Script: `scripts/experimento_atributos_grafo.py`. Resultado: `docs/ml/resultados/experimento_atributos_grafo.json`. Tempo total: 119 s.

O script usa o mesmo split, a mesma amostragem (semente 42, fração 0,2), os mesmos hiperparâmetros e o mesmo critério de limiar (máximo F1 na validação). Ele importa as funções oficiais (`atributos_financeiros`, `amostrar_treino_financeiro`, `recriar_estimador`, `limiar_max_f1`, `metricas_binarias`).

Os 3 atributos novos (janela de 24 h, só minutos anteriores):
- `g_reciproco`: o destino já enviou à origem antes (ciclo de 2 saltos).
- `g_profundidade_cadeia`: 1 + a profundidade da última entrada na origem, se ela ocorreu nas 24 h anteriores (limite de 20). Cobre STACK e RANDOM.
- `g_fecha_ciclo_cadeia`: a raiz da cadeia que trouxe dinheiro à origem é o próprio destino, ou seja, a transação devolve o dinheiro a quem iniciou a cadeia (ciclo de comprimento qualquer, aproximado pela última entrada).

**Sanidade.** A base reproduz o modelo oficial com diferença pequena: AP de validação 0,4983 contra 0,4990 e de teste 0,4657 contra 0,4640. O ambiente usa Python 3.15.2, enquanto o manifesto registra 3.14.0. Por isso, compare base_49 com grafo_52 **dentro do mesmo experimento**.

| Métrica (teste) | base_49 | grafo_52 | Δ |
|---|---|---|---|
| AP validação | 0,4983 | 0,5045 | +0,006 |
| **AP teste** | 0,4657 | 0,4691 | **+0,003** |
| Precisão | 0,6418 | 0,6165 | **−0,025** |
| Recall | 0,4048 | 0,3985 | −0,006 |
| F1 | 0,4965 | 0,4841 | −0,012 |
| VP / FP | 387 / 216 | 381 / 237 | −6 / +21 |
| recall@1000 em 09/09 e 10/09 | 0,533 / 0,622 | 0,553 / 0,615 | +0,02 / −0,007 |

| Tipologia | base_49 | grafo_52 |
|---|---|---|
| CYCLE | 33/55 | 34/55 (+1) |
| STACK | 56/84 | 55/84 (−1) |
| SCATTER-GATHER | 74/110 | 73/110 (−1) |
| GATHER-SCATTER | 86/127 | 86/127 (=) |
| RANDOM | 23/43 | 20/43 (−3) |
| BIPARTITE | 25/44 | 21/44 (−4) |
| FAN-IN / FAN-OUT | 38/57, 45/65 | 37/57, 46/65 |
| sem_padrao | 7/371 | 9/371 |

- **Sinal dos atributos** no teste: `g_reciproco` = 1 em 7,7% da lavagem contra 2,2% do normal; `g_fecha_ciclo_cadeia` = 1 em 0,42% da lavagem (4 transações) contra 0,004% do normal; a profundidade média é igual (2,70 contra 2,68). Importância no RF: 0,0095, 0,0062 e 0,0.
- **Tempo:** reciprocidade 0,5 s; cadeia 2,6 s (5.078.345 linhas); treino do RF 37,7 s contra 41,6 s.
- **Lote × incremental:** a reciprocidade calculada em lote e a calculada por conjunto incremental deram **0 linhas diferentes em 5.078.345**. A cadeia já é calculada minuto a minuto com estado por conta, então não existe uma versão em lote separada para comparar.
- **Conclusão:** não há ganho real nos tipos de vários saltos, e a precisão cai 2,5 p.p. As diferenças de ±1 a 4 casos estão dentro do ruído de amostras de 43 a 127. Isso foi testado com **3 atributos e uma janela**; não é prova de que nenhum atributo de grafo ajude. Ciclo de 3 saltos com janela e grau distinto em janela **não foram medidos** (custo de implementação maior).

### Tabela por opção

| Item | **D. Deixar como está** | **A. Grafo na apresentação** | **B. Casos de alertas** | **C. Atributos no RF** |
|---|---|---|---|---|
| O que muda | Textos: `index.html` do site (`:112`, `:126-133`, `:165-170`, `:266-283`, `:347-352`), roteiro do vídeo, `docs/APRESENTACAO_NODEWATCH.md` | `armazenamento.grafo` (`:758-783`): monta `Graph` com as arestas desenhadas, chama `find_scc` e `find_cycles` e devolve `estrutura`; `painel-grafo.js` `LegendaGrafo` (`:109-140`) mostra a linha nova | Endpoint novo em `api_painel.py`: união das transações em alerta (union-find ou `find_scc` no SQLite da análise); tela nova em `painel-secoes.js` | `atributos_financeiros`, `EstadoFinanceiro` (`_atributos`, `_incorporar`, `carregar_historico`, `VERSAO_ESTADO`), retreino, novo `modelo_unificado.joblib`, `MANIFESTO_MODELO.json`, cerca de 20 lugares com "49" |
| Esforço | 0,5–1 h (só texto) | impl. 1 h; testes 0,5 h; retreino 0 | impl. 3 h; testes 1 h; UI 1 h | impl. 3 h; testes de equivalência 2 h; retreino e avaliação 1 h; docs 1–2 h |
| Risco | `testes/painel/test_rotas_e_inicio.py:99-109` confere frases de README e docs | Baixo: não toca modelo, estado nem artefatos; risco de testes que comparam o JSON do grafo; ciclos no desenho ignoram tempo | Médio: tela nova perto do prazo | Alto: equivalência lote × incremental (`test_incremental.py`), estado salvo incompatível, SHA do manifesto, textos do Sentinel |
| Como validar | `pytest` inteiro | `pytest testes/painel` + 1 teste novo em `test_armazenamento.py` (triângulo → 1 SCC de 3 e 1 ciclo; caminho sem volta → 0) + verificação no navegador | testes de API novos | `test_incremental`, `test_financeiro`, `test_inferencia_deterministica`, novo experimento |
| Efeito na narrativa | "grafos e ML coexistem; ML usa grau e par" | "o grafo exibido é analisado por Kosaraju/DFS ao vivo; o ML pontua" | "alertas agrupados em casos conectados" | "o modelo usa atributos de grafo" (sem ganho medido) |
| Reversão | `git revert` | `git revert` (1 commit) | `git revert` | reinstalar o modelo de `modelos/` e reverter o commit |

**Adaptador (vale para A, B e C).** Para A, o adaptador tem cerca de 10 linhas: as arestas desenhadas já estão em memória (`desenhadas`, `armazenamento.py:745-757`). Basta `g.add_edge(a["origem"], a["destino"], amount=0.0, transaction_type=None)`.
- **Não use** `amount` somado (as moedas são diferentes) nem `type` (o IBM não tem `TRANSFER/CASH_OUT`; o `MAPA_TIPOS` do conversor é uma convenção inventada).
- Por isso, mostre só os SCCs e os caminhos dos ciclos. Não mostre a "prioridade" de `CycleResult` nem o `risk_score` de `compute_centrality`, que dependem de `type` e competiriam com o score do ML.
- O `exemplo_transacoes.csv` continua útil como demonstração da CLI e da aula. O adaptador não muda o esforço de A (já contado). Em B e C, o peso está em outras partes.

### Decisão sobre os datasets

| | Recomendação | Justificativa |
|---|---|---|
| `dataset_final.zip` | **1. Manter fora do repo e documentar** | O código já declara que não existe vínculo (`modelos.py:255-275`: sem chave comum e sem sobreposição temporal, 2022 × 2026). A cabeça `estado_rede` está dentro do joblib oficial: removê-la exigiria salvar o modelo de novo. Mover o código de rede (alternativa 2) mexe em `api_ml.py`, `ml_config`, `test_rede.py`, `test_confiabilidade_eventos.py` e `api_eventos.py` às 21h: não vale. |
| `exemplo_transacoes.csv` | **1. Manter**; com A, passa a ser também a **alternativa 4** (demonstração da CLI e fixture de aula) | É o `DEFAULT_INPUT` da CLI e está espelhado no legado. Apagar quebra `python -m src.main`. O painel o recusa de propósito (`datasets.py:201-203`), e isso está correto: esse CSV não tem banco, moeda nem tempo real. |

A telemetria de rede **confunde** a narrativa "grafos + ML contra lavagem", porque é outro problema, com outro dataset e outro período. O rodapé do legado ("modelos independentes", `interface/index.html:2150`) está coerente. **O site não está:** o KPI "49 + 21 atributos causais — lavagem + estado de rede" (`index.html:126-128`) soma os dois modelos como se fossem um só.

---

## 4. Decisão e plano

### 4.1 Comparação

| | Alinhamento grafos + ML | Ganho medido | Esforço | Risco | Cabe até 23h? |
|---|---|---|---|---|---|
| D | Fraco, mas honesto | — | 0,5–1 h | Mínimo | Sim |
| **A** | **Bom: os grafos rodam de verdade no painel** | não se aplica (não muda o score) | 1,5 h + D | Baixo | **Sim, com limite de tempo** |
| B | Bom | não medido | 5 h | Médio | Não |
| C | Ótimo no discurso | **medido: +0,003 de AP, −0,025 de precisão, sem ganho por tipologia** | 7–9 h | Alto | Não |

### 4.2 Recomendação: **A** (com as correções de texto de D)

1. As regras de decisão excluem C: o experimento não mostra ganho nos tipos de vários saltos e piora a precisão em 2,5 p.p.
2. Os tipos estruturais já têm recall de 0,55 a 0,72 (`avaliacao_lavagem.json:378-418`). O ganho possível está em `sem_padrao`, que é um problema de rótulo e gerador, não de estrutura.
3. O prazo é curto, então a regra manda preferir A.
4. A torna verdadeira a frase "o painel usa grafos e ML" sem tocar no modelo.

Se às 21h45 o passo 3 do plano não estiver verde, **pare, reverta e fique em D**.

### 4.3 Plano de A (limite de 1h30)

1. `git switch -c feat/estrutura-grafo-painel`. Ponto de verificação: o `pytest` de base passa (473 testes na `main`).
2. `src/painel/armazenamento.py`: crie a função `estrutura_do_desenho(desenhadas)`. Ela monta um `Graph` com as arestas desenhadas (sem valor e sem tipo), chama `find_scc` (só os grupos com mais de 1 conta) e `find_cycles` (no máximo 20 caminhos, `CICLO` apenas). Devolve `{"grupos": [...], "ciclos": [...], "ciclos_total": n, "nota": "Kosaraju e DFS sobre as até 30 contas desenhadas; agrupa transações de qualquer horário; não entra no score e não indica fraude."}`. Inclua `"estrutura"` no `return` (`:773`). O desenho tem no máximo 60 arestas, então o custo é desprezível.
3. Teste em `testes/painel/test_armazenamento.py`: um triângulo A→B→C→A dá 1 grupo de 3 e 1 ciclo; uma cadeia A→B→C dá 0 e 0. Rode `pytest testes/painel -q`.
4. `interface/assets/painel-grafo.js` `LegendaGrafo`: acrescente uma linha. Texto sugerido: "Estrutura do desenho (Kosaraju + DFS): N grupos fortemente conectados, M ciclos. Agrupa horários diferentes; não é a tipologia nem o score." Verifique no navegador e rode `pytest testes/painel/test_interface_revisao.py testes/painel/test_exibicao.py`.
5. Rode `pytest -q` inteiro e faça um commit.
6. Faça os textos de D (seção 4.4) e rode `pytest testes/painel/test_rotas_e_inicio.py`.

Reversão: `git switch main` (nada foi para a `main`) ou `git revert <commit>`.

### 4.4 O que dizer e o que não dizer

**Frase segura (com A):**
> "O NodeWatch usa duas camadas que se complementam. Um Random Forest dá a cada transação um score calculado com 49 atributos que olham só o passado, entre eles a vizinhança da conta na rede: par de contas novo e quantas contrapartes distintas a conta já teve. Para a conta que o analista investiga, o painel monta o grafo das transações e roda algoritmos clássicos, Kosaraju e busca em profundidade, para mostrar grupos fortemente conectados e ciclos. O score não afirma fraude: ele ordena sinais para investigação."

**Frase segura (se ficar em D):** troque a segunda metade por "Os algoritmos de grafos (DFS, Kosaraju, centralidade) estão implementados e testados; no painel, o grafo da conta em foco é a visualização da investigação."

**Afirmações falsas hoje:**
- "o modelo usa grafos/DFS/Kosaraju";
- "o Random Forest foi treinado com grafos";
- "o painel detecta ciclos" (sem A);
- "a disposição circular mostra que detectamos um ciclo" (ela vem da tipologia registrada);
- "a interface antiga calcula os ciclos" (é estática);
- "a telemetria de rede ajuda a detectar lavagem";
- "49 + 21 atributos" como um modelo só;
- "probabilidade de lavagem";
- "detecta fraude".

**Correções concretas no site (`index.html`):**
- `:165-170` ("Modelagem em grafo", etapa 2 entre a ingestão e o ML): a ordem sugere que o grafo alimenta o ML. Mova para depois do score ("4 · Investigação em grafo") ou escreva "o grafo da conta em foco é montado a partir das transações pontuadas".
- `:169`: "ficam visíveis como forma" → (com A) "são calculados no desenho por Kosaraju e DFS".
- `:126-128`: "49 + 21 atributos causais" → "49 atributos causais", nota "modelo de lavagem".
- `:133`: "0,10% de positivos" → "0,11% de positivos no teste" (`avaliacao_lavagem.json:17`). O valor 0,10% é a taxa do dataset inteiro (5.177/5.078.345).
- `:347-352`: na linha de `dataset_final.csv`, acrescente "modelo independente, sem vínculo com as transações".

### 4.5 Datasets e legado

- **Decisão:** alternativa 1 para os dois (4 para `exemplo_transacoes.csv`, se A for feito). Nenhum arquivo é apagado ou movido.
- **Frase para o artigo:** "O repositório também contém um módulo independente, treinado com telemetria de rede da disciplina (`dataset_final.csv`, setembro–outubro de 2026), que prevê o estado da próxima medição de um fluxo. Ele não participa da detecção de lavagem: não há chave comum nem sobreposição temporal com as transações do IBM AML, e a fusão dos dois sinais está registrada como trabalho futuro. A versão inicial do projeto, com os algoritmos de grafos sobre um CSV de 16 transações de exemplo, continua disponível na linha de comando e em `/legado`."
- **No vídeo, não mencione:** a telemetria de rede, o `/legado`, a cauda (AP de 0,969) e o "49 + 21".

### 4.6 Inventário final com destino

| Arquivo | Destino |
|---|---|
| `dados/exemplo_transacoes.csv` | **Manter**: CLI e demonstração; documentar como "exemplo do legado" |
| `dataset_final.zip` | **Manter fora do repo e documentar** (já é assim) |
| `HI-Small_Trans.zip`, `Patterns`, `accounts` | **Manter fora do repo** (`.gitignore` já cobre) |
| `docs/exemplos/*` | **Manter** |
| `docs/ml/exemplos/*_amostra.csv` | **Manter** (legado) |
| `modelos/modelo_unificado.joblib` | **Manter, sem alteração** |
| `interface/index.html` (legado estático) | **Manter e documentar** como "demonstração estática" |
| `src/algoritmos/fan_detection.py` | **Manter e documentar** como "só benchmark e testes" |

### 4.7 Não verificado e perguntas

**Não verificado:**
- ciclo de 3 saltos com janela e grau distinto em janela (não foram medidos);
- a variação do resultado do experimento com outras sementes (rodou uma vez só);
- o conteúdo dos `.docx` e PDFs de `docs/resumos`.

**Perguntas:**
1. O vídeo já foi gravado com alguma frase da lista de afirmações falsas?
2. O professor avalia a disciplina de Grafos pelo código da CLI ou pelo painel?

---

## 5. Opção A: implementada, medida e descartada

**O que foi feito.** Um módulo `src/painel/estrutura.py` montava um `Graph` com as arestas desenhadas da conta em foco e chamava `find_scc` (Kosaraju), `find_cycles` (DFS) e `compute_centrality` (grau). Para cada grupo e cada ciclo, contava os alertas do modelo. O resultado aparecia num bloco na vista Investigação, com destaque no grafo.

**Por que não serve como integração.** O fluxo era: ML → score → SQLite → grafo da conta → algoritmos → contagem de alertas. O score não entra nos algoritmos e o resultado dos algoritmos não muda o score. Na prática, era só informação a mais na tela.

**Medição** (`docs/ml/resultados/estudo_relevancia_estrutura.json`). A medição usou uma análise do LI-Small salva no painel: 6.924.049 transações, 3.565 de lavagem e 2.592 alertas. O SQLite foi aberto só para leitura. O grafo é montado no momento da consulta, e a pontuação (`pipeline.py`, `src/ml`) não mudou, então o resultado é o mesmo que uma análise nova daria.

| | 30 contas do topo de risco | 30 contas sorteadas com alerta |
|---|---|---|
| Grafos com algum grupo fortemente conectado | 1 | 5 |
| Conta em foco dentro de um grupo | 0 | 4 |
| Ciclos (por nº de contas) | 1 (de 2 contas) | 9 (6 de 2, 2 de 3, 1 de 4) |
| Transações dentro de grupos / de lavagem | 2 / 0 | 17 / 4 (todas já com alerta) |
| Lavagem **sem alerta** dentro de grupos | 0 | 0 |
| Lavagem sem alerta fora de grupos | 97 | 5 |
| Conta em foco é a mais central do desenho | 30 | 14 |

**Conclusão.**
- Nas contas que o analista abre primeiro, o bloco quase sempre dizia "nenhum grupo".
- Onde havia grupo, a lavagem que estava nele já tinha alerta. A estrutura não apontou nenhum caso que o modelo deixou passar.
- A centralidade repetia o desenho: o grafo é montado a partir da conta em foco, então ela quase sempre era a mais conectada.
- **Limite da medição:** foram 60 contas de um dataset sintético, com profundidade 2 e o limite de 30 contas desenhadas.

O bloco foi removido. O painel ficou como estava, e os 473 testes da `main` continuam valendo.

**O que ficou:**
- este relatório;
- o experimento (`scripts/experimento_atributos_grafo.py`, `docs/ml/resultados/experimento_atributos_grafo.json`);
- a medição acima;
- as correções do site:
  - a etapa "Investigação em grafo" vem depois do ML;
  - "49" atributos, e não "49 + 21";
  - "0,11% de positivos no teste";
  - o modelo de rede aparece como independente;
- a seção 6.6 de `docs/COMO_FUNCIONA_O_NODEWATCH.md` e a resposta 14 de `docs/APRESENTACAO_NODEWATCH.md`.

**Frase para o vídeo e o artigo:**
> "O NodeWatch modela as transações como um grafo direcionado. O Random Forest usa medidas de grafo calculadas só com o passado, como o grau de entrada e de saída de cada conta e se a aresta entre as duas contas é nova; essas medidas estão entre as mais importantes do modelo. No painel, a rede da conta investigada é explorada salto a salto, e o sistema mostra cadeias com horários compatíveis, inclusive o dinheiro voltando à conta. Os algoritmos clássicos (DFS, Kosaraju e centralidade) estão implementados na linha de comando. Testamos levar ciclos para dentro do modelo e esses algoritmos para a tela, e não houve ganho. O score não afirma fraude: ele ordena sinais para investigação."

**Afirmações falsas:**
- "o modelo usa DFS ou Kosaraju";
- "embutimos os três algoritmos no Random Forest";
- "o painel detecta ciclos ou grupos fortemente conectados";
- "a Ordem no tempo usa DFS";
- "a telemetria de rede ajuda a detectar lavagem".
