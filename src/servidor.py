"""Servidor do NodeWatch (Flask): painel do analista e a API dele.

Rotas:
    /                 painel do analista (interface/painel.html)
    /assets/<arquivo> arquivos estáticos do painel (interface/assets)
    /api/painel/*     API do painel (src/painel/api.py)
    /health           situação do servidor e do Sentinel AI

Ao iniciar, instala e confere o modelo de ML (src/ml/provisionamento.py) e só
aceita pedidos locais (src/seguranca_local.py). O painel funciona sem chave de
API; a chave (GEMINI_API_KEY ou ANTHROPIC_API_KEY no .env) só ativa o Sentinel
AI no Assistente de dúvidas, com a autorização do analista na tela.

Uso:
    python src/servidor.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Carrega variaveis do .env (raiz do projeto)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Permite importar src.* tanto via ``python src/servidor.py`` quanto ``python -m src.servidor``
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from src.painel.api import bp as painel_bp  # noqa: E402

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

_INTERFACE_DIR = _PROJECT_ROOT / "interface"

app = Flask(__name__)
# Limite global para corpos lidos na memória (pedidos JSON). O envio de datasets do painel (/api/painel/datasets)
# desliga este limite no próprio pedido: o arquivo vai para o disco em blocos, sem passar inteiro pela memória.
app.config["MAX_CONTENT_LENGTH"] = 800 * 1000 * 1000
app.register_blueprint(painel_bp)  # painel do analista (/api/painel)

from src.sentinel_ia import PROVIDER  # noqa: E402
HOST = os.environ.get("SENTINEL_HOST", "127.0.0.1")
PORT = int(os.environ.get("SENTINEL_PORT", "5000"))

# Acesso local (src/seguranca_local.py): nada de "Access-Control-Allow-Origin: *". A página e a API saem do
# mesmo servidor, então nenhum cabeçalho CORS é necessário; só as origens listadas em NODEWATCH_ORIGENS
# (vazia por padrão) recebem permissão explícita.
from src import seguranca_local  # noqa: E402

ORIGENS_EXTRAS = seguranca_local.origens_extras(os.environ.get("NODEWATCH_ORIGENS"))
if ORIGENS_EXTRAS:
    CORS(app, origins=ORIGENS_EXTRAS)


@app.before_request
def _somente_acesso_local():
    """Recusa pedidos com Host não local e pedidos de outra origem às rotas /api (ver seguranca_local)."""
    recusa = seguranca_local.verificar(
        request.method, request.path, request.scheme, request.host, request.headers.get("Origin"),
        request.headers.get("Sec-Fetch-Site"), ORIGENS_EXTRAS, HOST)
    if recusa:
        status, erro, acao = recusa
        return jsonify({"erro": erro, "acao": acao}), status
    return None

# Motor do Sentinel AI (provedores, prompt de sistema, modos de linguagem): src/sentinel_ia.py.
# Atende o Assistente de dúvidas do painel (/api/painel/assistente).
from src.sentinel_ia import _get_api_key_name, _get_model_name, _has_api_key  # noqa: E402


@app.route("/")
def index():
    """Painel do analista (dataset → análise → investigação)."""
    return send_from_directory(str(_INTERFACE_DIR), "painel.html")


@app.route("/assets/<path:filename>")
def serve_assets(filename):
    """Serve arquivos estaticos da pasta interface/assets."""
    return send_from_directory(str(_INTERFACE_DIR / "assets"), filename)


@app.route("/health", methods=["GET"])
def health():
    """Health check do Sentinel AI."""
    return jsonify({
        "status": "ok",
        "service": "Sentinel AI",
        "provider": PROVIDER,
        "model": _get_model_name(),
        "apiKeyConfigured": _has_api_key(),
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def linhas_de_inicio(host: str = HOST, porta: int = PORT, origens_extras=None) -> list:
    """Endereços mostrados ao iniciar (e avisos de acesso fora do padrão local)."""
    origens_extras = ORIGENS_EXTRAS if origens_extras is None else origens_extras
    base = f"http://{host}:{porta}"
    linhas = [f"  Servidor: {base}"]
    if not seguranca_local.host_local(host):
        linhas.append(f"  [AVISO] SENTINEL_HOST={host}: o servidor deixa de ser so local. A API continua recusando"
                      " pedidos de outras origens, mas os dados ficam visiveis para quem alcancar esta maquina.")
    if origens_extras:
        linhas.append(f"  Origens extras liberadas (NODEWATCH_ORIGENS): {', '.join(origens_extras)}")
        if "null" in origens_extras:
            linhas.append("  [AVISO] A origem null tambem vale para iframes sandbox de qualquer site, que agora podem"
                          " chamar a API. Use so enquanto precisar e reinicie o servidor sem NODEWATCH_ORIGENS.")
    linhas += [
        "",
        f"  >> Painel do analista: {base}/",
        f"  Health: {base}/health",
    ]
    return linhas


if __name__ == "__main__":
    print("=" * 55)
    print("  Sentinel AI - Assistente de Analise de Fraudes")
    print("=" * 55)
    print(f"\n  Provider: {PROVIDER}")
    print(f"  Modelo:   {_get_model_name()}")
    if not _has_api_key():
        key_name = _get_api_key_name()
        print(
            f"\n[AVISO] {key_name} nao definida! Ela ativa o Sentinel AI no Assistente de duvidas do painel\n"
            "  (com a sua autorizacao na tela). Sem ela, o painel do analista funciona sem chave e o\n"
            "  assistente responde no modo local.\n"
            "  Copie .env.example para .env e insira sua chave:\n"
            "  Windows:    Copy-Item .env.example .env\n"
            "  Linux/Mac:  cp .env.example .env\n"
        )
    else:
        print("  API Key:  configurada")
    print()
    # Modelo de ML: instala a partir de modelos/ (ou baixa, conferindo o SHA-256) e valida antes de servir.
    # Se falhar, o servidor sobe assim mesmo (análises gravadas continuam abrindo) e o painel mostra o motivo.
    from src.ml import provisionamento
    try:
        print("\n".join(provisionamento._linhas(provisionamento.garantir_modelo(_PROJECT_ROOT))))
    except provisionamento.ErroModelo as exc:
        print(f"[ERRO] Modelo de ML indisponivel: {exc.causa}\n       O que fazer: {exc.acao}\n"
              "       O painel abre, mas novas analises ficam bloqueadas ate o modelo ser instalado.")
    print()
    print("\n".join(linhas_de_inicio()))
    print("-" * 55)
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
