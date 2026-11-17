# Diário de Sprint 2 — Implementação do pipeline de ingestão, inferência ML, persistência e testes
**Período:** Semana 2
**Grupo / tema:** Grupo 1 — NodeWatch: pontuação por Machine Learning (escala 0–1000, alerta a partir de 701) com motivos verificáveis e análise temporal de subgrafos egocêntricos sobre o IBM AML `HI-Small`

**Equipe:** Grupo 1 — Guilherme Lombardi, Ryan dos Santos Veloso, Caio Winkler Marangoni, Guilherme Liborio Camargo
**Scrum Master do Sprint:** [PENDENTE: Inserir nome do Scrum Master da Sprint 2]
**Repositório GitHub:** pesquisa em https://github.com/Guilherme-Lombardi/AnaliseComplexidade_DeteccaoFraudes; sistema em https://github.com/NodeWatch-Team/NodeWatch

> Esta sprint **implementa exatamente** o contrato da Sprint 1: o esquema `hismall_v1`, as regras de recusa sem preenchimento silencioso, a janela de 72 h, a conversão do score bruto para 0–1000 com corte em 701, as faixas Baixa/Intermediária/Alta, os motivos verificáveis e o isolamento de `Is Laundering`. **Não se muda** a conversão, as faixas ou as regras do esquema sem justificar e registrar a mudança. O modelo de ML é **o modelo salvo** (`modelos/modelo_unificado.joblib`): não há retreino pela interface. **Não há** subgrafo egocêntrico na tela, interface do analista nem medições comparativas de desempenho — isso é Sprint 3.

### Contrato desta sprint

| | Artefato | Origem / destino |
|---|---|---|
| **Entra** | Especificação formal do pipeline de pontuação: $b \in [0,1] \mapsto s \in \{0,\dots,1000\}$, ancorada em $\theta_{\text{bruto}} \mapsto 701$, faixas 0–300 / 301–700 / 701–1000, motivos verificáveis | Sprint 1 — **implementar exatamente esta especificação** |
| **Entra** | Contrato de entrada `hismall_v1` / `transacao_hismall_v1` + `HI-Small_Patterns.txt` opcional, regras de 72 h e de moedas, isolamento do rótulo | Sprint 1 |
| **Entra** | Dataset `HI-Small` e protocolo de avaliação (divisão temporal; Precisão, Recall, F1, AP) | Sprint 1 |
| **Sai** | Código do pipeline: ingestão e validação de CSV/ZIP, atributos *point-in-time* (janelas até 72 h), inferência em blocos com o modelo salvo, conversão 0–1000, motivos verificáveis, persistência em SQLite, servidor `src/sentinel_ai.py` e API `/api/painel` | Sprint 3 (interface, grafo e desempenho) |
| **Sai** | Testes unitários e funcionais do pipeline (suíte `pytest`) | Sprint 3 e 4 |
| **Sai** | Base de avaliação e referência de rótulos (`Is Laundering` / `HI-Small_Patterns.txt`) isolada das features e pronta para as métricas | Sprint 3 (comparação e métricas no painel) e Sprint 4 (avaliação final) |

**Não sai daqui:** interface do analista, subgrafo egocêntrico com ordem temporal na tela, medições comparativas de desempenho, avaliação final.

- [x] Confirmei que o código implementa a especificação da Sprint 1 sem alterações não documentadas *(única diferença registrada: formato de pagamento vazio é aceito como "Não informado", conforme a seção 2.1 da Sprint 1)*

---

## 1. Implementação do pipeline

- [x] Estrutura de dados do pipeline (etapas, blocos e estado incremental por conta) implementada
- [x] Função de decisão implementada conforme a Sprint 1: $s \geq 701 \iff b \geq \theta_{\text{bruto}}$, faixas e motivos
- [x] Código organizado em módulos separados, reutilizáveis na Sprint 3
- [x] Nomes de campos, faixas e regras no código rastreáveis até a especificação da Sprint 1

**Linguagem/framework usado e estrutura do código:** Python 3.14 (Flask ≥ 3.0, pandas 3.1, NumPy 2.5, scikit-learn 1.9.1, joblib 1.6; SQLite da biblioteca padrão). Frontend React servido pelo mesmo servidor (Sprint 3).

| Módulo | Responsabilidade |
|---|---|
| `src/sentinel_ai.py` | Servidor Flask em `http://127.0.0.1:5000/` (`SENTINEL_HOST`/`SENTINEL_PORT`); registra os blueprints `/api/painel`, `/api/ml` e `/api/ml/eventos`; serve o painel em `/`, a interface antiga em `/legado` e o `/health`. Ao iniciar, instala e valida o modelo (`provisionamento.garantir_modelo`); se falhar, sobe assim mesmo e bloqueia só as novas análises |
| `src/seguranca_local.py` | Recusa pedidos com `Host` não local e pedidos de outra origem às rotas `/api`; sem `Access-Control-Allow-Origin: *` |
| `src/api_painel.py` | Blueprint `/api/painel`: sessão, datasets, análises, transações, grafo, operação e assistente |
| `src/ml/sessoes.py` | Sessão da interface com pulso a cada 15 s e expiração após 150 s sem pulso (`PULSO_S`, `TTL_S`) |
| `src/painel/datasets.py` | Envio, identificação do formato, validação linha a linha, limites de tamanho e SHA-256 do arquivo |
| `src/painel/pipeline.py` | Gerenciador da análise: 6 etapas medidas, blocos de 20.000 transações, cancelamento em ponto seguro, manifesto, retenção de 20 análises |
| `src/ml/incremental.py` | `EstadoFinanceiro`: atributos *point-in-time* minuto a minuto (janelas de envio 6/24/72 h, recebimento 24/72 h, soma 24 h) e marca `historico_incompleto` |
| `src/ml/preparacao.py` | Preparador financeiro (câmbio implícito, quantis p99 do treino, taxa por formato) e regras dos motivos verificáveis |
| `src/ml/previsao.py` | `pontuar_lavagem`: score bruto da cabeça `lavagem` e motivos só para quem passa o limiar |
| `src/ml/provisionamento.py` | Instala o modelo de `modelos/` (ou baixa) e confere o SHA-256 do artefato e dos metadados contra `MANIFESTO_MODELO.json` |
| `src/painel/score.py` | Conversão 0–1000, faixas, aviso de que nada é bloqueado e descrição da conversão para o manifesto |
| `src/painel/armazenamento.py` | Esquema SQLite, gravação em lote (`Gravador`), índices, filtros, consultas da visão geral e detalhes |
| `src/painel/tipologias.py` | Leitura de `HI-Small_Patterns.txt` e casamento com as transações (só exibição e avaliação) |

**Etapas da análise (todas medidas, nenhuma simulada)** — `src/painel/pipeline.py`:

1. `leitura` — leitura e validação do arquivo em blocos de 200.000 linhas (progresso em bytes);
2. `ordenacao` — ordenação cronológica (empate pela linha do arquivo) e IDs de exibição;
3. `tipologias` — casamento com o arquivo de padrões (pulada se não houver);
4. `pontuacao` — por blocos de 20.000 transações, terminando na virada do minuto: atributos (estado incremental) → inferência com o modelo salvo → conversão do score e motivos → gravação no SQLite;
5. `indices` — índices dos campos filtráveis e contagens gerais;
6. `manifesto` — gravação atômica do manifesto (id, dataset com SHA-256, modelo com versão e limiar, conversão do score, contagens por faixa, desempenho, erros, retenção).

Estados finais: `concluida`, `cancelada` (a pedido do analista), `parcial` (sessão expirada ou servidor reiniciado; vale o que foi gravado) e `erro` (com causa e ação).

**Endpoints implementados (prefixo `/api/painel`)**

| Método | Rota | Função |
|---|---|---|
| GET | `/estado` | Estado do servidor, do modelo e da política de sessão |
| POST | `/sessao` | Abre a sessão da interface |
| POST | `/sessao/pulso` | Heartbeat: renova a sessão (sem pulso por 150 s, ela expira e a análise dela para no próximo ponto seguro) |
| POST | `/sessao/encerrar` · GET `/sessao` | Encerra / consulta a sessão |
| GET, POST | `/datasets` | Lista / envia um dataset (multipart) |
| GET | `/datasets/<did>` · POST `/datasets/<did>/validar` | Consulta / valida um dataset |
| GET, POST | `/analises` | Lista / inicia uma análise (uma por vez) |
| GET | `/analises/<aid>` | Manifesto e progresso |
| POST | `/analises/<aid>/cancelar` · `/analises/<aid>/assumir` | Cancela / assume a análise de outra aba |
| GET | `/analises/<aid>/fluxo`, `/visao`, `/transacoes`, `/transacoes/<id>`, `/grafo` | Consultas sobre o SQLite da análise |
| GET | `/operacao/desempenho`, `/operacao/logs`, `/operacao/metricas` | Desempenho, logs e métricas |
| POST | `/assistente/verificar` · `/assistente` | Assistente de Dúvidas (Sentinel AI) |

**Validação sem imputação silenciosa** — `datasets.py::ler_validando`. Cada linha é verificada pelas regras da Sprint 1 (data, banco inteiro, conta e moeda não vazias, valores numéricos entre 0 e $10^{15}$, rótulo 0/1, identificador não vazio e único). A linha que viola uma regra é **recusada**, nunca corrigida. Para cada problema, o sistema registra a coluna original, o motivo, a linha e o valor de exemplo, o número de linhas afetadas e "como corrigir". O dataset fica `valido`, `valido_com_recusas` ou `invalido` (quando nenhuma linha passa). Cabeçalho errado, separador `;`, codificação diferente de UTF-8, CSV malformado, telemetria de rede e o CSV PaySim antigo recusam o arquivo inteiro com explicação.

**SHA-256** — dois usos:
- do **dataset**: `datasets.py::sha256_arquivo`, gravado em `manifesto.json` → `dataset.sha256`;
- do **modelo**: `provisionamento.py` confere o artefato e os metadados contra `MANIFESTO_MODELO.json` (`sha256` = `7cbbfd39…059ff`) antes de servir.

**Isolamento de `Is Laundering`** — a coluna é mapeada para `rotulo` (`MAPA_HISMALL`) e guardada numa coluna própria do SQLite. No laço de pontuação (`pipeline.py`), o dicionário entregue a `EstadoFinanceiro.receber` contém só tempo, bancos, contas, valores, moedas e formato: **o rótulo não entra no estado, nos atributos nem no modelo**. Ele só é lido **depois** de `score` e `alerta` estarem calculados, para contar VP/FP/FN parciais. O mesmo vale para as tipologias.

**Esquema SQLite (por análise)** — `armazenamento.py::_ESQUEMA`:

| Tabela | Colunas principais |
|---|---|
| `transacoes` | `id_exibicao` (PK), `linha_arquivo`, `id_original`, `minuto`, `banco_origem`, `conta_origem`, `no_origem` (`banco-conta`), `banco_destino`, `conta_destino`, `no_destino`, `valor_pago`, `moeda_pagamento`, `valor_recebido`, `moeda_recebimento`, `formato`, `score` (0–1000), `score_bruto`, `alerta`, `motivos`, `historico_incompleto`, `rotulo` (nulo sem rótulo), `tipologias`, `tentativas`, `extras` |
| `tipologia_tx` | `(tipologia, id_exibicao)` — índice de tipologia por transação |
| `meta` | Chave/valor da análise |

Índices: `ix_resumo` (score, formato, minuto, rotulo, tipologias, moeda, valor), `ix_minuto`, `ix_no_origem`, `ix_no_destino`, contas, bancos, moeda e valor. Gravação em lote com `PRAGMA journal_mode=WAL` e `synchronous=NORMAL`; ao fechar, o banco volta a `journal_mode=DELETE`.

**Evidências (link do repositório/commit):** `f526dc1` (esquemas versionados e validação), `82134d1` (métricas por classe), `1575c3d` e `0adb46b` (modelo distribuído com manifesto, instalação e validação), `4d3d331` (backend do painel), `be6ce9f` (testes da API, pipeline, rotas, sessão e acesso local), `e973a4d` (inferência determinística) — repositório `NodeWatch-Team/NodeWatch`.

## 2. Testes unitários e funcionais

- [x] Casos de teste cobrindo: CSV válido pontuado e persistido, linhas inválidas recusadas e listadas, histórico < 72 h marcado, score no limiar → 701, dataset sem `Is Laundering`
- [x] Casos de borda dos exemplos manuais da Sprint 1 reproduzidos no código (fronteiras das faixas, limiar exato, ordem temporal, moedas separadas)
- [x] Todos os testes passando; falhas documentadas e corrigidas

**Execução registrada (15/11/2026, Python do `.venv`, Windows 11):**
- `pytest testes/painel testes/ml/test_inferencia_deterministica.py testes/ml/test_incremental.py testes/ml/test_financeiro.py -q` → **269 passed** em 57 s.
- `pytest -q` (suíte inteira) → **473 passed** em 104 s.

> Os testes do painel usam um modelo de teste (`ModeloDeTeste`, "regra fixa de teste", limiar 0,5) construído sobre o preparador real, para que o resultado seja previsível. O modelo distribuído é coberto pelos testes de inferência determinística e de provisionamento.

**Tabela de casos de teste automatizados:**

| Caso | Entrada | Esperado | Resultado obtido | Passou? |
|---|---|---|---|---|
| 1 — CSV válido pontuado e persistido no SQLite | Cenário de 13 transações `hismall_v1` com `Patterns` (`test_pipeline.py::test_analise_completa_registra_etapas_reais_e_manifesto`; `test_api_painel.py::test_fluxo_completo_pela_api`) | 6 etapas concluídas; 13 lidas = válidas = pontuadas; manifesto com SHA-256 de 64 caracteres, versão e limiar do modelo; transações consultáveis pela API | `lidas=validas=pontuadas=13`, `alertas=5`, `por_faixa = {baixa: 7, intermediaria: 1, alta: 5}`; manifesto sem `.tmp`; `/transacoes?alerta=sim` devolve 5 | Sim |
| 2 — Linhas inválidas recusadas e listadas | 9 linhas: data em formato errado, banco "ITAU", conta vazia, valor −5, valor "dez", rótulo 7, moeda vazia + 2 válidas (`test_datasets.py::test_tipos_datas_e_valores_invalidos_indicam_coluna_linha_e_correcao`) | `valido_com_recusas`; 7 recusadas, cada uma com coluna, linha, valor e dica de correção | `{lidas: 9, validas: 2, recusadas: 7}`; problemas em `Timestamp`, `From Bank`, `Account`, `Amount Paid`, `Amount Received`, `Is Laundering`, `Payment Currency` | Sim |
| 2b — Todas as linhas inválidas | 2 linhas inválidas (`test_todas_as_linhas_invalidas_torna_o_dataset_invalido`) | Dataset `invalido` | `invalido`, "nenhuma das 2 linhas" | Sim |
| 3 — Histórico < 72 h marcado | Cenário de 13 transações num único dia (`test_fluxo_completo_pela_api`) | Transação em alerta com `historico_incompleto = true` | `t["historico_incompleto"] is True` | Sim |
| 3b — Janelas de 72 h e mesmo minuto | Bordas das janelas e transações no mesmo minuto (`test_incremental.py::test_bordas_das_janelas_e_mesmo_minuto`; `test_incremental_do_zero_igual_ao_lote`) | Estado incremental igual ao cálculo em lote; o minuto não enxerga a si mesmo | Iguais | Sim |
| 4 — Score bruto no limiar → exatamente 701 (`⚠`) | $b \in \{0,\ \theta^-,\ \theta,\ 1\}$ para 5 limiares, incluindo 0,0909838927 (`test_score.py::test_conversao_ancorada_no_limiar`) | `[0, 700, 701, 1000]`; monótona em 20.000 valores; `b >= θ` ⇔ `s >= 701` | Igual ao esperado nos 5 limiares | Sim |
| 4b — Fronteiras das faixas | 0, 300, 301, 700, 701, 1000 (`test_faixas_nas_fronteiras`; `test_faixas_sem_lacunas_nem_sobreposicao`) | baixa, baixa, intermediária, intermediária, alta, alta; cada inteiro em exatamente uma faixa | Igual | Sim |
| 4c — Não é multiplicação por 1000 | $b = 0{,}091$ com o limiar real (`test_conversao_nao_e_multiplicacao_por_mil`) | $s \geq 701$ (alerta), não 91 | $s \geq 701$ | Sim |
| 4d — Score/limiar fora da escala | $s = -1$ ou 1001; limiar 0 ou 1; bruto NaN ou > 1 (`test_score_fora_da_escala_e_recusado`, `test_limiar_invalido`, `test_bruto_invalido`) | `ValueError` (nunca corrigido) | `ValueError` | Sim |
| 5 — Dataset sem `Is Laundering` | Mesmo cenário sem a última coluna (`test_api_painel.py::test_sem_rotulo_nao_ha_metricas_do_dataset`) | Análise concluída; 5 alertas (os mesmos do cenário com rótulo); métricas do dataset indisponíveis com motivo | `visao.alertas.n == 5`; `do_dataset.disponivel is False`, "não tem rótulo" | Sim |
| 6 — Rótulo separado da previsão | Cenário com rótulo (`test_armazenamento.py::test_rotulo_do_dataset_fica_separado_da_previsao`) | `rotulo` e `alerta` em campos próprios; legenda "não é previsão" | 4 rotuladas, 4 com alerta; campos separados | Sim |
| 7 — Moedas não somadas | Pares com moedas diferentes (`test_armazenamento.py::test_grafo_direcao_valores_e_agrupamento_sem_misturar_moedas`) | Uma aresta por (origem, destino, moeda) | Igual | Sim |
| 8 — Inferência determinística | Floresta com várias threads × uma thread (`testes/ml/test_inferencia_deterministica.py`) | Mesmo score bit a bit | Igual | Sim |
| 9 — Heartbeat da sessão | Pulsos e ausência de pulso (`test_sessao_e_acesso.py::test_pulso_renova_e_a_sessao_expira_sem_ele`; `test_analise_para_em_ponto_seguro_quando_a_sessao_expira_e_nao_e_retomada`) | Pulso renova; sem pulso a sessão expira e a análise fica `parcial` | Igual | Sim |
| 10 — Acesso local | `Host` externo, origem cruzada, CORS (`test_host_nao_local_e_recusado`, `test_pre_verificacao_cors_de_outra_origem_e_recusada_e_nao_ha_curinga`) | Recusado; sem curinga | Recusado | Sim |

## 3. Validação da especificação implementada

- [x] Comparação entre a especificação formal da Sprint 1 e o comportamento observado no código
- [x] Divergências encontradas documentadas e resolvidas (no código ou na especificação, com justificativa)

| Item da Sprint 1 | Comportamento no código | Situação |
|---|---|---|
| $s(b)$ linear por partes, âncoras 0 / 700 / 701 / 1000 | `score.py::converter` com `floor` e `min`; testado | Igual |
| Faixas 0–300 / 301–700 / 701–1000 | `CORTE_BAIXA = 300`, `CORTE_INTERMEDIARIA = 700`, `SCORE_ALERTA = 701` | Igual |
| Alerta $\iff b \geq \theta$ | `pipeline.py`: `alerta = (bruto >= limiar)`; teste prova equivalência com `s >= 701` | Igual |
| Motivos só com alerta | `previsao.py::pontuar_lavagem` ("só para quem passa o limiar") | Igual |
| `historico_incompleto` se $t - t_0 < 4320$ min | `incremental.py:231` | Igual |
| Recusa de linhas sem preenchimento | `datasets.py::ler_validando` | Igual |
| Formato de pagamento vazio | Aceito como "Não informado", com aviso | Igual à Sprint 1 (registrado lá como decisão do código) |
| Formato de pagamento desconhecido | Aceito e sinalizado como "fora do treino" (não é recusa) | **Diferente do prompt desta sprint**, que pede "formato inválido recusado"; o código prevalece |
| Rótulo fora das features | `pipeline.py` não passa `rotulo` ao estado | Igual |
| Moedas não somadas | Agrupamento por `moeda_pagamento` no SQLite | Igual |

**Divergências encontradas e como foram resolvidas:** a única diferença com o pedido desta sprint é o **formato de pagamento**: o código recusa linhas com data, banco, conta, moeda, valor ou rótulo inválidos, mas **não** recusa formato vazio ou desconhecido (vira "Não informado" ou fica sinalizado como fora do treino). A especificação da Sprint 1 já registrava esse comportamento; nada foi alterado no código.

## 4. Preparação da base de avaliação e referência de rótulos (`Is Laundering` / `HI-Small_Patterns.txt`)

- [x] Ground truth (rótulo por transação e tipologia por tentativa) carregado e guardado separado das features
- [x] Métricas de referência registradas: Precisão, Recall, F1 e Average Precision do modelo distribuído e dos baselines
- [x] Esses números serão a referência no comparativo da Sprint 3

**Como o ground truth é isolado (contrato para a Sprint 3):**

1. **Rótulo por transação.** `Is Laundering` (ou `rotulo`) é opcional. Quando existe, vai para a coluna `rotulo` do SQLite e **não** é entregue ao `EstadoFinanceiro`. Sem a coluna, `rotulo` fica nulo e a análise roda igual.
2. **Tipologias.** `HI-Small_Patterns.txt` é lido na etapa `tipologias`, depois da ordenação e antes da pontuação, e só preenche `tipologias`, `tentativas` e a tabela `tipologia_tx`. Arquivo ilegível não inventa tipologias (`test_arquivo_de_padroes_ilegivel_nao_inventa_tipologias`). A tipologia nunca é atributo e nunca é deduzida da forma do grafo.
3. **Métricas do dataset.** `GET /api/painel/operacao/metricas?analise=<aid>` calcula VP, FP e FN direto no SQLite com o corte `score >= 701` e o Average Precision com `sklearn.metrics.average_precision_score`. Sem rótulo, devolve `disponivel: false` com o motivo, e as métricas históricas nunca são apresentadas como resultado do dataset.
4. **Contagens parciais.** Durante a pontuação, VP/FP/FN são acumulados bloco a bloco **depois** do score, para o log e o progresso.

**Referência de rótulos no `HI-Small` (verificado em `docs/ml/RELATORIO_ML.md`):** 5.177 positivos em 5.078.345 transações; 370 tentativas em 8 tipologias; 1.968 positivos sem padrão.

**Métricas de referência do modelo distribuído** (cabeça `lavagem`, versão `lavagem-20261102T083253Z`, Random Forest com 100 árvores, `min_samples_leaf=50`, `max_samples=0.5`, 49 atributos; escolhido pelo maior AP na validação; limiar pelo maior F1 na validação, $\theta_{\text{bruto}} = 0{,}09098$). Conjunto de teste temporal (09/09 a 11/09/2022; 862.792 transações; prevalência 0,1108%) — `docs/ml/resultados/avaliacao_lavagem.json`:

| Referência | Precisão | Recall | F1 | Average Precision |
|---|---|---|---|---|
| Modelo (corte em 701) | 0,6274 | 0,4069 | 0,4937 | **0,4640** |
| Baseline prevalência | 0,0011 | 1,000 | 0,0022 | 0,0011 |
| Baseline taxa do formato | 0,0070 | 0,8724 | 0,0139 | 0,0064 |

Contagens do modelo no teste: 389 VP, 231 FP, 567 FN (2,68 falsos alertas por 10 mil transações).

**Recall por tipologia (teste):**

| BIPARTITE | CYCLE | FAN-IN | FAN-OUT | GATHER-SCATTER | RANDOM | SCATTER-GATHER | STACK | sem_padrao |
|---|---|---|---|---|---|---|---|---|
| 24/44 = 0,545 | 33/55 = 0,600 | 39/57 = 0,684 | 47/65 = 0,723 | 85/127 = 0,669 | 24/43 = 0,558 | 74/110 = 0,673 | 56/84 = 0,667 | 7/371 = 0,019 |

Esses números são o "antes" da Sprint 3: o painel, ao pontuar o mesmo período com o mesmo modelo, deve reproduzi-los dentro da diferença causada pela falta de histórico anterior ao arquivo (`historico_incompleto`).

## 5. Scrum

- [ ] Atualizações semanais no board
- [ ] Board refletindo o estado real

**Link do board:** [PENDENTE: Inserir link do board (Jira/Trello/GitHub Projects)]

## 6. Diário de bordo (retrospectiva individual)

| Integrante | O que fiz nesta Sprint | Dificuldades | O que pretendo manter/ajustar |
|---|---|---|---|
| Guilherme Lombardi | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |
| Ryan dos Santos Veloso | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |
| Caio Winkler Marangoni | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |
| Guilherme Liborio Camargo | [PENDENTE: Inserir registro diário] | [PENDENTE: Inserir dificuldades/ impedimentos] | [PENDENTE: Inserir o que manter/ajustar] |

---

## Rubrica de avaliação — Sprint 2 (nota de 0 a 4,0)

| Critério | Peso | O que caracteriza nota máxima | Nota atribuída | Observações |
|---|---|---|---|---|
| Implementação do autômato | 1,5 | Código fiel à especificação da Sprint 1, organizado e reutilizável | | |
| Testes unitários e validação da linguagem | 1,0 | Cobertura de casos aceitos/rejeitados/borda; divergências resolvidas | | |
| Baseline sem filtro preparado | 1,0 | DFS/Kosaraju puro rodando, métricas registradas | | |
| Scrum + diário de bordo | 0,5 | Board com histórico; diário reflexivo de todos | | |
| **Nota final da Sprint 2** | **4,0** | | **___ / 4,0** | |

> **Correspondência com o escopo atual** (a rubrica foi mantida literalmente, como fornecida pela disciplina): "Implementação do autômato" → seção 1 (pipeline de ingestão, inferência, score e persistência); "Testes unitários e validação da linguagem" → seções 2 e 3 (testes do pipeline e validação da especificação); "Baseline sem filtro preparado" → seção 4 (base de avaliação, referência de rótulos e métricas de referência do modelo e dos baselines).

---

## Registro de Revisão e Sincronização com o Código

| Seção / Item | Antes | Depois | Evidência no Código |
|---|---|---|---|
| Título e tema | "Implementação do DFA/CEP"; pré-filtro para Kosaraju | "Implementação do pipeline de ingestão, inferência ML, persistência e testes" | RFC v1.0; Sprint 1 v5 |
| Equipe | Em branco | 4 integrantes (o prompt pedia 5; Julia Emily Leonardo Barbosa saiu do grupo) | Informação da equipe |
| Repositório | "(link)" | Pesquisa + `NodeWatch-Team/NodeWatch` | `git remote -v` |
| Contrato | Código do autômato, testes de palavras, baseline DFS/Kosaraju | Pipeline completo, suíte `pytest`, base de avaliação e referência de rótulos | `src/painel/pipeline.py`, `testes/` |
| Seção 1 | Tabela de transição / motor CEP | 13 módulos reais, 6 etapas, endpoints `/api/painel/*`, esquema SQLite | `src/sentinel_ai.py`, `src/api_painel.py`, `src/painel/*.py`, `src/ml/*.py` |
| Heartbeat | Resumo: `/sessao/pulso` | `POST /api/painel/sessao/pulso`; pulso de 15 s, expiração em 150 s | `src/api_painel.py:308`, `src/ml/sessoes.py` (`PULSO_S`, `TTL_S`) |
| Bloco de pontuação | — | 20.000 transações, terminando na virada do minuto; leitura em blocos de 200.000 linhas | `pipeline.py` (`BLOCO`), `datasets.py` (`LINHAS_POR_BLOCO`) |
| Esquema SQLite | — | Tabelas `transacoes`, `tipologia_tx`, `meta`; 10 índices; WAL na gravação | `armazenamento.py` (`_ESQUEMA`, `_INDICES`, `Gravador`) |
| SHA-256 | — | Do dataset (manifesto da análise) e do modelo (contra `MANIFESTO_MODELO.json`) | `datasets.py::sha256_arquivo`, `provisionamento.py` |
| Isolamento do rótulo | — | `rotulo` fora do dicionário de `EstadoFinanceiro.receber`; usado só depois do score | `pipeline.py` (laço de pontuação) |
| Motivos verificáveis | — | 8 regras, só com alerta | `preparacao.py::motivos`, `previsao.py::pontuar_lavagem` |
| Seção 2 | Testes de palavras aceitas/rejeitadas | 10 casos (14 linhas) ligados a testes reais, com resultado da execução | `testes/painel/*.py`, `testes/ml/*.py` |
| Resultado dos testes | — | 269 testes dos módulos citados e 473 na suíte inteira, todos passando (15/11/2026) | `pytest -q` |
| Modelo nos testes do painel | — | `ModeloDeTeste` (regra fixa, limiar 0,5) sobre o preparador real | `testes/painel/conftest.py` (`fabrica_modelo`) |
| Formato de pagamento | Prompt: "formato inválido recusado" | Vazio → "Não informado"; desconhecido → sinalizado; nenhum dos dois recusa | `datasets.py::ler_validando`; `pipeline.py:565-566` (`moedas_fora_do_treino`, `formatos_fora_do_treino`) |
| Seção 3 | Validação da linguagem regular | Validação da especificação da Sprint 1 item a item | Tabela da seção 3 |
| Seção 4 | Baseline sem filtro (DFS/Kosaraju) | Preparação da base de avaliação e referência de rótulos; métricas do modelo e dos baselines | `api_painel.py::_metricas_do_dataset`, `docs/ml/resultados/avaliacao_lavagem.json` |
| Diário de bordo | Linha vazia | 4 integrantes | — |
| Rubrica | Texto original | Mantida literalmente, com nota de correspondência | — |

- [REVISAR: o prompt desta sprint pede "linhas com formato/moeda/valor inválido recusadas". No código, moeda e valor inválidos são recusados, mas formato de pagamento vazio ou desconhecido é aceito ("Não informado" ou sinalizado como fora do treino). A equipe deve decidir se mantém esse comportamento (documentado aqui e na Sprint 1) ou se passa a recusar formato vazio, como diz `docs/ml/ANALISE_DATASETS.md:69`.]
- [REVISAR: as métricas de referência da seção 4 vêm da avaliação oficial do modelo (`avaliacao_lavagem.json`), não de uma análise rodada no painel. A Sprint 3 deve registrar a métrica do painel no mesmo período e explicar a diferença causada por `historico_incompleto`.]
- [REVISAR: a rubrica foi mantida literalmente ("autômato", "linguagem", "DFS/Kosaraju puro"); confirmar com o docente se a nota de correspondência basta.]
