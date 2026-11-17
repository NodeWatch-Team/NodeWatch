# Sentinel AI

Sentinel AI é a tecnologia por trás do **Assistente de dúvidas** do painel do analista. Para o usuário, o nome na
tela é "Assistente de dúvidas"; "Sentinel AI" é o nome interno do motor (`src/sentinel_ia.py`).

## Objetivo

O assistente ajuda o analista a:

- entender os resultados de uma análise (indicadores, score de 0 a 1000, alertas, motivos verificáveis, contas de
  maior risco e o grafo da conta em foco);
- entender as métricas oficiais do modelo e os limites delas;
- navegar pelo painel.

Ele **não toma decisões e não prova lavagem**. A decisão final cabe sempre ao analista humano: um alerta é prioridade
de investigação, não confirmação.

## Arquitetura

```
interface/painel.html          src/painel/api.py                 src/sentinel_ia.py          Gemini (ou Anthropic)
 (Assistente de dúvidas)        POST /api/painel/assistente        prompt + contexto            (opcional)
         |                               |                                |                          |
         |-- pergunta (+ autorização) -->|-- resposta local (sempre) ---- |                          |
         |                               |-- contexto verificado -------->|-- generate_content ----->|
         |                               |   (src/painel/contexto_sentinel.py)                       |
         |<-- resposta + estado ---------|<-------------------------------|<-- texto ----------------|
```

1. Sem chave, ou sem a autorização do usuário na tela, o assistente responde no **modo local**
   (`src/painel/assistente.py`): glossário, ajuda e números lidos dos resultados gravados.
2. Com chave e autorização, o servidor monta o contexto verificado da análise aberta
   (`src/painel/contexto_sentinel.py`: manifesto, recorte, transação em foco, métricas oficiais) e o motor chama o
   provedor configurado (`SENTINEL_PROVIDER`: `gemini`, padrão, ou `anthropic`).
3. O bloco `PROMPT_PAINEL` de `src/sentinel_ia.py` define as regras do painel: só o contexto enviado vale como fonte;
   fatos, inferências, hipóteses e limitações ficam separados; nada de explicação inventada para decisões do modelo.

Detalhes da tela e do que é enviado: [docs/ui/PAINEL_ANALISTA.md](ui/PAINEL_ANALISTA.md#assistente-de-dúvidas-tecnologia-sentinel-ai).

## Modos de linguagem

| Modo | Descrição |
|---|---|
| **Leiga** | Linguagem simples, sem jargões, com analogias. |
| **Técnica** | Termos técnicos (atributos, limiar, precisão, recall, grafo). |

## Execução

```bash
python -m pip install -r requirements.txt -r requirements-ml.txt
cp .env.example .env         # opcional: preencher GEMINI_API_KEY
python src/servidor.py
```

Abra `http://127.0.0.1:5000/` e use o botão do Assistente de dúvidas, no canto inferior direito. No Windows, o
[Inicializador Rápido](../Inicializador%20R%C3%A1pido/) faz tudo isso e pergunta o token uma vez.

## Conexao com o Gemini: chave, verificacao e erros

**Como a chave chega ao Sentinel AI.** O inicializador (`Inicializador Rápido/Iniciar_NodeWatch.bat` → `Iniciar_NodeWatch.ps1`) pergunta o token uma vez, com a digitação oculta, e grava só a linha `GEMINI_API_KEY=` do `.env` da pasta principal. O servidor (`src/servidor.py`) carrega esse `.env` ao iniciar (`load_dotenv`), e o motor (`src/sentinel_ia.py`) lê a variável do ambiente. Uma variável `GEMINI_API_KEY` já definida no Windows tem precedência e o inicializador não pergunta. Trocou a chave? Reinicie o servidor.

**Cliente.** Biblioteca `google-genai` (3.x), modelo `GEMINI_MODEL` (padrão `gemini-2.5-flash`), **API `v1beta`** (`GEMINI_API_VERSION`), tempo limite de 60 s e até 4096 tokens de saída.

> **Causa do erro "O Sentinel AI não respondeu agora (ClientError)" (13/11/2026).** A `google-genai` 3.x usa por padrão a API `v1`, que recusa o prompt de sistema (`system_instruction`) com `400 INVALID_ARGUMENT: Developer instruction is not enabled for api version v1`. Toda pergunta com prompt de sistema falhava, embora a chave fosse válida (uma chamada sem prompt de sistema funcionava). Correção: o cliente é criado com `HttpOptions(api_version="v1beta")`. Além disso, o limite de saída subiu de 1024 para 4096 tokens: o `gemini-2.5-flash` gasta parte do limite "pensando" e cortava respostas.

**Estado da conexão** (o que a tela mostra): ter a chave não prova que ela funciona, então o estado vem do resultado da última chamada real neste servidor.

| Estado | Significado |
|---|---|
| `nao_configurado` | sem chave ou sem a biblioteca do provedor: o assistente responde no **modo local** |
| `nao_verificado` | há chave, mas nenhuma chamada foi feita desde que o servidor subiu |
| `conectado` | a última chamada deu certo |
| `falhou` | a última chamada falhou; `categoria` diz o motivo |

Para testar agora: botão **Testar conexão** no Assistente de dúvidas, ou `POST /api/painel/assistente/verificar` (uma chamada mínima, sem dados da análise).

**Erros classificados** (`classificar_erro` em `src/sentinel_ia.py`). O usuário recebe a mensagem e a ação; o detalhe técnico vai só para o log do servidor (saída de erro e `artefatos_ml/painel/logs/sistema.jsonl`, evento `assistente_sentinel_falhou`), **com a chave mascarada** (`***`).

| Categoria | Origem típica | Tentar de novo? |
|---|---|---|
| `sem_chave` | `GEMINI_API_KEY` ausente ou vazia | não |
| `biblioteca_ausente` | `google-genai` não instalado | não |
| `chave_invalida` | 400 "API key not valid" / 403 com chave recusada | não |
| `autenticacao` | 401 | não |
| `permissao` | 403 (projeto sem acesso à API ou ao modelo) | não |
| `modelo_indisponivel` | 404 (modelo inexistente para a chave) | não |
| `requisicao_invalida` | outros 400 (formato da requisição) | não |
| `limite` | 429 (cota ou taxa) | sim |
| `timeout` | 408/504 ou tempo esgotado | sim |
| `conexao` | sem rede, DNS, proxy, conexão recusada | sim |
| `servico_indisponivel` | 5xx (ex.: 503 "high demand") | sim |
| `resposta_invalida` | resposta sem texto (bloqueio, corte) | sim |
| `erro_interno` | qualquer outro erro | sim |

**Reserva local.** Se o Sentinel AI falhar, a pergunta **não** é tratada como "fora da base": se o modo local tem resposta (glossário, ajuda, números gravados), ela vem com o aviso do que falhou; se não tem, a resposta diz que o Sentinel AI não respondeu. A pergunta fica guardada (`pergunta_preservada`) e a mensagem ganha o botão **Tentar de novo** quando a categoria permite.

**Como testar.**

```powershell
.venv\Scripts\python -m pytest testes/painel/test_sentinel_erros.py testes/painel/test_assistente_sentinel.py -q
```

Os testes usam um provedor falso (nada sai do computador) e cobrem: leitura da chave, API `v1beta`, sem chave, cada código de erro, sucesso, resposta sem texto, tempo esgotado, falha de conexão, limite, reserva local, pergunta preservada com nova tentativa, os endpoints e a ausência da chave em respostas, logs e saída de erro. Teste real: abra o painel, clique em **Testar conexão** e faça uma pergunta com o contexto autorizado.

**Problemas comuns.**

- *"a chave foi recusada"*: chave copiada errada ou revogada; gere outra em aistudio.google.com/apikey, troque a linha no `.env` e reinicie.
- *"limite de uso atingido"*: cota gratuita esgotada por minuto ou por dia; espere e use **Tentar de novo**.
- *"serviço indisponível"* (503): demanda alta no Gemini, passageira; tente de novo.
- *"sem conexão"*: rede, proxy ou firewall bloqueando `generativelanguage.googleapis.com`.
- Mudou a chave e nada mudou: o servidor só lê o `.env` ao iniciar; reinicie pelo inicializador.

## Seguranca da chave API

- Nunca commitar o `.env`;
- Nunca colocar chave real no codigo-fonte;
- Nunca colocar chave no frontend;
- Usar `.env` local para configuracao;
- `.env` esta listado no `.gitignore`;
- Erros do backend retornam mensagem classificada, sem dados sensiveis; o detalhe tecnico vai para o log com a chave mascarada (`mascarar` em `src/sentinel_ia.py`);
- O system prompt proibe o Sentinel AI de inventar dados nao presentes no contexto.

## Validação

- `python src/servidor.py` sobe o servidor; `/health` informa o provedor, o modelo e se há chave configurada;
- sem chave, o painel e o assistente funcionam no modo local;
- com chave, **Testar conexão** mostra *Sentinel AI conectado* ou o motivo da falha;
- `.env` fora do controle de versão.

## Limitações

- **Protótipo acadêmico**, não é um sistema de produção;
- a IA auxilia a interpretação, mas **não prova lavagem**: a decisão final cabe ao analista humano;
- o provedor depende de chave válida e de cota disponível (a cota gratuita do `gemini-2.5-flash` é pequena);
- o modelo de linguagem só vê o contexto enviado; ele não acessa o arquivo do dataset nem o modelo de ML.
