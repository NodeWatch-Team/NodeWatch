"""Métricas de avaliação do modelo de lavagem (funções puras, sem treino).

Binárias com limiar (precisão, recall, F1, falsos alertas por 10 mil), average
precision, escolha do limiar pelo máximo F1, calibração por faixas e recall por
grupo (por exemplo, por tipologia registrada no dataset).
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_recall_fscore_support,
)



def calibracao_binaria(y: np.ndarray, prob: np.ndarray, n_bins: int = 10) -> Dict[str, Any]:
    y = np.asarray(y, dtype=float)
    prob = np.clip(np.asarray(prob, dtype=float), 0, 1)
    bordas = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(prob, bordas[1:-1]), 0, n_bins - 1)
    caixas = []
    ece = 0.0
    for b in range(n_bins):
        m = idx == b
        if not m.any():
            continue
        pm, fo = float(prob[m].mean()), float(y[m].mean())
        ece += m.mean() * abs(pm - fo)
        caixas.append({"de": float(bordas[b]), "ate": float(bordas[b + 1]), "n": int(m.sum()),
                       "prob_media": pm, "frequencia_observada": fo})
    return {"brier": float(np.mean((prob - y) ** 2)), "ece": float(ece), "caixas": caixas}


def limiar_max_f1(y: np.ndarray, score: np.ndarray) -> Dict[str, float]:
    """Limiar que maximiza o F1 da classe positiva (critério documentado)."""
    p, r, t = precision_recall_curve(np.asarray(y, dtype=int), np.asarray(score, dtype=float))
    with np.errstate(invalid="ignore", divide="ignore"):
        f1 = np.where(p + r > 0, 2 * p * r / (p + r), 0)
    i = int(np.nanargmax(f1[:-1])) if len(t) else 0
    return {"limiar": float(t[i]) if len(t) else 0.5, "f1": float(f1[i]),
            "precisao": float(p[i]), "recall": float(r[i])}


def metricas_binarias(y: np.ndarray, score: np.ndarray, limiar: float,
                      dia: Optional[np.ndarray] = None,
                      ks: Sequence[int] = (50, 100, 500, 1000, 5000)) -> Dict[str, Any]:
    y = np.asarray(y, dtype=int)
    score = np.asarray(score, dtype=float)
    pred = score >= limiar
    tp = int((pred & (y == 1)).sum())
    fp = int((pred & (y == 0)).sum())
    fn = int((~pred & (y == 1)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    saida: Dict[str, Any] = {
        "n": int(len(y)), "positivos": int(y.sum()), "prevalencia": float(y.mean()) if len(y) else None,
        "limiar": float(limiar),
        "verdadeiros_positivos": tp, "falsos_positivos": fp, "falsos_negativos": fn,
        "precisao": prec, "recall": rec,
        "f1": 2 * prec * rec / (prec + rec) if prec + rec else 0.0,
        "falsos_alertas_por_10k": fp / len(y) * 10_000 if len(y) else None,
        "average_precision": float(average_precision_score(y, score)) if y.sum() else None,
    }
    if y.sum():
        p, r, t = precision_recall_curve(y, score)
        alvos = np.linspace(0.05, 0.95, 19)
        pontos = []
        for ra in alvos:
            m = r >= ra
            pontos.append({"recall_min": float(ra), "precisao_max": float(p[m].max()) if m.any() else None})
        saida["curva_pr_resumida"] = pontos
    if dia is not None:
        por_dia = {}
        for d in np.unique(dia):
            m = dia == d
            ys, ss = y[m], score[m]
            ordem = np.argsort(-ss, kind="stable")
            linha = {"n": int(m.sum()), "positivos": int(ys.sum())}
            for k in ks:
                topo = ys[ordem[:k]]
                linha[f"recall@{k}"] = float(topo.sum() / ys.sum()) if ys.sum() else None
                linha[f"precisao@{k}"] = float(topo.mean()) if len(topo) else None
            por_dia[str(d)] = linha
        saida["por_dia_topk"] = por_dia
    return saida


def recall_por_grupo(grupo: pd.Series, pred: pd.Series) -> Dict[str, Any]:
    """Recall de positivos por grupo (ex.: tipo de padrão de lavagem)."""
    q = pd.DataFrame({"g": grupo.astype(str), "p": pred.astype(bool)})
    r = q.groupby("g")["p"].agg(["size", "sum"])
    return {g: {"n": int(v["size"]), "detectados": int(v["sum"]), "recall": float(v["sum"] / v["size"])}
            for g, v in r.iterrows()}


