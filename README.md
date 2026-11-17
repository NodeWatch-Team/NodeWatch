# NodeWatch — Sistema de Detecção de Fraudes em Transações Financeiras

Trabalho da disciplina **Teoria dos Grafos** — Profa. Dra. Andrea Ono Sakai.
Entrega **E3 — MVP: Nucleo Funcional com Primeiras Telas** (Grupo 4).

## Integrantes

- Caio Winkler Marangoni — 39968545
- Guilherme Lombardi — 38054264
- Ryan dos Santos Veloso — 37732005
- Guilherme Liborio Camargo - 48490181

## Visao geral

Protótipo acadêmico de **detecção de lavagem de dinheiro** (AML) em transações financeiras, treinado no IBM AML
HI-Small (dados sintéticos). Não bloqueia nem aprova nada: ordena as transações por prioridade de investigação, e a
decisão é sempre do analista.

- **Machine Learning:** um Random Forest (`modelos/modelo_unificado.joblib`) pontua cada transação com 49 atributos
  calculados só com o passado de cada conta (contagens e somas em janelas de 6, 24 e 72 h, novidade do par de contas,
  contrapartes distintas, desvio de valor, formato e moeda). O resultado vira um **score de 0 a 1000**; a partir de
  701, a transação gera alerta.
- **Grafos:** contas são vértices e transações são arestas. O modelo recebe medidas de 1 salto (grau distinto de cada
  conta e se o par é novo), e o painel desenha a rede da conta em foco, salto a salto, com a ordem no tempo das cadeias.
- **Painel do analista** (`http://127.0.0.1:5000/`): envio e validação do dataset, acompanhamento da análise,
  visão geral, contas prioritárias, grafo da conta, tabela com filtros, desempenho e logs.
- **Sentinel AI:** a tecnologia por trás do Assistente de dúvidas do painel; funciona no modo local sem chave e usa o
  Gemini (ou a Anthropic) com a autorização do analista.

---

## Inicio rapido

### Pre-requisitos

- Python 3.14 (versão testada; mínimo 3.12, exigido pelo `numpy==2.5.4` de `requirements-ml.txt`)
- Chave de API do Google Gemini ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)), opcional: ativa o Sentinel AI no Assistente de dúvidas do painel (com a sua autorização); o painel funciona sem ela

### Windows com poucos cliques: [Inicializador Rápido](Inicializador%20R%C3%A1pido/)

1. Abra a pasta **`Inicializador Rápido`** na raiz do repositório.
2. Clique duas vezes em **`Iniciar_NodeWatch.bat`**.
3. O navegador abre no painel do analista (`http://127.0.0.1:5000/`) quando ele estiver pronto. Para parar, use **Ctrl+C** na janela.

O primeiro uso cria o `.venv` e baixa as dependências, por isso precisa de conexão com a internet. O painel não exige a chave do Gemini. Mais detalhes estão no [README da pasta](Inicializador%20R%C3%A1pido/README.md).

### Windows (script de apresentação)

```powershell
.\start_presentation.ps1
```

### Linux/macOS

```bash
chmod +x start_presentation.sh
./start_presentation.sh
```

Depois acessar o **painel do analista**:

```
http://127.0.0.1:5000/
```

O script:

- Verifica se o Python esta instalado;
- Cria `.venv` se nao existir;
- Instala dependencias;
- Cria `.env` a partir de `.env.example` se nao existir;
- Valida se a `GEMINI_API_KEY` esta configurada (rejeita placeholders);
- Inicia o backend com `python src/servidor.py`;
- Nao exibe a chave no terminal.

---

## Como executar o projeto em uma máquina nova

Testado em 12/11/2026 numa cópia limpa (sem `.venv`, sem `.env`, sem `artefatos_ml/`), num caminho com espaços e acentos: o modelo foi instalado, uma análise nova foi feita pela tela e reaberta depois de reiniciar o servidor, e os 402 testes passaram.

### O que vem no repositório e o que não vem

| Item | Vem no repositório? | Como chega à máquina |
|---|---|---|
| Código, interface, testes | ✅ | `git clone` |
| **Modelo treinado** (`modelos/modelo_unificado.joblib`, 3,0 MB) | ✅ | instalado automaticamente em `artefatos_ml/` na primeira execução, com SHA-256 conferido ([detalhes](modelos/README.md)) |
| Bibliotecas Python | ❌ | `pip install -r requirements.txt -r requirements-ml.txt` (precisa de internet uma vez) |
| Dataset IBM AML HI-Small | ❌ | **não é necessário** para usar o painel; só para treinar de novo (Kaggle, licença CDLA-Sharing-1.0) |
| Exemplos pequenos para testar | ✅ | `dados/exemplos/*.csv` (dados inventados), já listados no painel |
| Chave do Gemini (`.env`) | ❌ | opcional; ativa o Sentinel AI no Assistente de dúvidas |

### Pré-requisitos e hardware

- **Python 3.14** (versão testada; mínimo 3.12) e Git.
- **Internet no primeiro uso**, para instalar as bibliotecas (e, se o arquivo do modelo faltar, para baixá-lo).
- **Disco:** cerca de 55 MB do repositório e 540 MB do ambiente virtual (`.venv`), mais as análises que você fizer (cada análise guarda um SQLite).
- **Memória (medida no teste):** o processo com o modelo carregado usa cerca de 210 MB (17/11/2026); o pico na análise de 150 mil transações foi de 577 MB, medido com o modelo anterior, maior, em 3,5 s. Arquivos de milhões de transações precisam de mais de 1 GB livre.
- Não precisa de GPU.

### Instalação e inicialização (comandos testados)

**Windows, com poucos cliques:** duplo clique em `Inicializador Rápido\Iniciar_NodeWatch.bat`. Ele cria o `.venv`, instala as bibliotecas, prepara o modelo e abre o painel.

**Windows, pelo terminal (PowerShell):**

```powershell
git clone https://github.com/1s4ntos/NodeWatch.git
cd NodeWatch
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-ml.txt
.venv\Scripts\python -m src.ml.provisionamento
.venv\Scripts\python src\servidor.py
```

**Linux/macOS:**

```bash
git clone https://github.com/1s4ntos/NodeWatch.git
cd NodeWatch
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-ml.txt
.venv/bin/python -m src.ml.provisionamento
.venv/bin/python src/servidor.py
```

O passo `python -m src.ml.provisionamento` é opcional: o servidor faz o mesmo ao iniciar. Rodá-lo antes mostra o resultado com calma. Saída esperada na primeira vez:

```
Modelo instalado em artefatos_ml/ (cópia de modelos/).
[OK] Modelo de ML pronto: lavagem-20261102T083253Z (instalado agora a partir de modelos/); 49 atributos; limiar de alerta 0.0910.
     Bibliotecas: scikit-learn 1.9.1, numpy 2.5.4, pandas 3.1.0, joblib 1.6.0
```

Nas vezes seguintes aparece "(já instalado)" e nada é copiado de novo.

### Executar uma nova análise

1. Abra `http://127.0.0.1:5000/`.
2. Em **Dataset e análise**, envie um `.csv`/`.zip` no formato do IBM AML ou em português (seção [Formato do CSV de entrada](#formato-do-csv-de-entrada)), ou escolha `transacoes_inventadas.csv` na lista **Ou escolher um dataset disponível** e clique em **Validar este dataset**.
3. Clique em **Analisar**. O acompanhamento mostra as cinco etapas numa linha, com o progresso geral, o tempo e as contagens, e o log da execução ocupa a largura toda logo abaixo; ao terminar, os indicadores, as contas, o grafo e a tabela ficam disponíveis.
4. A análise fica em **Análises recentes** e pode ser reaberta depois, mesmo após reiniciar o servidor.

### Como saber se a ML está funcionando

- No terminal do servidor: a linha `[OK] Modelo de ML pronto: lavagem-…`.
- No painel: o botão **Analisar** fica habilitado com um dataset válido; se o modelo faltar, aparece o aviso **Modelo não encontrado no servidor** com a causa e o que fazer.
- Em `http://127.0.0.1:5000/api/painel/estado`: `"modelo": {"disponivel": true, "versao": "lavagem-20261102T083253Z", ...}`.
- Depois de uma análise: ☰ → **Logs de ML** mostra "Modelo de lavagem carregado para a análise", com versão e limiar.

### Erros comuns

| Mensagem | Causa | O que fazer |
|---|---|---|
| `Bibliotecas de ML ausentes: scikit-learn, numpy, pandas, joblib` | Só o `requirements.txt` foi instalado | `python -m pip install -r requirements.txt -r requirements-ml.txt` |
| `Versões incompatíveis com o modelo distribuído: scikit-learn …` | Outra versão do scikit-learn no ambiente; o modelo `joblib` depende dela | Instale as versões fixadas num `.venv` novo: `python -m pip install -r requirements-ml.txt` |
| `modelos/modelo_unificado.joblib não confere com o SHA-256 do manifesto` | Arquivo corrompido ou cópia incompleta (por exemplo, ZIP baixado sem o arquivo grande) | `git checkout -- modelos/` ou `python -m src.ml.provisionamento` com internet (baixa e confere) |
| `Falha ao baixar o modelo de …` | Sem internet, ou o endereço não serve o arquivo | Confira a conexão; sem internet, copie `modelos/modelo_unificado.joblib` de outra cópia do repositório |
| `O modelo em artefatos_ml/modelo_unificado.joblib não pôde ser carregado` | Modelo local (treinado aqui) corrompido ou de outra versão | Renomeie ou apague esse arquivo e rode `python -m src.ml.provisionamento` para voltar ao distribuído |
| Análise concluída sem nenhum alerta | Cada análise começa **sem histórico**: contas "sem passado" quase não geram alerta nas primeiras ~72 h do arquivo | Use arquivos que cubram vários dias; para pontuar um dia com o passado, use `python -m src.treino.cli prever --tarefa lavagem --entrada dia.csv --historico dias_anteriores.csv --saida saida.csv` |
| `A porta 5000 esta ocupada` / `Ja ha um NodeWatch rodando … de OUTRA pasta` | Outro servidor na mesma porta | Feche-o com Ctrl+C na janela dele |

### Modo real × demonstrativo

Não existe modo demonstrativo: o painel sempre usa o **modelo real**, treinado no IBM AML HI-Small e distribuído em `modelos/`. Os arquivos de `dados/exemplos/` são **dados inventados** para testar o fluxo; eles passam pelo mesmo modelo, mas não representam o desempenho medido (que está em `modelos/resultados/`).

### Estratégia de distribuição (resumo)

O modelo treinado é versionado em `modelos/` com um manifesto (SHA-256, versões, origem dos dados). Na primeira execução ele é instalado em `artefatos_ml/` (pasta de trabalho, fora do Git), validado com uma previsão de teste e nunca carregado sem o SHA-256 conferir. Se o arquivo faltar, é baixado do próprio repositório (`raw.githubusercontent.com/1s4ntos/NodeWatch/main/modelos/…`) ou de `NODEWATCH_MODELO_URL`. O treino continua reproduzível pela CLI com o dataset público. Detalhes em [modelos/README.md](modelos/README.md).

---

## Como rodar com Python

### Passo a passo (Windows)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-ml.txt
python src/servidor.py
```

### Passo a passo (Linux/macOS)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-ml.txt
python src/servidor.py
```

`requirements-ml.txt` traz scikit-learn, NumPy e pandas, sem os quais o painel não consegue analisar. O `.env` é opcional: a chave só ativa o Sentinel AI (Assistente de dúvidas com o contexto da análise); sem ela o assistente responde no modo local. Para configurá-lo, copie `.env.example` para `.env` e preencha a chave:

```env
GEMINI_API_KEY=sua_chave_real_aqui
```

Acessar o painel do analista:

```
http://127.0.0.1:5000/
```

Com a chave, o **Assistente de dúvidas** do painel passa a usar o Sentinel AI (com a sua autorização, por aba) para interpretar a análise aberta. Para conferir se a chave funciona, abra o Assistente de dúvidas (botão no canto inferior direito) e clique em **Testar conexão**: o selo mostra *Sentinel AI conectado* ou o motivo da falha (chave recusada, limite de uso, sem conexão, serviço indisponível…). O servidor só lê o `.env` ao iniciar: depois de trocar a chave, reinicie. Detalhes, erros e problemas comuns em [docs/SENTINEL_AI.md](docs/SENTINEL_AI.md).

Health check:

```
http://127.0.0.1:5000/health
```

Para mais detalhes, consulte [README_LOCAL.md](README_LOCAL.md).

---

## Configuracao do `.env`

O arquivo `.env` armazena a chave de API e **nunca deve ser commitado**.

Exemplo seguro (sem chave real):

```env
SENTINEL_PROVIDER=gemini
GEMINI_API_KEY=coloque_sua_chave_gemini_aqui
GEMINI_MODEL=gemini-2.5-flash
SENTINEL_HOST=127.0.0.1
SENTINEL_PORT=5000
```

| Variavel          | Descricao                           | Valor padrao     |
| ----------------- | ----------------------------------- | ---------------- |
| SENTINEL_PROVIDER | Provider de IA (gemini / anthropic) | gemini           |
| GEMINI_API_KEY    | Chave de API do Google Gemini       | (opcional: ativa o Sentinel AI) |
| GEMINI_MODEL      | Modelo do Gemini                    | gemini-2.5-flash |
| SENTINEL_HOST     | Host do servidor Flask              | 127.0.0.1        |
| SENTINEL_PORT     | Porta do servidor Flask             | 5000             |

Protecoes:

- `.env` fica apenas na maquina local;
- `.env` esta no `.gitignore` — nao vai para o GitHub;
- A chave nao aparece no frontend nem nos logs.

Para obter uma chave: acesse [Google AI Studio](https://aistudio.google.com/apikey), faca login e clique em "Create API Key".

---

## Como rodar os testes

```bash
python -m pytest -q
```

Saída esperada (17/11/2026): `332 passed`. Os testes usam dados sintéticos e pastas temporárias; nenhum precisa do
HI-Small nem de chave de API.

### Ambiente de teste local

Um painel de teste numa pasta isolada (`artefatos_teste/`, fora do Git), na porta **5001**, com o modelo distribuído instalado nela e datasets sintéticos prontos. As análises, os logs e os envios feitos nele não se misturam com os de `artefatos_ml/`; apagar a pasta zera o ambiente.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ambiente_teste.ps1            # cria o .venv se faltar e abre http://127.0.0.1:5001/
powershell -ExecutionPolicy Bypass -File scripts\ambiente_teste.ps1 -Testes    # roda a suíte completa no .venv
```

Direto pelo Python (`.venv\Scripts\python scripts\ambiente_teste.py`): `--preparar` só prepara a pasta, `--limpar` apaga e prepara de novo, `--hismall CAMINHO` inclui o HI-Small (CSV ou ZIP) na lista, `--porta N` troca a porta. No Claude Code, a configuração `nodewatch-teste` de `.claude/launch.json` sobe o mesmo servidor.

| Dataset (na lista do painel) | Para testar |
|---|---|
| `sintetico_5k_rotulado.csv` | análise completa em poucos segundos, com precisão e recall |
| `sintetico_5k_sem_rotulo.csv` | o caminho sem rótulo ("não disponível para este dataset") |
| `sintetico_200k_rotulado.csv` | log longo: acima de 8 M px a rolagem fica proporcional |
| `HI-Small_Trans.zip` (com `--hismall`) | volume real (5 milhões de transações, cerca de 7 min) |

Em `artefatos_teste/para_enviar/` fica `sintetico_5k_rotulado.csv`, para testar o envio pela tela (o envio não tem limite de tamanho nem campo de tipologia). Os dados sintéticos são determinísticos (mesma semente, mesmos arquivos) e têm tentativas de lavagem FAN-OUT, FAN-IN e CYCLE, com rótulo 1; `testes/painel/test_ambiente_teste.py` confere que eles passam na validação e que a análise conclui com o rótulo certo.

---

## Formato do CSV de entrada

Dois formatos de transações são aceitos (`src/ml/formatos.py`), em CSV UTF-8 separado por vírgula ou num `.zip`
com um único CSV:

- `hismall_v1`: cabeçalho original do IBM AML
  (`Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format`),
  com `Is Laundering` opcional;
- `transacao_hismall_v1`: os mesmos campos em português
  (`id_transacao,timestamp,banco_origem,conta_origem,banco_destino,conta_destino,valor_pago,moeda_pagamento,valor_recebido,moeda_recebimento,formato`),
  com `rotulo` opcional.

Linhas com data, banco, conta, valor ou moeda inválidos ficam fora da análise e são contadas, com coluna, linha de
exemplo e como corrigir. Regras completas em [`docs/ui/PAINEL_ANALISTA.md`](docs/ui/PAINEL_ANALISTA.md).

---

## Principais arquivos

```
NodeWatch/
├── src/
│   ├── servidor.py          servidor Flask: painel em /, API em /api/painel, /health
│   ├── seguranca_local.py   só aceita pedidos locais e da própria página
│   ├── sentinel_ia.py       motor do Sentinel AI (provedores e prompts)
│   ├── painel/              API (api.py), pipeline da análise, datasets, SQLite, score, assistente, desempenho e logs
│   └── ml/                  atributos, modelo, inferência, instalação do modelo e treino (CLI)
├── interface/               painel do analista (painel.html + assets, React 18 sem build)
├── modelos/                 modelo distribuído, manifesto com SHA-256 e metadados
├── testes/                  testes do painel e do módulo de ML
├── scripts/                 ambiente de teste, imagens do site e pesquisa HI-Large
├── docs/                    documentação, relatórios de ML e entregas
├── index.html, site-assets/ site de apresentação (GitHub Pages)
└── Inicializador Rápido/    início com poucos cliques no Windows
```

---

## Seguranca da chave API

- Nunca commitar o `.env`;
- Nunca colocar chave real no codigo-fonte;
- Nunca colocar chave no frontend;
- Usar `.env` local para configuracao;
- O `.env` esta protegido pelo `.gitignore`.

---

## Validacao

- `python -m pytest -q` passa por inteiro (332 testes);
- `python src/servidor.py` instala e confere o modelo, sobe o servidor e mostra o endereço do painel;
- `/health` responde `{"status": "ok", ...}`;
- uma análise do exemplo `dados/exemplos/transacoes_inventadas.csv` termina com 12 transações válidas e 3 recusadas;
- `.env` fica fora do controle de versão.

---

## Fluxo do programa

```
CSV ou ZIP de transações
  └→ validação em blocos (src/painel/datasets.py)            linhas inválidas ficam fora e são contadas
  └→ ordenação por data e hora (src/painel/pipeline.py)
  └→ 49 atributos por transação, só com o passado (src/ml/incremental.py)
  └→ Random Forest (modelos/modelo_unificado.joblib) → score 0–1000 e alerta (src/painel/score.py)
  └→ resultados.sqlite + manifesto.json (artefatos_ml/painel/analises/<id>/)
  └→ painel: visão geral, contas prioritárias, grafo da conta, tabela, desempenho e logs
```

---

## Modulo de ML (`src/ml`)

Uma tarefa, `lavagem`: pontua transações do IBM AML HI-Small (sintético) com um Random Forest. O módulo didático de
telemetria de rede (`estado_rede`) e a fusão rede ↔ transação foram removidos em 17/11/2026.

**Para entender o sistema inteiro, comece pelo manual** [`docs/COMO_FUNCIONA_O_NODEWATCH.md`](docs/COMO_FUNCIONA_O_NODEWATCH.md) (tambem em [PDF](docs/COMO_FUNCIONA_O_NODEWATCH.pdf)).

Instalacao, comandos e protocolo estao em [`docs/ml/README.md`](docs/ml/README.md). Os resultados medidos estao em [`docs/ml/RELATORIO_ML.md`](docs/ml/RELATORIO_ML.md).

### Painel do analista (pagina inicial)

`http://127.0.0.1:5000/` abre o **painel do analista**: enviar ou escolher um dataset de transacoes, validar, clicar em **Analisar**, acompanhar as etapas e investigar o recorte (indicadores, contas de maior risco, grafo da conta e tabela com filtros). Funciona sem chave de API. Resultados em SQLite e manifesto JSON por analise, em `artefatos_ml/painel/`. Detalhes, decisoes e limites em [`docs/ui/PAINEL_ANALISTA.md`](docs/ui/PAINEL_ANALISTA.md).

| endereco | o que e |
|---|---|
| `http://127.0.0.1:5000/` | **Painel do analista**, a interface do NodeWatch. |
| `http://127.0.0.1:5000/health` | Situação do servidor e do Sentinel AI. |

A interface antiga (`/legado`, com grafos de demonstração, a seção de ML antiga, os eventos e o chat) foi removida; ela continua no histórico do Git.

---

## Limitacoes

- Protótipo acadêmico, treinado e avaliado em dados **sintéticos** (IBM AML HI-Small); não é um sistema de produção;
- o score é uma ordem de prioridade, não probabilidade calibrada nem prova de lavagem: a decisão final cabe ao analista;
- o painel só conhece o histórico que está no próprio dataset: nas primeiras 72 h do período os atributos de
  contagem ficam subestimados e o modelo tende a gerar menos alertas (a tela avisa);
- uma análise por vez, com o dataset validado em memória durante a análise;
- o Sentinel AI depende de chave válida e de cota disponível no provedor.
