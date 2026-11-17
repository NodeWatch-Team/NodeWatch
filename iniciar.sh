#!/usr/bin/env bash
# iniciar.sh - inicia o NodeWatch no Linux e no macOS.
# Uso, na raiz do projeto:  ./iniciar.sh      (Windows: iniciar.bat)
# Para parar: Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")"

PY_MIN="3.12"   # numpy==2.5.4 (requirements-ml.txt) exige Python >= 3.12; testado no 3.14

PYTHON=""
for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1; then PYTHON="$c"; break; fi
done
if [ -z "$PYTHON" ]; then
    echo "[ERRO] Python nao encontrado. Instale o Python $PY_MIN ou mais novo (testado no 3.14)."
    exit 1
fi
if ! "$PYTHON" -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"; then
    echo "[ERRO] $("$PYTHON" --version 2>&1) e antigo demais: o NodeWatch precisa do Python $PY_MIN ou mais novo."
    exit 1
fi
echo "[OK] $("$PYTHON" --version 2>&1)"

if [ ! -d .venv ]; then
    echo "[...] Criando o ambiente virtual (.venv)..."
    "$PYTHON" -m venv .venv
fi
VENV_PY=".venv/bin/python"

echo "[...] Instalando as dependencias (precisa de internet no primeiro uso)..."
"$VENV_PY" -m pip install --quiet -r requirements.txt -r requirements-ml.txt
echo "[OK] Dependencias instaladas."

if [ ! -f .env ]; then
    cp .env.example .env
    echo "[OK] .env criado a partir de .env.example."
fi
echo "     A chave GEMINI_API_KEY no .env e opcional: ela so ativa o Sentinel AI no Assistente de duvidas."

echo ""
echo "Iniciando o NodeWatch. Painel do analista: http://127.0.0.1:5000/"
echo ""
exec "$VENV_PY" src/servidor.py
