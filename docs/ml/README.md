# Módulo de ML do NodeWatch (`src/ml`)

Manual completo do sistema: [`docs/COMO_FUNCIONA_O_NODEWATCH.md`](../COMO_FUNCIONA_O_NODEWATCH.md).

Uma tarefa, em scikit-learn: a cabeça `lavagem`, com o preparador `financeiro`, salva em um único artefato (`modelos/modelo_unificado.joblib`, instalado em `artefatos_ml/`).

| cabeça | dados | saída | status |
| --- | --- | --- | --- |
| `lavagem` | IBM AML HI-Small (sintético) | `score_lavagem`, alerta e motivos verificáveis | treinada |

`score_lavagem` é uma pontuação aprendida em dados sintéticos, e não fraude confirmada nem probabilidade calibrada.

O módulo didático de telemetria de rede (`estado_rede`) e o lugar reservado da fusão rede ↔ transação foram removidos em 17/11/2026; continuam no histórico do Git.

Resultados: [RELATORIO_ML.md](RELATORIO_ML.md). Dicionário de dados: [DICIONARIO_DADOS.md](DICIONARIO_DADOS.md).

Avaliação do IBM AML **HI-Large** (compatibilidade, protocolo purgado por tentativa e comparação com o modelo atual): [pesquisa/hi_large/RELATORIO_HI_LARGE.md](../../pesquisa/hi_large/RELATORIO_HI_LARGE.md). Conclusão: o HI-Large é compatível em formato e rótulo, mas não há melhora confirmada. Treinar só com ele fica abaixo do modelo atual. O HI-Small mais o HI-Large com XGBoost superou o atual de 13 a 16/08/2022, mas não se confirmou de 17 a 23/08 (hipótese registrada antes). A floresta com as duas bases ficou acima nos dois períodos, mas é só um resultado exploratório (hipótese secundária). O artefato não foi trocado. Trilha de auditoria de cada execução: [pesquisa/hi_large/REGISTRO_EXPERIMENTOS_E_TREINOS.md](../../pesquisa/hi_large/REGISTRO_EXPERIMENTOS_E_TREINOS.md).

## Instalação

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-ml.txt
```

As versões fixadas em `requirements-ml.txt` são as usadas no treino documentado: Python 3.14.0, scikit-learn 1.9.1, pandas 3.1.0 e numpy 2.5.4.

## Configuração

1. Copie `ml_config.exemplo.toml` para `ml_config.local.toml`. A cópia é ignorada pelo git.
2. Ajuste os caminhos:
   - `[financeiro].transacoes`: `HI-Small_Trans.csv` ou o `.zip` que o contém;
   - opcionalmente `contas` e `padroes`.
3. Os arquivos originais nunca são alterados.

O arquivo de padrões serve só para auditoria e para o recall por tipo de padrão. Ele **nunca** vira atributo, porque é a própria resposta. Sem ele, a avaliação da lavagem marca o recall por padrão como pendente. Com ele, a avaliação separa três grupos: as tipologias, os positivos que não pertencem a nenhum padrão e as tentativas iniciadas antes do teste ou novas.

### Dados usados nos resultados versionados

Os dados não estão no repositório; vêm do `.rar` entregue pela professora. Confira os hashes (`sha256sum` ou `Get-FileHash`) antes de comparar resultados:

| Arquivo | SHA-256 | Uso |
|---|---|---|
| `HI-Small_Trans.zip` | `93c9d65156a28596c756bd1395531e231c5950bbbdbfe665500bc866ed595179` | Lavagem |
| `HI-Small_accounts.csv` | `786808526e33cfc441212dd6fccda7edfc24172149bed59c6ef59b186836b014` | Auditoria de contas |
| `HI-Small_Patterns.txt` | `2c546b5ce6009e73851f0139af053cf845f08bf92f3bc82fe1eb937dec2ef39b` | Auditoria e recall por padrão |

## Comandos

Rode da raiz do projeto, com o Python do `.venv`:

```bash
python -m src.treino.cli auditar
```
Audita os dados e grava JSON e MD em `artefatos_ml/auditoria`.

```bash
python -m src.treino.cli treinar --tarefa lavagem
```
Ajusta cada configuração no treino e escolhe configuração e limiar na validação.

```bash
python -m src.treino.cli avaliar --tarefa lavagem
```
Avalia uma única vez no teste, com o artefato congelado.

```bash
python -m src.treino.cli prever --tarefa lavagem --entrada transacoes.csv --historico HI-Small_Trans.zip --saida previsoes_lavagem.csv
```
O histórico das contas vem de `--historico`. Desse arquivo só entram transações anteriores à primeira transação a pontuar.

```bash
python -m src.treino.cli exemplos
python -m src.treino.cli relatorio
python -m src.treino.cli documentar
python -m src.treino.cli tarefas
python -m pytest testes/ml
```
- `exemplos` gera uma entrada derivada sem rótulo e as previsões dela, em `artefatos_ml/exemplos`.
- `relatorio` gera `docs/ml/RELATORIO_ML.md` a partir dos resultados salvos.
- `documentar` gera o dicionário de dados e `docs/ml/esquemas/*.json`.
- `tarefas` mostra o status da cabeça do modelo.

### Usar o modelo no painel

`python src/servidor.py` (com `requirements.txt` e `requirements-ml.txt` instalados) e abra `http://127.0.0.1:5000/`. O painel do analista valida um dataset de transações e, com a ação **Analisar**, pontua cada transação com o modelo salvo, sem treinar nada. O financeiro usa `src/ml/incremental.py`, que calcula os mesmos 49 atributos do treino a partir de um estado por conta. Fluxo, formatos e limites: [`docs/ui/PAINEL_ANALISTA.md`](../ui/PAINEL_ANALISTA.md).

A interface antiga (exploração de previsões, Analisar dataset, eventos, replay e laboratório de simulação) foi removida; ela continua no histórico do Git.

### Testes

- `pytest testes/ml` roda os testes do módulo, todos com dados sintéticos. `test_treino_cli.py` roda o treino inteiro pela CLI (auditar → treinar → avaliar → prever → relatorio). `test_referencia_financeira.py` compara os atributos vetorizados com uma referência por força bruta (`testes/ml/referencia_financeira.py`).

### O que está versionado em `docs/ml`

`artefatos_ml/` é ignorado pelo git. Por isso, depois de `treinar`, `avaliar`, `exemplos` e `relatorio`, uma parte das saídas é copiada para `docs/ml`:

| Em `docs/ml` | Origem |
|---|---|
| `resultados/*.json` | Auditoria financeira e estudos (estrutura, atributos de grafo). A avaliação e o treino do modelo distribuído ficam em `modelos/resultados/`. Cópias de `artefatos_ml/`, com os caminhos absolutos trocados pelo nome do arquivo |
| `exemplos/previsoes_lavagem_amostra.csv` | Cabeçalho e 200 primeiras linhas de `artefatos_ml/exemplos/previsoes_lavagem_exemplo.csv`, gerado a partir das transações de 10/09/2022 sem rótulo, com o histórico anterior a esse dia (`--historico`) |
| `exemplos/*.relatorio.json` | Relatórios de inferência dessas previsões, com os caminhos absolutos trocados pelo nome |
| `RELATORIO_ML.md` | Gerado por `relatorio`, que acrescenta `notas_relatorio.md` ao final |

As amostras mostram o formato da saída, não uma seleção representativa.

## Protocolo, em resumo

### Lavagem
- **Divisão temporal por dia:**
  - treino 01–06/09;
  - validação 07–08/09;
  - teste 09–10/09.

  A partir de 11/09 o gerador quase não produz atividade normal (base de 58–73% de lavagem). Esse trecho é reportado à parte, como cauda.
- **Atributos:** cada transação só enxerga transações de minutos **estritamente anteriores**.
- **Câmbio e categorias:** aprendidos no treino.
- **Amostragem:** os negativos do treino são subamostrados (20%) com peso 5. Validação e teste preservam a distribuição original.

### Seleção
- **Configuração:** maior average precision na validação.
- **Limiar:** máximo F1 na validação. Não houve custos nem capacidade fornecidos.

## Estrutura

```
src/ml/            usado pelo servidor para pontuar (e pelo treino)
  config.py              configuração (TOML + padrões)
  esquemas.py            contrato do HI-Small e validação
  formatos.py            formatos de entrada e detecção pelo cabeçalho
  ingestao.py            leitura do HI-Small, das contas e dos padrões
  preparacao.py          atributos financeiros point-in-time e pipelines de treino
  incremental.py         estado por conta: os mesmos 49 atributos, transação a transação
  modelos.py             CabecaClassificacao e ModeloUnificado (o artefato) e a grade de treino
  previsao.py            inferência sem reajuste e motivos verificáveis
  provisionamento.py     instalação do modelo distribuído (conferência de SHA-256)
  modelo_ativo.py        modelo carregado uma vez por processo do servidor
  resultados_oficiais.py métricas oficiais e metadados lidos dos resultados gravados
  serializacao.py        conversão de resultados para JSON

src/treino/        só offline (não roda no servidor)
  cli.py                 linha de comando: auditar, treinar, avaliar, prever, exemplos, relatorio, documentar
  experimentos.py        treino/validação/teste
  auditoria.py           verificações de dados refeitas a cada execução
  avaliacao.py           métricas (precisão, recall, F1, AP, calibração, recall por grupo)
  relatorio.py           relatório e dicionário gerados dos resultados
```

O artefato `joblib` executa código ao ser carregado. Carregue apenas artefatos gerados por você.
