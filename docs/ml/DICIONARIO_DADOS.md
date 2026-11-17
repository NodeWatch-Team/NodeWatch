# Dicionário de dados e contratos

Gerado de `src/ml/esquemas.py` (`python -m src.treino.cli documentar`). `verificado` = conferido nos dados pela auditoria; `inferido` = deduzido do nome e da distribuição, sem documentação da construção original.

## `hismall_v1`

Transações sintéticas do IBM AML (AMLworld), conjunto HI-Small. A coluna 'Account' aparece duas vezes no cabeçalho original (origem e destino).

| coluna | tipo | papel | unidade | sentinela | obrig. treino | obrig. inferência | status | descrição |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Timestamp` | datahora | tempo | — | — | sim | sim | verificado | Data e hora da transação (resolução de minuto, fuso não documentado). |
| `From Bank` | int | id | — | — | sim | sim | verificado | Banco de origem. |
| `Account` | str | id | — | — | sim | sim | verificado | Conta de origem (única dentro do banco). |
| `To Bank` | int | id | — | — | sim | sim | verificado | Banco de destino. |
| `Account.1` | str | id | — | — | sim | sim | verificado | Conta de destino. |
| `Amount Received` | float | feature | moeda | — | sim | sim | verificado | Valor recebido, na moeda de recebimento. |
| `Receiving Currency` | cat | feature | — | — | sim | sim | verificado | Moeda de recebimento. |
| `Amount Paid` | float | feature | moeda | — | sim | sim | verificado | Valor pago, na moeda de pagamento. |
| `Payment Currency` | cat | feature | — | — | sim | sim | verificado | Moeda de pagamento. |
| `Payment Format` | cat | feature | — | — | sim | sim | verificado | Meio de pagamento (ACH, Wire, Cheque, ...). |
| `Is Laundering` | int | alvo | — | — | sim | não | verificado | 1 = transação faz parte de lavagem segundo o simulador (verdade sintética, sem data de confirmação). |

