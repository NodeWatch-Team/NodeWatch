"""Métricas oficiais e metadados do modelo, lidos dos resultados já gravados.

Nada é treinado nem recalculado aqui: os números vêm dos JSON gerados por
``python -m src.treino.cli treinar``/``avaliar`` (``artefatos_ml/resultados``) ou,
na falta deles, da cópia versionada em ``docs/ml/resultados``. Alimenta a
legenda do score e a aba de métricas do painel (``src/painel/api.py``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional, Sequence, Tuple


def ler_json(caminho: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def ler_primeiro(raiz: Path, nome: str, pastas: Sequence[str]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    for pasta in pastas:
        dados = ler_json(raiz / pasta / nome)
        if dados is not None:
            return dados, f"{pasta}/{nome}"
    return None, None


PASTAS_RESULTADOS = ("artefatos_ml/resultados", "docs/ml/resultados")
PASTAS_METADADOS = ("artefatos_ml", "docs/ml/resultados")


def modelo_resumo(raiz: Path) -> Dict[str, Any]:
    meta, fonte = ler_primeiro(raiz, "metadados_modelo.json", PASTAS_METADADOS)
    if meta is None:
        return {"disponivel": False, "motivo": "metadados_modelo.json não encontrado (rode `python -m src.treino.cli treinar`)"}
    cabecas = {}
    for nome, c in (meta.get("cabecas") or {}).items():
        md = c.get("metadados") or {}
        cabecas[nome] = {
            "status": meta.get("tarefas", {}).get(nome),
            "familia": c.get("familia"), "params": c.get("params"), "limiar_alerta": c.get("limiar_alerta"),
            "versao": md.get("versao"), "treinado_ate": md.get("treinado_ate_utc") or md.get("treinado_ate"),
            "criterio_selecao": md.get("criterio_selecao"), "criterio_limiar": md.get("criterio_limiar"),
            "limites": md.get("limites"), "n_treino": md.get("n_treino") or md.get("n_treino_periodo"),
            "n_validacao": md.get("n_validacao"),
            "motivo": c.get("motivo"), "requisitos": c.get("requisitos"), "aviso": md.get("aviso"),
        }
    artefato = raiz / "artefatos_ml" / "modelo_unificado.joblib"
    return {
        "disponivel": True, "fonte": fonte, "versoes": (meta.get("metadados") or {}).get("versoes"),
        "salvo_em": (meta.get("metadados") or {}).get("salvo_em"), "cabecas": cabecas,
        "artefato_bytes": artefato.stat().st_size if artefato.is_file() else None,
    }


def avaliacao_oficial(raiz: Path) -> Dict[str, Any]:
    saida: Dict[str, Any] = {}
    for tarefa, arq_aval, arq_treino in (("lavagem", "avaliacao_lavagem.json", "treino_lavagem.json"),):
        aval, f_aval = ler_primeiro(raiz, arq_aval, PASTAS_RESULTADOS)
        treino, f_treino = ler_primeiro(raiz, arq_treino, PASTAS_RESULTADOS)
        if aval is None:
            saida[tarefa] = {"disponivel": False,
                             "motivo": f"{arq_aval} não encontrado (rode `python -m src.treino.cli avaliar`)"}
            continue
        bloco: Dict[str, Any] = {"disponivel": True, "fontes": [f for f in (f_aval, f_treino) if f],
                                 "versao": aval.get("versao"), "escolhido": aval.get("escolhido")}
        if treino:
            bloco["grade_validacao"] = treino.get("grade_validacao")
            bloco["limiar_validacao"] = treino.get("limiar")
            bloco["escolhido_nome"] = (treino.get("escolhido") or {}).get("nome")
        for parte in ("teste", "cauda"):
            p = aval.get(parte) or {}
            bloco[parte] = {}
            for ref in ("modelo", "baseline_prevalencia", "baseline_formato"):
                if ref in p:
                    bloco[parte][ref] = {k: v for k, v in p[ref].items() if k != "curva_pr_resumida"}
            if "padroes" in p:
                bloco[parte]["padroes"] = p["padroes"]
            if "calibracao" in p:
                bloco[parte]["calibracao"] = {k: v for k, v in p["calibracao"].items() if k != "caixas"}
        saida[tarefa] = bloco
    saida["reuso_do_teste"] = (
        "O período de teste já foi consultado mais de uma vez (avaliação de 26/10/2026, comparação de "
        "candidatos na auditoria de 02/11/2026 e reavaliação de 02/11/2026). Os números de teste não são "
        "uma avaliação inédita; diferenças pequenas não são melhoria comprovada. Ver docs/ml/notas_relatorio.md, "
        "seção 6."
    )
    saida["modelo"] = modelo_resumo(raiz)
    return saida
