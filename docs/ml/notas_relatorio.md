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

**Divergência corrigida em 09/11/2026.** As somas em USD do cálculo em lote vinham de prefixos acumulados sobre todo o histórico e perdiam precisão por cancelamento. No teste do HI-Small, a força bruta mostrou até 5,0% de erro em `soma_env_origem_usd_24h` e `razao_saida_entrada_24h`; no HI-Large, até 27%. Agora as somas acumuladas recomeçam em cada conta (`src/ml/preparacao.py`, `_IndiceEventos`): o erro contra a força bruta fica abaixo de 1e-6 nas 49 colunas, e o lote coincide com o cálculo incremental. O modelo atual não foi retreinado. Recalculado com o lote corrigido, o teste do HI-Small dá score com diferença máxima de 8·10⁻¹⁷, os mesmos 620 alertas e a mesma AP (0,4640). Detalhes em `docs/ml/hi_large/RELATORIO_HI_LARGE.md`, seção 3.4.

**Alternativas medidas pela auditoria** (não adotadas): o XGBoost teve AP maior que a RF, mesmo com o mesmo número de tentativas de busca. Fica como candidato para a confirmação acima.
