"""Modelo carregado no processo do servidor.

O painel (``src.api_painel``) e as rotas antigas (``src.api_eventos``) usam o
mesmo objeto para a raiz do projeto: o artefato de ~39 MB é lido uma única
vez por processo (:func:`obter`). Outras raízes (testes, ambiente de teste)
carregam sem cache (:func:`carregar`), para que cada configuração veja o
estado atual da pasta.

Instalação limpa: se ``artefatos_ml/`` ainda não tem o modelo e ``modelos/``
traz o manifesto distribuído, o modelo é instalado (com conferência de
SHA-256, em :mod:`src.ml.provisionamento`) antes de ser carregado.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict

_trava = threading.Lock()
_carregados: Dict[Path, Any] = {}


def carregar(raiz: Path) -> Any:
    """``ModeloUnificado`` de ``raiz/artefatos_ml``, instalando-o de ``modelos/`` se faltar. Sem cache."""
    from src.ml import provisionamento
    from src.ml.modelos import NOME_ARTEFATO, ModeloUnificado

    raiz = Path(raiz)
    pasta = raiz / "artefatos_ml"
    distribuido = raiz / provisionamento.PASTA_DISTRIBUIDA / provisionamento.NOME_MANIFESTO
    if not (pasta / NOME_ARTEFATO).is_file() and distribuido.is_file():
        provisionamento.garantir_modelo(raiz)
    return ModeloUnificado.carregar(pasta)


def obter(raiz: Path) -> Any:
    """Como :func:`carregar`, mas uma única vez por processo para cada raiz."""
    chave = Path(raiz).resolve()
    with _trava:
        if chave not in _carregados:
            _carregados[chave] = carregar(chave)
        return _carregados[chave]
