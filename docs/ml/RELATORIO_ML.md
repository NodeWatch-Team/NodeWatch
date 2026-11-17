# Relatório de ML — NodeWatch

Gerado por `python -m src.treino.cli relatorio` a partir de `artefatos_ml/`. Todos os números abaixo foram calculados na execução registrada; nenhum foi digitado à mão.

Ambiente: modulo_ml 0.1.0, python 3.14.0, numpy 2.5.4, pandas 3.1.0, scikit-learn 1.9.1, joblib 1.6.0.

| cabeça do modelo | status |
| --- | --- |
| lavagem | treinada |

## 1. Tarefa `lavagem` — IBM AML HI-Small (sintético)

### 1.1 Auditoria

| item | valor |
| --- | --- |
| transações / positivos | 5.078.345 / 5.177 |
| período | 2022-09-01 00:00:00 a 2022-09-18 16:18:00 |
| contas distintas | 515.088 |
| duplicatas exatas | 9 |
| auto-transferências (positivos) | 591.212 (11) |
| moeda de pagamento ≠ recebimento | 72.170 |
| dias com volume < 1% da mediana | 2022-09-11, 2022-09-12, 2022-09-13, 2022-09-14, 2022-09-15, 2022-09-16, 2022-09-17, 2022-09-18 |
| arquivos pendentes | — |

| split | transações | positivos | taxa |
| --- | --- | --- | --- |
| treino | 3.248.921 | 2.530 | 0,0008 |
| validacao | 965.524 | 1.036 | 0,0011 |
| teste | 862.792 | 956 | 0,0011 |
| cauda | 1.108 | 655 | 0,5912 |
| fora | 0 | 0 | — |

| formato | transações | positivos | taxa |
| --- | --- | --- | --- |
| ACH | 600.797 | 4.483 | 0,0075 |
| Bitcoin | 146.091 | 56 | 0,0004 |
| Cash | 490.891 | 108 | 0,0002 |
| Cheque | 1.864.331 | 324 | 0,0002 |
| Credit Card | 1.323.324 | 206 | 0,0002 |
| Reinvestment | 481.056 | 0 | 0,0000 |
| Wire | 171.855 | 0 | 0,0000 |

Atributos de conta (vazamento):

| atributo | AP validação | lift máx. | suspeito |
| --- | --- | --- | --- |
| tipo_entidade_origem | 0,0012 | 1,7682 | não |
| tipo_entidade_destino | 0,0011 | 1,1434 | não |
| n_contas_entidade_origem | 0,0012 | 3,0034 | não |
| n_contas_entidade_destino | 0,0017 | 3,2608 | não |

Padrões: 370 tentativas, 3209 de 3209 linhas casadas com transações; 1968 positivos sem padrão; 206 tentativas atravessam splits.

### 1.2 Seleção na validação

Escolhido: **random_forest[n_estimators=100,min_samples_leaf=50,max_samples=0.5]**; limiar 0,090984 (máximo F1 na validação). 49 atributos.

| configuração | AP validação | F1 no limiar | precisão | recall | s |
| --- | --- | --- | --- | --- | --- |
| prevalencia | 0,0011 | — | — | — | — |
| taxa_do_formato | 0,0068 | 0,0151 | 0,0076 | 0,8591 | — |
| logistica[C=0.1] | 0,1895 | 0,2897 | 0,2282 | 0,3967 | 5,0000 |
| logistica[C=1.0] | 0,1870 | 0,2862 | 0,2298 | 0,3793 | 4,8000 |
| random_forest[n_estimators=100,min_samples_leaf=50,max_samples=0.5] | 0,4990 | 0,5183 | 0,6384 | 0,4363 | 27,8000 |
| hist_gradient_boosting[max_iter=300,learning_rate=0.1,max_leaf_nodes=31,l2_regularization=1.0] | 0,4449 | 0,5017 | 0,6211 | 0,4208 | 11,9000 |
| hist_gradient_boosting[max_iter=300,learning_rate=0.1,max_leaf_nodes=63,l2_regularization=1.0] | 0,4276 | 0,4967 | 0,6461 | 0,4035 | 14,0000 |

### 1.3 Teste (artefato congelado)

| referência | AP | precisão | recall | F1 | falsos/10 mil | VP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prevalência | 0,0011 | 0,0011 | 1,0000 | 0,0022 | 9988,9197 | 956 | 861.836 | 0 |
| taxa do formato | 0,0064 | 0,0070 | 0,8724 | 0,0139 | 1371,8370 | 834 | 118.361 | 122 |
| modelo escolhido | 0,4640 | 0,6274 | 0,4069 | 0,4937 | 2,6774 | 389 | 231 | 567 |

Capacidade de investigação (top-k por dia):

| dia | transações | positivos | recall@50 | recall@100 | recall@500 | recall@1000 | recall@5000 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2022-09-09 | 654.467 | 514 | 0,0973 | 0,1829 | 0,4397 | 0,5389 | 0,7121 |
| 2022-09-10 | 208.325 | 442 | 0,1086 | 0,2104 | 0,5000 | 0,6154 | 0,8303 |

Calibração do score no teste: Brier 0,000967, ECE 0,000964.

Recall por tipo de padrão (positivos do teste, no limiar):

| tipo | positivos | detectados | recall |
| --- | --- | --- | --- |
| BIPARTITE | 44 | 24 | 0,5455 |
| CYCLE | 55 | 33 | 0,6000 |
| FAN-IN | 57 | 39 | 0,6842 |
| FAN-OUT | 65 | 47 | 0,7231 |
| GATHER-SCATTER | 127 | 85 | 0,6693 |
| RANDOM | 43 | 24 | 0,5581 |
| SCATTER-GATHER | 110 | 74 | 0,6727 |
| STACK | 84 | 56 | 0,6667 |
| sem_padrao | 371 | 7 | 0,0189 |

| tentativa | positivos | detectados | recall |
| --- | --- | --- | --- |
| iniciada_antes | 375 | 272 | 0,7253 |
| nova | 210 | 110 | 0,5238 |
| sem_padrao | 371 | 7 | 0,0189 |

### 1.4 Cauda do gerador (fora das métricas principais)

| referência | AP | precisão | recall | F1 | falsos/10 mil | VP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prevalência | 0,5912 | 0,5912 | 1,0000 | 0,7431 | 4088,4477 | 655 | 453 | 0 |
| taxa do formato | 0,5912 | 0,5912 | 1,0000 | 0,7431 | 4088,4477 | 655 | 453 | 0 |
| modelo escolhido | 0,9690 | 0,9607 | 0,7847 | 0,8639 | 189,5307 | 514 | 21 | 141 |

## 2. Leitura dos resultados (execução de 02/11/2026)

Esta execução incorpora as correções da auditoria de 02/11/2026 (seção 4). Os números da lavagem mudaram em relação a 26/10 porque o atributo `z_valor_origem` foi corrigido e o modelo foi retreinado.

O módulo didático de telemetria de rede (`estado_rede`) e o lugar reservado da fusão rede ↔ transação foram removidos em 17/11/2026. As seções sobre eles saíram deste relatório e continuam no histórico do Git (até o commit `1a7a119`).

### Lavagem
- **Desempenho.** No teste, a AP é 0,464, contra 0,0064 do baseline "taxa do formato" e 0,0011 da prevalência. No limiar congelado (0,0910), a precisão é 0,627, o recall 0,407 e o F1 0,494, com 231 falsos positivos em 862.792 transações (2,7 por 10 mil).
- **Capacidade de investigação.** Investigando 1.000 alertas por dia, o recall seria de 0,54 e 0,62 nos dois dias do teste.
- **Leve queda no tempo.** A AP cai de 0,499 na validação para 0,464 no teste.
- **Não linearidade.** A regressão logística fica em 0,19, então a interação entre histórico de contas e formato pesa.
- **Recall por grupo.** O recall global esconde três grupos muito diferentes:
  - nas 8 tipologias de `HI-Small_Patterns.txt`, vai de 0,55 (BIPARTITE) a 0,72 (FAN-OUT);
  - nos 371 positivos do teste que não pertencem a nenhum padrão (39%), é de 0,019;
  - nas tentativas iniciadas antes do teste é de 0,73, e nas tentativas novas, 0,52.
- **Cauda.** A AP de 0,969 na cauda é inflada pela base de 59% de lavagem e não representa operação.

## 3. Limitações e decisões documentadas

### Lavagem (HI-Small)
- **Dados sintéticos.** `Is Laundering` é verdade sintética de lavagem, sem data de confirmação. O desempenho não se transfere automaticamente para dados reais, e lavagem não é sinônimo de fraude.
- **Cauda do gerador.** De 11/09 em diante só há 1.108 transações, com 58–73% de lavagem. Elas ficam fora das métricas principais (seção 1.4) para não premiar um artefato do tempo.
- **Formato de pagamento.** ACH concentra cerca de 87% da lavagem, e Wire/Reinvestment não têm nenhum caso. O baseline "taxa do formato" mostra quanto do desempenho vem só desse sinal, que pode ser artefato do gerador.
- **Atraso de rótulo.** Rótulos do treino são tratados como conhecidos ao fim do treino, e tentativas de lavagem podem atravessar a fronteira entre períodos. Rótulos passados nunca entram como atributo. Sem `HI-Small_Patterns.txt`, não foi possível medir a fração de tentativas que atravessam períodos.
- **Contas.** Nenhum atributo de conta revela a resposta. O tipo de entidade e o número de contas da entidade têm AP de validação de 0,0011 a 0,0017, contra prevalência de 0,0011, e lift máximo de 3,3. Contas e padrões nunca entram como atributo.
- **Padrões e episódios.**
  - 1.968 dos 5.177 positivos não aparecem em `HI-Small_Patterns.txt`.
  - 206 das 370 tentativas atravessam a fronteira entre períodos. 64% das linhas de padrão do teste vêm de tentativas iniciadas no treino ou na validação, o que torna o recall nessas linhas otimista. Por isso o relatório separa as tentativas novas.
- **Arquivos.** Transações, contas e padrões foram extraídos do `.rar` da professora. SHA-256:

  | Arquivo | SHA-256 |
  |---|---|
  | `HI-Small_Trans.zip` | `93c9d651…5179` |
  | `HI-Small_accounts.csv` | `78680852…b014` |
  | `HI-Small_Patterns.txt` | `2c546b5c…f39b` |
- **Câmbio.** É estimado no treino pela mediana das razões recebido/pago entre moedas diferentes. O fuso dos dados é desconhecido e assumido como UTC.

## 4. Auditoria de 02/11/2026: correções e reuso do teste

Uma auditoria independente comparou a implementação com referências, regras explícitas e alternativas (XGBoost, Random Forest ajustada, HistGradientBoosting). Correções aplicadas:

| Correção | Onde | Evidência | Efeito |
|---|---|---|---|
| `z_valor_origem`: piso de 0,01 na variância do log-valor e somas deslocadas por conta | `src/ml/preparacao.py` (`_VAR_MIN_Z`) | Com variância ≈ 0 no histórico, \|z\| chegava a 1.939, e o cancelamento em E[x²] − E[x]² divergia da força bruta em 4 de 2.000 transações reais | AP de validação da lavagem 0,495 → 0,499 |
| Regressão logística com `tol=1e-6` | `src/ml/modelos.py` (`_lr`) | Com `tol=1e-4`, o lbfgs parava em 17 iterações na lavagem | AP de validação 0,165 → 0,19 (continua candidata derrotada) |
| Previsões de menos de 1.000 linhas com 1 thread | `src/ml/modelos.py` (`CabecaClassificacao.probabilidades`) | RF da rede (módulo removido em 17/11/2026), 1 linha: 27,7 ms com `n_jobs=4` e 8,8 ms com 1 | Resultado idêntico; treino e lotes grandes inalterados |
| Recall por tipologia e por tentativa nova | Contas e padrões disponíveis no `ml_config.local.toml` | O recall global misturava tipologias (cerca de 70%) com positivos sem padrão (cerca de 2%) | Seção 2 acima |
| Testes de força bruta dos atributos | `testes/ml/test_referencia_financeira.py` | — | O motor vetorizado é conferido contra filtros diretos |

**Reuso do teste.** O treino continua sem ler rótulos do teste, e a escolha continua na validação. Mas o teste já foi consultado em três momentos:
- na avaliação de 26/10;
- na comparação de 9 candidatos feita pela auditoria;
- nesta reavaliação.

Além disso, o protocolo foi desenhado depois de olhar a distribuição de rótulos de todos os dias. Por isso os números de teste não são uma avaliação inédita. Antes de trocar o modelo, é preciso congelar o candidato pela validação e medi-lo uma única vez num período novo: uma replicação declarada, por exemplo o HI-Medium, já que o HI-Small não tem outro período limpo.

**Divergência corrigida em 09/11/2026.** As somas em USD do cálculo em lote vinham de prefixos acumulados sobre todo o histórico e perdiam precisão por cancelamento. No teste do HI-Small, a força bruta mostrou até 5,0% de erro em `soma_env_origem_usd_24h` e `razao_saida_entrada_24h`; no HI-Large, até 27%. Agora as somas acumuladas recomeçam em cada conta (`src/ml/preparacao.py`, `_IndiceEventos`): o erro contra a força bruta fica abaixo de 1e-6 nas 49 colunas, e o lote coincide com o cálculo incremental. O modelo atual não foi retreinado. Recalculado com o lote corrigido, o teste do HI-Small dá score com diferença máxima de 8·10⁻¹⁷, os mesmos 620 alertas e a mesma AP (0,4640). Detalhes em `pesquisa/hi_large/RELATORIO_HI_LARGE.md`, seção 3.4.

**Alternativas medidas pela auditoria** (não adotadas): o XGBoost teve AP maior que a RF, mesmo com o mesmo número de tentativas de busca. Fica como candidato para a confirmação acima.
