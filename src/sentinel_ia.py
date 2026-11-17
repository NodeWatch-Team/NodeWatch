"""Sentinel AI — motor de IA do NodeWatch (provedores, prompts e modos de linguagem).

Nome interno da tecnologia: **Sentinel AI**. No painel ele aparece como **"Assistente de dúvidas"**
(src/painel/api.py, rota /api/painel/assistente), com dois modos de linguagem (leiga e técnica) e dois
provedores (Gemini por padrão; Anthropic com SENTINEL_PROVIDER=anthropic).

O prompt enviado ao provedor é SYSTEM_PROMPT (papel e restrições obrigatórias) + o modo de linguagem +
PROMPT_PAINEL (fonte única de dados, como o modelo funciona e formato da resposta) + o contexto verificado.
"""

from __future__ import annotations

import os

PROVIDER = os.environ.get("SENTINEL_PROVIDER", "gemini").lower()

# Provider-specific config
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_VERSION = os.environ.get("GEMINI_API_VERSION", "v1beta")
TEMPO_LIMITE_S = 60
MAX_TOKENS_SAIDA = 4096  # o gemini-2.5-flash gasta parte do limite "pensando"; 1024 cortava respostas
ANTHROPIC_MODEL = os.environ.get("SENTINEL_MODEL", "claude-sonnet-4-20250514")

_gemini_client = None
_anthropic_client = None


def _get_model_name() -> str:
    """Retorna o nome do modelo ativo."""
    if PROVIDER == "gemini":
        return GEMINI_MODEL
    return ANTHROPIC_MODEL


def _get_api_key_name() -> str:
    """Retorna o nome da variavel de ambiente da API key ativa."""
    if PROVIDER == "gemini":
        return "GEMINI_API_KEY"
    return "ANTHROPIC_API_KEY"


_PLACEHOLDER_VALUES = {"coloque_sua_chave_gemini_aqui", "sua_chave_google", "sua_chave_aqui", ""}


def _has_api_key() -> bool:
    """Verifica se a API key do provider ativo esta configurada e nao e placeholder."""
    val = (os.environ.get(_get_api_key_name()) or "").strip()
    return bool(val) and val not in _PLACEHOLDER_VALUES


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError(
                "Variavel de ambiente GEMINI_API_KEY nao definida. "
                "Insira sua chave no arquivo .env"
            )
        from google import genai
        from google.genai import types
        # api_version "v1beta": a v1 (padrão do google-genai 3.x) recusa system_instruction com 400
        # INVALID_ARGUMENT "Developer instruction is not enabled for api version v1". O Sentinel AI depende do
        # prompt de sistema; foi essa a causa do ClientError de 13/11/2026. Timeout explícito em milissegundos.
        _gemini_client = genai.Client(api_key=api_key, http_options=types.HttpOptions(
            api_version=GEMINI_API_VERSION, timeout=TEMPO_LIMITE_S * 1000))
    return _gemini_client


class RespostaInvalida(RuntimeError):
    """O provedor respondeu sem texto utilizável (vazio, cortado ou bloqueado)."""


def _call_gemini(system: str, messages: list) -> str:
    """Envia mensagens para o Gemini e retorna a resposta como texto."""
    from google.genai import types

    client = _get_gemini_client()

    # Converte mensagens do formato {role, content} para Content do Gemini
    # Gemini usa "user" e "model" (nao "assistant")
    contents = []
    for msg in messages:
        role = msg["role"]
        if role == "assistant":
            role = "model"
        contents.append(
            types.Content(
                role=role,
                parts=[types.Part(text=msg["content"])],
            )
        )

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=MAX_TOKENS_SAIDA,
        ),
    )
    texto = response.text
    if not (texto or "").strip():
        motivo = None
        if getattr(response, "candidates", None):
            motivo = getattr(response.candidates[0], "finish_reason", None)
        raise RespostaInvalida(f"resposta sem texto (finish_reason={motivo})")
    return texto


# ---------------------------------------------------------------------------
# Anthropic (secundario)
# ---------------------------------------------------------------------------

def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError(
                "Variavel de ambiente ANTHROPIC_API_KEY nao definida. "
                "Insira sua chave no arquivo .env"
            )
        from anthropic import Anthropic
        _anthropic_client = Anthropic(api_key=api_key)
    return _anthropic_client


def _call_anthropic(system: str, messages: list) -> str:
    """Envia mensagens para o Claude e retorna a resposta como texto."""
    client = _get_anthropic_client()
    response = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1024,
        system=system,
        messages=messages,
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def _call_llm(system: str, messages: list) -> str:
    """Chama o provider configurado e retorna a resposta."""
    if PROVIDER == "gemini":
        return _call_gemini(system, messages)
    elif PROVIDER == "anthropic":
        return _call_anthropic(system, messages)
    else:
        raise ValueError(f"Provider desconhecido: {PROVIDER}")


# ---------------------------------------------------------------------------
# System Prompt — Sentinel AI
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = r"""
## Atuacao

Voce e o **Sentinel AI**, assistente tecnico do **NodeWatch**, um prototipo academico de deteccao de lavagem de
dinheiro (AML) em transacoes financeiras. Voce apoia analistas humanos: ajuda a interpretar a analise aberta no
painel (score, alertas, motivos verificaveis, contas prioritarias e o grafo da conta em foco), as metricas do modelo
e a navegacao pela tela, em linguagem clara, tecnica e objetiva.

No NodeWatch, contas sao vertices e transacoes sao arestas direcionadas. Um modelo de Machine Learning (Random
Forest) pontua cada transacao com atributos calculados so com o passado de cada conta; o painel desenha a rede da
conta em foco para a investigacao. O padrao de interesse e a lavagem de dinheiro, por exemplo o *layering*: o
dinheiro passa por contas intermediarias para dificultar o rastreamento.

Sua funcao e **explicar, orientar e recomendar investigacao**, nunca tomar decisoes finais de bloqueio, acusacao
ou encerramento de conta.

---

## Restricoes Obrigatorias

* Nunca declare que uma conta "cometeu fraude".
* Nunca bloqueie, aprove ou rejeite uma transacao.
* Nunca tome decisao final no lugar do analista.
* Nunca invente valores, scores, nomes de contas ou dados que nao estejam na interface ou no JSON recebido.
* Nunca afirme que o sistema e conclusivo.
* Sempre trate os alertas como **indicios para investigacao**.
* Se a informacao nao estiver disponivel na interface atual, informe isso claramente.
* Mantenha tom profissional, direto e vigilante.
* Evite linguagem alarmista.

---

## Instrucao Final

Responda sempre em portugues do Brasil.
Atue como um assistente tecnico de investigacao, nao como autoridade decisoria.
""".strip()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

LANGUAGE_PROMPT_LEIGA = """
## MODO DE LINGUAGEM ATUAL: leiga

Use linguagem simples, clara e acessivel para pessoas sem conhecimento tecnico.
Evite jargoes. Quando precisar usar um termo tecnico, explique em seguida.
Prefira frases curtas.
Explique o score como "uma nota de prioridade: quanto maior, mais vale a pena olhar primeiro".
Explique layering como "tentativa de dificultar o rastreamento do dinheiro passando por varias contas".
Use analogias simples quando possivel.
"""

LANGUAGE_PROMPT_TECNICA = """
## MODO DE LINGUAGEM ATUAL: tecnica

Use linguagem tecnica e precisa.
Pode usar termos como Random Forest, atributos, limiar, precisao, recall, average precision, grafo direcionado,
vertices, arestas, layering e comportamento transacional anomalo.
Mesmo em modo tecnico, nao afirme fraude nem lavagem definitiva.
"""


# ---------------------------------------------------------------------------
# Painel do analista: o Sentinel AI por trás do "Assistente de dúvidas"
# ---------------------------------------------------------------------------

PROMPT_PAINEL = """
## MODO PAINEL DO ANALISTA — prevalece sobre as seções anteriores quando houver conflito

Voce esta respondendo dentro do **Assistente de duvidas** do Painel do analista do NodeWatch. Para o usuario, o
seu nome e **"Assistente de duvidas"**; "Sentinel AI" e o nome interno da tecnologia. Se perguntarem quem voce e,
diga que e o Assistente de duvidas do NodeWatch (tecnologia Sentinel AI).

As **Restricoes Obrigatorias** acima valem integralmente.

### Fonte unica de dados
Use apenas o JSON `contexto_painel` abaixo. Ele foi montado pelo servidor a partir dos resultados gravados da
analise, do modelo salvo e das metricas oficiais. Nunca invente numeros, contas, transacoes, atributos, pesos do
modelo ou explicacoes. Se a informacao nao esta no contexto, diga que nao esta disponivel e sugira onde o
analista pode ver na tela (Visao geral, Contas de maior risco, grafo, Registros, Detalhes da transacao,
Legenda, painel operacional ☰).

### Como o modelo funciona (para explicar corretamente)
- Cabeca `lavagem`: floresta aleatoria (Random Forest) do scikit-learn, supervisionada, treinada no IBM AML
  HI-Small (sintetico) com o rotulo `Is Laundering`, sobre 49 atributos que so olham o passado da transacao.
- Score original (0 a 1) = proporcao media de lavagem nas folhas das arvores; **nao e probabilidade calibrada**.
- Score do painel (0 a 1000) = ordem de prioridade ancorada no limiar: score 701 = limiar do modelo. Alerta =
  score >= 701. Faixas sao sugestoes de uma analise offline; o sistema nao bloqueia nem aprova nada.
- **Nao existe explicacao por transacao gravada.** Para "por que esta transacao foi classificada assim?":
  (1) diga o score, o score original e o limiar; (2) liste os `motivos` verificaveis como FATOS sobre a
  transacao, deixando claro que sao regras fixas e nao a explicacao do modelo; (3) se ajudar, cite as
  `importancias_globais` como informacao sobre o MODELO, nunca como "o que pesou nesta transacao";
  (4) diga explicitamente o que nao e possivel saber (ex.: contribuicao de cada atributo nesta decisao).
- Tipologias e rotulo vem do dataset (simulador), nao do modelo.
- Cite cada transacao pelo campo `id_na_tela` (TX- seguido de pelo menos 6 digitos), exatamente como aparece
  na tabela do painel; nunca escreva o numero sem o prefixo TX-.
- Diferencie metricas historicas do teste oficial (`avaliacao_historica`) dos numeros da analise aberta.

### Formato obrigatorio
Responda em portugues do Brasil, de forma objetiva (ate ~250 palavras, salvo pedido). Organize em secoes com
estes titulos, nesta ordem, omitindo a secao que ficar vazia (mas **Fatos** e **Limitacoes** sempre aparecem
quando a pergunta for sobre resultados, alertas ou classificacoes):

**Fatos** — so o que esta no contexto, com os numeros exatos.
**Inferencias** — conclusoes que decorrem dos fatos (diga de quais).
**Hipoteses** — possibilidades a investigar, marcadas como incertas; nunca como conclusao.
**Limitacoes** — o que o contexto nao permite afirmar.

Termine com um proximo passo de investigacao na tela, quando fizer sentido. Nunca diga que houve fraude ou
lavagem; diga que ha sinais para investigacao.
"""


_SDK = {"gemini": ("google.genai", "google-genai"), "anthropic": ("anthropic", "anthropic")}


def _sdk_instalado() -> bool:
    import importlib.util
    modulo = _SDK.get(PROVIDER, (None, None))[0]
    try:
        return bool(modulo) and importlib.util.find_spec(modulo) is not None
    except (ImportError, ValueError):
        return False


def como_ativar(sit: dict) -> str:
    """O que falta para o Sentinel AI funcionar (texto para a tela), ou '' se nada falta."""
    if not sit["chave_configurada"]:
        return (f"Defina {sit['variavel_da_chave']} no arquivo .env (o iniciar.bat pergunta) "
                "e reinicie o servidor.")
    if not sit["biblioteca_instalada"]:
        return (f"Instale a biblioteca {sit['biblioteca']} no ambiente do projeto "
                "(python -m pip install -r requirements.txt) e reinicie o servidor.")
    return ""


def situacao() -> dict:
    """Se o Sentinel AI pode ser usado agora (sem expor a chave): precisa da chave e da biblioteca do provedor."""
    chave, sdk = _has_api_key(), _sdk_instalado()
    return {"disponivel": chave and sdk, "provedor": PROVIDER, "modelo": _get_model_name(),
            "variavel_da_chave": _get_api_key_name(), "chave_configurada": chave, "biblioteca_instalada": sdk,
            "biblioteca": _SDK.get(PROVIDER, (None, PROVIDER))[1]}


def responder_painel(pergunta: str, historico: list, contexto: dict, modo_linguagem: str = "leiga") -> str:
    """Resposta do Sentinel AI no Assistente de dúvidas: prompt de sistema, modo de linguagem, bloco do painel
    e o contexto verificado da análise."""
    import json

    lang = LANGUAGE_PROMPT_TECNICA if modo_linguagem == "tecnica" else LANGUAGE_PROMPT_LEIGA
    system = (SYSTEM_PROMPT + "\n" + lang + "\n" + PROMPT_PAINEL +
              "\n\n## contexto_painel (JSON)\n\n```json\n" +
              json.dumps(contexto, ensure_ascii=False, indent=1, default=str) + "\n```")
    mensagens = [{"role": m["role"], "content": str(m["content"])[:4000]} for m in (historico or [])
                 if m.get("role") in ("user", "assistant") and str(m.get("content") or "").strip()][-10:]
    mensagens.append({"role": "user", "content": pergunta})
    return _call_llm(system, mensagens)


# ---------------------------------------------------------------------------
# Diagnóstico: classificação dos erros e estado REAL da conexão (não basta haver chave)
# ---------------------------------------------------------------------------
import re as _re
import threading as _threading
from datetime import datetime as _dt, timezone as _tz

_trava_estado = _threading.Lock()
_conexao = {"estado": "nao_verificado", "quando": None, "categoria": None, "mensagem": None}

# categoria → (mensagem para o usuário, o que fazer, vale tentar de novo?)
CATEGORIAS = {
    "sem_chave": ("a chave do Gemini não está configurada", "Defina GEMINI_API_KEY no .env e reinicie o servidor.", False),
    "biblioteca_ausente": ("a biblioteca do provedor não está instalada",
                           "Rode python -m pip install -r requirements.txt e reinicie o servidor.", False),
    "chave_invalida": ("a chave do Gemini foi recusada (inválida ou revogada)",
                       "Confira a chave em aistudio.google.com/apikey, corrija o .env e reinicie o servidor.", False),
    "autenticacao": ("o Gemini não aceitou a autenticação", "Confira a chave no .env e reinicie o servidor.", False),
    "permissao": ("a chave não tem permissão para usar este modelo ou esta API",
                  "Confira se a Generative Language API está habilitada para a chave.", False),
    "modelo_indisponivel": ("o modelo configurado não existe ou não está disponível para a chave",
                            "Confira GEMINI_MODEL no .env (padrão: gemini-2.5-flash).", False),
    "requisicao_invalida": ("o Gemini recusou o formato do pedido", "Veja o detalhe técnico nos logs do servidor.", False),
    "limite": ("o limite de uso da API foi atingido", "Espere alguns minutos (ou até a cota renovar) e tente de novo.", True),
    "timeout": ("o Gemini demorou demais para responder", "Tente de novo em instantes.", True),
    "conexao": ("não foi possível conectar ao Gemini", "Confira a internet (proxy/firewall) e tente de novo.", True),
    "servico_indisponivel": ("o serviço do Gemini está indisponível no momento", "Tente de novo em instantes.", True),
    "resposta_invalida": ("o Gemini respondeu sem texto utilizável", "Tente de novo ou reformule a pergunta.", True),
    "erro_interno": ("ocorreu um erro interno ao falar com o Gemini", "Veja o detalhe técnico nos logs do servidor.", True),
}

_PADRAO_CHAVE = _re.compile(r"AIza[0-9A-Za-z_\-]{20,}|sk-ant-[0-9A-Za-z_\-]{10,}")


def mascarar(texto: str) -> str:
    """Remove chaves de API de qualquer texto que vá para logs ou para a tela."""
    t = str(texto)
    for nome in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY"):
        v = (os.environ.get(nome) or "").strip()
        if len(v) >= 8:
            t = t.replace(v, "***")
    return _PADRAO_CHAVE.sub("***", t)


def classificar_erro(exc: BaseException) -> dict:
    """Categoria, mensagem ao usuário e detalhe técnico (mascarado) de uma falha do provedor."""
    codigo = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    status = str(getattr(exc, "status", "") or "")
    msg = str(getattr(exc, "message", None) or exc)
    nome = type(exc).__name__
    baixo = (msg + " " + status).lower()
    if isinstance(exc, RespostaInvalida):
        cat = "resposta_invalida"
    elif isinstance(exc, ImportError):
        cat = "biblioteca_ausente"
    elif isinstance(exc, ValueError) and "api_key" in baixo.replace(" ", "_"):
        cat = "sem_chave"
    elif isinstance(codigo, int):
        if codigo == 400 and ("api key not valid" in baixo or "api_key_invalid" in baixo):
            cat = "chave_invalida"
        elif codigo == 401:
            cat = "autenticacao"
        elif codigo == 403:
            cat = "chave_invalida" if "api key" in baixo else "permissao"
        elif codigo == 404:
            cat = "modelo_indisponivel"
        elif codigo == 429:
            cat = "limite"
        elif codigo in (408, 504):
            cat = "timeout"
        elif codigo >= 500:
            cat = "servico_indisponivel"
        else:
            cat = "requisicao_invalida"
    elif "timeout" in nome.lower() or isinstance(exc, TimeoutError):
        cat = "timeout"
    elif "connect" in nome.lower() or "network" in nome.lower() or isinstance(exc, (ConnectionError, OSError)):
        cat = "conexao"
    else:
        cat = "erro_interno"
    texto, acao, repetir = CATEGORIAS[cat]
    detalhe = mascarar(f"{nome}" + (f" {codigo}" if codigo else "") + (f" {status}" if status else "") + f": {msg}")[:500]
    return {"categoria": cat, "mensagem": texto, "acao": acao, "tentar_de_novo": repetir, "detalhe_tecnico": detalhe}


def _marcar(estado: str, categoria=None, mensagem=None) -> None:
    with _trava_estado:
        _conexao.update(estado=estado, categoria=categoria, mensagem=mensagem,
                        quando=_dt.now(_tz.utc).isoformat(timespec="seconds"))


def registrar_sucesso() -> None:
    _marcar("conectado")


def registrar_falha(info: dict) -> None:
    _marcar("falhou", info["categoria"], info["mensagem"])


def estado_conexao() -> dict:
    """Último resultado REAL de uma chamada ao provedor neste processo (ter a chave não prova que funciona)."""
    sit = situacao()
    with _trava_estado:
        c = dict(_conexao)
    if not sit["disponivel"]:
        c.update(estado="nao_configurado", categoria="sem_chave" if not sit["chave_configurada"] else "biblioteca_ausente")
    return c


def verificar_conexao() -> dict:
    """Chamada mínima e real (mesmo cliente, mesmo prompt de sistema curto) para testar a conexão agora."""
    try:
        _call_llm("Responda apenas com a palavra OK.", [{"role": "user", "content": "Teste de conexão do NodeWatch."}])
        registrar_sucesso()
    except Exception as exc:  # classificado, sem expor a chave
        info = classificar_erro(exc)
        registrar_falha(info)
        return {**estado_conexao(), **{k: info[k] for k in ("acao", "tentar_de_novo", "detalhe_tecnico")}}
    return estado_conexao()
