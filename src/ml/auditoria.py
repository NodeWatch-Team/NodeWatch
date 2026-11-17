"""Auditoria dos dados do IBM AML HI-Small, refeita a cada execução.

As funções devolvem dicionários serializáveis em JSON. ``para_markdown``
gera um resumo legível. Nada aqui altera rótulos ou dados: divergências são
apenas relatadas.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from src.ml.ingestao import DadosHISmall
from src.ml.preparacao import MINUTOS_DIA, atribuir_split_financeiro


def _contagem(s: pd.Series) -> Dict[str, Any]:
    vc = s.value_counts()
    total = int(vc.sum())
    return {str(k): {"n": int(v), "pct": round(100 * v / total, 4)} for k, v in vc.items()}


def _quantis(s: pd.Series, qs=(0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999, 1)) -> Dict[str, float]:
    return {str(q): float(v) for q, v in s.quantile(list(qs)).items()}


# ---------------------------------------------------------------------------
# Financeiro
# ---------------------------------------------------------------------------
def auditar_financeiro(
    dados: DadosHISmall,
    cfg_fin: Dict[str, Any],
    contas: Optional[pd.DataFrame] = None,
    padroes_casados: Optional[pd.DataFrame] = None,
) -> Dict[str, Any]:
    t = dados.trans
    y = t["rotulo"].to_numpy() if "rotulo" in t else None
    dia = pd.to_datetime(t["minuto"].to_numpy() // MINUTOS_DIA, unit="D").strftime("%Y-%m-%d")
    a: Dict[str, Any] = {
        "arquivo": dados.arquivo,
        "sha256": dados.sha256,
        "leitura": dados.relatorio,
        "periodo": [str(pd.to_datetime(t["minuto"].min(), unit="m")),
                    str(pd.to_datetime(t["minuto"].max(), unit="m"))],
    }
    if y is not None:
        a["positivos"] = int(y.sum())
        a["taxa_positivos"] = float(y.mean())
        por_dia = pd.DataFrame({"dia": dia, "y": y}).groupby("dia")["y"].agg(["count", "sum"])
        a["por_dia"] = {d: {"n": int(r["count"]), "positivos": int(r["sum"]),
                            "taxa": float(r["sum"] / r["count"])} for d, r in por_dia.iterrows()}
        volume_mediano = float(por_dia["count"].median())
        a["dias_com_volume_abaixo_1pct_da_mediana"] = [
            d for d, r in por_dia.iterrows() if r["count"] < 0.01 * volume_mediano
        ]
        fmt = pd.DataFrame({"f": t["formato"].astype(str), "y": y}).groupby("f")["y"].agg(["count", "sum"])
        a["formato"] = {f: {"n": int(r["count"]), "positivos": int(r["sum"]),
                            "taxa": float(r["sum"] / r["count"])} for f, r in fmt.iterrows()}
    auto = (t["conta_origem"] == t["conta_destino"]).to_numpy()
    a["auto_transferencias"] = {"n": int(auto.sum()), "positivos": int(y[auto].sum()) if y is not None else None}
    a["moeda_pagamento_diferente_recebimento"] = int(
        (t["moeda_pagamento"].astype(str) != t["moeda_recebimento"].astype(str)).sum())
    a["mesmo_banco"] = int((t["banco_origem"] == t["banco_destino"]).sum())

    split = atribuir_split_financeiro(t["minuto"].to_numpy(), cfg_fin)
    a["splits"] = {}
    for sp in ("treino", "validacao", "teste", "cauda", "fora"):
        msk = split == sp
        a["splits"][sp] = {"n": int(msk.sum()), "positivos": int(y[msk].sum()) if y is not None else None}
    a["limites"] = {k: cfg_fin[k] for k in ("inicio", "treino_ate", "validacao_ate", "teste_ate", "inicio_cauda")}

    if contas is not None and y is not None:
        a["contas"] = _auditar_contas(dados, contas, split)
    if padroes_casados is not None and y is not None:
        a["padroes"] = _auditar_padroes(dados, padroes_casados, split)
    return a


def _ap(y: np.ndarray, score: np.ndarray) -> float:
    from sklearn.metrics import average_precision_score
    return float(average_precision_score(y, score)) if y.sum() else float("nan")


def _auditar_contas(dados: DadosHISmall, contas: pd.DataFrame, split: np.ndarray) -> Dict[str, Any]:
    """Procura atributos de conta que revelem a resposta (medido só no treino).

    Critério: um atributo é ``suspeito`` se, codificado pela taxa de lavagem
    do treino, tiver AP na validação >= 0,5 ou algum valor com lift >= 50 e
    suporte >= 100 transações no treino. Suspeitos não podem virar atributo.
    """
    indice = pd.Index(dados.nomes_contas)
    cod = indice.get_indexer(contas["conta"])
    cobertas = cod >= 0
    tipo = np.full(len(indice), "sem_cadastro", dtype=object)
    tipo[cod[cobertas]] = contas.loc[cobertas, "tipo_entidade"].to_numpy()
    n_por_entidade = contas.groupby("Entity ID")["conta"].transform("count").to_numpy()
    n_contas_ent = np.zeros(len(indice), dtype=np.int64)
    n_contas_ent[cod[cobertas]] = n_por_entidade[cobertas]
    nome_suspeito = contas["Entity Name"].str.contains("launder|fraud|illicit", case=False, na=False)

    t = dados.trans
    y = t["rotulo"].to_numpy()
    o = t["conta_origem"].to_numpy()
    d = t["conta_destino"].to_numpy()
    candidatos = {
        "tipo_entidade_origem": tipo[o],
        "tipo_entidade_destino": tipo[d],
        "n_contas_entidade_origem": np.minimum(n_contas_ent[o], 20).astype(str),
        "n_contas_entidade_destino": np.minimum(n_contas_ent[d], 20).astype(str),
    }
    tr, va = split == "treino", split == "validacao"
    base = float(y[tr].mean())
    resultado: Dict[str, Any] = {}
    for nome, valores in candidatos.items():
        df = pd.DataFrame({"v": valores[tr], "y": y[tr]}).groupby("v")["y"].agg(["count", "mean"])
        taxa = df["mean"].to_dict()
        lift = (df["mean"] / base).where(df["count"] >= 100)
        score_va = pd.Series(valores[va]).map(taxa).fillna(base).to_numpy()
        ap_va = _ap(y[va], score_va)
        suspeito = bool(ap_va >= 0.5 or (lift.max() >= 50 if lift.notna().any() else False))
        resultado[nome] = {
            "ap_validacao": ap_va,
            "lift_max_suporte_100": float(lift.max()) if lift.notna().any() else None,
            "suspeito_de_revelar_resposta": suspeito,
            "taxas_treino": {str(k): {"n": int(df.loc[k, "count"]), "taxa": float(df.loc[k, "mean"])}
                             for k in df.index[:30]},
        }
    return {
        "linhas_arquivo": int(len(contas)),
        "contas_das_transacoes_com_cadastro": float(np.isin(np.arange(len(indice)), cod[cobertas]).mean()),
        "tipos_entidade": _contagem(contas["tipo_entidade"]),
        "nomes_com_termo_suspeito": int(nome_suspeito.sum()),
        "atributos": resultado,
        "base_treino": base,
    }


def _auditar_padroes(dados: DadosHISmall, casados: pd.DataFrame, split: np.ndarray) -> Dict[str, Any]:
    t = dados.trans
    y = t["rotulo"].to_numpy()
    ok = casados["id_transacao"].notna()
    ids = casados.loc[ok, "id_transacao"].astype(np.int64).to_numpy()
    r: Dict[str, Any] = {
        "tentativas": int(casados["tentativa"].nunique()),
        "linhas": int(len(casados)),
        "linhas_casadas": int(ok.sum()),
        "linhas_casadas_com_rotulo_1": int(y[ids].sum()),
        "positivos_sem_padrao": int(y.sum() - len(np.intersect1d(np.flatnonzero(y == 1), ids))),
        "por_tipo": {
            tp: {"tentativas": int(g["tentativa"].nunique()), "linhas": int(len(g))}
            for tp, g in casados.groupby("tipo_padrao")
        },
    }
    sp = pd.Series(split[ids], index=casados.index[ok])
    por_tent = pd.DataFrame({"tentativa": casados.loc[ok, "tentativa"], "split": sp})
    n_splits = por_tent.groupby("tentativa")["split"].nunique()
    r["tentativas_em_mais_de_um_split"] = int((n_splits > 1).sum())
    ordem = {"treino": 0, "validacao": 1, "teste": 2, "cauda": 3, "fora": -1}
    inicio = por_tent.assign(o=por_tent["split"].map(ordem)).groupby("tentativa")["o"].min()
    for alvo_sp in ("validacao", "teste"):
        linhas = por_tent[por_tent["split"] == alvo_sp]
        if len(linhas):
            anteriores = (linhas["tentativa"].map(inicio) < ordem[alvo_sp]).mean()
            r[f"fracao_linhas_{alvo_sp}_de_tentativas_iniciadas_antes"] = float(anteriores)
    return r


# ---------------------------------------------------------------------------
# Saída
# ---------------------------------------------------------------------------
def salvar(auditoria: Dict[str, Any], pasta: Path, nome: str) -> Path:
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / f"{nome}.json"
    destino.write_text(json.dumps(auditoria, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    (pasta / f"{nome}.md").write_text(para_markdown(auditoria, nome), encoding="utf-8")
    return destino


def para_markdown(a: Dict[str, Any], titulo: str) -> str:
    linhas: List[str] = [f"# {titulo}", ""]

    def emitir(chave: str, valor: Any, nivel: int = 0) -> None:
        pref = "  " * nivel + "- "
        if isinstance(valor, dict):
            linhas.append(f"{pref}**{chave}**")
            for k, v in list(valor.items())[:40]:
                emitir(str(k), v, nivel + 1)
        elif isinstance(valor, list) and valor and isinstance(valor[0], dict):
            linhas.append(f"{pref}**{chave}**: {len(valor)} item(ns); primeiros: "
                          + json.dumps(valor[:3], ensure_ascii=False, default=str))
        else:
            linhas.append(f"{pref}{chave}: {valor}")

    for k, v in a.items():
        emitir(k, v)
    return "\n".join(linhas) + "\n"
