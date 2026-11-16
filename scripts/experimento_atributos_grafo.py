"""Experimento isolado: 49 atributos atuais x 49 + atributos de grafo point-in-time.

Não grava nada no projeto: lê o HI-Small, recalcula tudo em memória e salva só
o JSON de resultado na pasta passada em --saida. Mesma semente, mesmo split,
mesmos hiperparâmetros e mesmo critério de limiar do treino oficial.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--projeto", required=True)
ap.add_argument("--trans", required=True)
ap.add_argument("--padroes", required=True)
ap.add_argument("--saida", required=True)
ap.add_argument("--janela_h", type=int, default=24)
args = ap.parse_args()
sys.path.insert(0, args.projeto)

from sklearn.metrics import average_precision_score  # noqa: E402

from src.ml.avaliacao import limiar_max_f1, metricas_binarias, recall_por_grupo  # noqa: E402
from src.ml.config import PADRAO  # noqa: E402
from src.ml.ingestao import casar_padroes, ler_hismall, ler_padroes  # noqa: E402
from src.ml.modelos import recriar_estimador  # noqa: E402
from src.ml.preparacao import (MINUTOS_DIA, PreparadorFinanceiro, amostrar_treino_financeiro,  # noqa: E402
                               atribuir_split_financeiro, atributos_financeiros, minuto_de,
                               montar_pipeline_financeiro)

T0 = time.perf_counter()


def log(msg: str) -> None:
    print(f"[{time.perf_counter() - T0:7.1f}s] {msg}", flush=True)


fin = PADRAO["financeiro"]
SEMENTE, N_JOBS = PADRAO["geral"]["semente"], PADRAO["geral"]["n_jobs"]
PARAMS = {"n_estimators": 100, "min_samples_leaf": 50, "max_samples": 0.5}

log("lendo HI-Small")
dados = ler_hismall(args.trans)
t = dados.trans
y = t["rotulo"].to_numpy()
n = len(t)
log(f"{n:,} transações")


# ---------------------------------------------------------------------------
# Atributos de grafo point-in-time (só minutos estritamente anteriores)
# ---------------------------------------------------------------------------
def atributos_grafo(t: pd.DataFrame, janela_min: int):
    minuto = t["minuto"].to_numpy(dtype=np.int64)
    o_all = t["conta_origem"].to_numpy(dtype=np.int64)
    d_all = t["conta_destino"].to_numpy(dtype=np.int64)
    n_contas = int(max(o_all.max(), d_all.max())) + 1

    # (1) Reciprocidade em lote: o par inverso (destino -> origem) já ocorreu em minuto anterior?
    t1 = time.perf_counter()
    chave = o_all * np.int64(1 << 31) + d_all
    inversa = d_all * np.int64(1 << 31) + o_all
    prim = pd.Series(minuto).groupby(chave).min()
    prim_inv = pd.Series(inversa).map(prim).to_numpy()          # NaN se o par inverso nunca ocorre
    reciproco_lote = np.where(np.isnan(prim_inv), 0.0, (prim_inv < minuto).astype(np.float64)).astype(np.float32)
    seg_recip = time.perf_counter() - t1

    # (2,3) Cadeia pela última entrada da conta: profundidade e "volta à raiz" (fecha ciclo).
    # Estado por conta (incremental por construção): minuto, profundidade e raiz da última entrada.
    t2 = time.perf_counter()
    ordem = np.argsort(minuto, kind="stable")
    m_ord = minuto[ordem]
    cortes = np.flatnonzero(np.diff(m_ord)) + 1
    grupos = np.split(ordem, cortes)
    ult_min = np.full(n_contas, -(1 << 40), dtype=np.int64)
    ult_prof = np.zeros(n_contas, dtype=np.int16)
    ult_raiz = np.arange(n_contas, dtype=np.int64)
    prof = np.ones(len(t), dtype=np.int16)
    fecha = np.zeros(len(t), dtype=np.float32)
    # Reciprocidade incremental (para conferir com o lote): conjunto de pares vistos.
    vistos: set = set()
    reciproco_inc = np.zeros(len(t), dtype=np.float32)
    for g in grupos:
        tm = minuto[g[0]]
        oo, dd = o_all[g], d_all[g]
        ok = ult_min[oo] >= tm - janela_min
        p = np.where(ok, ult_prof[oo] + 1, 1).astype(np.int16)
        np.minimum(p, 20, out=p)
        r = np.where(ok, ult_raiz[oo], oo)
        prof[g] = p
        fecha[g] = ((r == dd) & (p >= 2) & (oo != dd)).astype(np.float32)
        inv = (dd * np.int64(1 << 31) + oo).tolist()
        reciproco_inc[g] = np.fromiter((k in vistos for k in inv), dtype=np.float32, count=len(inv))
        # incorpora o minuto inteiro só depois de pontuá-lo; empate de destino: fica a maior profundidade
        sel = np.argsort(p, kind="stable")
        ult_min[dd[sel]] = tm
        ult_prof[dd[sel]] = p[sel]
        ult_raiz[dd[sel]] = r[sel]
        vistos.update((oo * np.int64(1 << 31) + dd).tolist())
    seg_cadeia = time.perf_counter() - t2
    X = pd.DataFrame({
        "g_reciproco": reciproco_lote,
        "g_profundidade_cadeia": prof.astype(np.float32),
        "g_fecha_ciclo_cadeia": fecha,
    })
    eq = {
        "reciprocidade_lote_vs_incremental_linhas_diferentes": int((reciproco_lote != reciproco_inc).sum()),
        "linhas_comparadas": int(len(t)),
        "nota_cadeia": "profundidade e fecha_ciclo são calculados por um laço minuto a minuto com estado por "
                       "conta, ou seja, já no formato incremental; não há versão em lote separada para comparar.",
    }
    return X, {"reciprocidade_s": round(seg_recip, 1), "cadeia_s": round(seg_cadeia, 1)}, eq


log("atributos de grafo")
G, tempos_g, equivalencia = atributos_grafo(t, args.janela_h * 60)
log(f"grafo: {tempos_g}; equivalência {equivalencia['reciprocidade_lote_vs_incremental_linhas_diferentes']} linhas diferentes")

# ---------------------------------------------------------------------------
# Mesmo split, mesma amostragem e mesmos 49 atributos do treino oficial
# ---------------------------------------------------------------------------
split = atribuir_split_financeiro(t["minuto"].to_numpy(), fin)
idx = {sp: np.flatnonzero(split == sp) for sp in ("treino", "validacao", "teste")}
prep = PreparadorFinanceiro.ajustar(t.iloc[idx["treino"]])
rel, pesos = amostrar_treino_financeiro(y[idx["treino"]], fin["fracao_negativos_treino"], SEMENTE)
idx_tr = idx["treino"][rel]
consulta = np.concatenate([idx_tr, idx["validacao"], idx["teste"]])
log(f"49 atributos de {len(consulta):,} linhas")
t3 = time.perf_counter()
X = atributos_financeiros(t, consulta, prep)
seg_49 = time.perf_counter() - t3
log(f"{X.shape[1]} atributos em {seg_49:.0f}s")
Xg = pd.concat([X.reset_index(drop=True), G.iloc[consulta].reset_index(drop=True)], axis=1)
c1, c2 = len(idx_tr), len(idx_tr) + len(idx["validacao"])
ytr, yva, yte = y[idx_tr], y[idx["validacao"]], y[idx["teste"]]
dia_te = pd.to_datetime(t["minuto"].to_numpy()[idx["teste"]] // MINUTOS_DIA, unit="D").strftime("%Y-%m-%d").to_numpy()

# tipologias (mesma regra de _avaliar_por_padrao)
casados = casar_padroes(dados, ler_padroes(args.padroes)).dropna(subset=["id_transacao"])
casados["id_transacao"] = casados["id_transacao"].astype(np.int64)
inicio = casados.groupby("tentativa")["minuto"].transform("min")
casados["ja"] = inicio < minuto_de(fin["validacao_ate"])
ids_te = t["id_transacao"].to_numpy()[idx["teste"]]
pos_te = yte == 1
mp = pd.DataFrame({"id": ids_te[pos_te]}).merge(
    casados.drop_duplicates("id_transacao")[["id_transacao", "tipo_padrao", "ja"]],
    left_on="id", right_on="id_transacao", how="left")
tipo = mp["tipo_padrao"].fillna("sem_padrao")
inicio_tent = mp["ja"].map({True: "iniciada_antes", False: "nova"}).fillna("sem_padrao")

# distribuição dos novos atributos entre positivos e negativos do teste
Gte = G.iloc[idx["teste"]]
distrib = {c: {"media_lavagem": float(Gte[c][pos_te].mean()), "media_normal": float(Gte[c][~pos_te].mean())}
           for c in G.columns}
distrib["g_fecha_ciclo_cadeia"]["fracao_lavagem_com_1"] = float((Gte["g_fecha_ciclo_cadeia"][pos_te] == 1).mean())
distrib["g_fecha_ciclo_cadeia"]["fracao_normal_com_1"] = float((Gte["g_fecha_ciclo_cadeia"][~pos_te] == 1).mean())
distrib["g_reciproco"]["fracao_lavagem_com_1"] = float((Gte["g_reciproco"][pos_te] == 1).mean())
distrib["g_reciproco"]["fracao_normal_com_1"] = float((Gte["g_reciproco"][~pos_te] == 1).mean())


def rodar(nome: str, M: pd.DataFrame):
    log(f"{nome}: treinando RF")
    t4 = time.perf_counter()
    pipe = montar_pipeline_financeiro(recriar_estimador("random_forest", PARAMS, SEMENTE, N_JOBS), False)
    pipe.fit(M.iloc[:c1], ytr, modelo__sample_weight=pesos)
    seg = time.perf_counter() - t4
    s_va = pipe.predict_proba(M.iloc[c1:c2])[:, 1]
    lim = limiar_max_f1(yva, s_va)
    s_te = pipe.predict_proba(M.iloc[c2:])[:, 1]
    met = metricas_binarias(yte, s_te, lim["limiar"], dia_te)
    met.pop("curva_pr_resumida", None)
    alerta_pos = pd.Series(s_te[pos_te] >= lim["limiar"])
    est = pipe.named_steps["modelo"]
    nomes = list(pipe[:-1].get_feature_names_out())
    imp = dict(sorted(zip(nomes, est.feature_importances_.tolist()), key=lambda kv: -kv[1]))
    out = {
        "n_atributos": M.shape[1], "segundos_treino": round(seg, 1),
        "validacao": {"average_precision": float(average_precision_score(yva, s_va)), **lim},
        "teste": met,
        "recall_por_tipo": recall_por_grupo(tipo, alerta_pos),
        "recall_por_inicio_da_tentativa": recall_por_grupo(inicio_tent, alerta_pos),
        "importancia_top10": dict(list(imp.items())[:10]),
        "importancia_atributos_grafo": {k: v for k, v in imp.items() if k.startswith("g_")},
    }
    log(f"{nome}: AP val={out['validacao']['average_precision']:.4f} AP teste={met['average_precision']:.4f} "
        f"P={met['precisao']:.3f} R={met['recall']:.3f}")
    return out


res = {
    "descricao": "Experimento isolado; não altera artefatos_ml/ nem modelos/.",
    "janela_cadeia_h": args.janela_h,
    "tempos": {"atributos_grafo_5M_linhas": tempos_g, "atributos_49_consulta_s": round(seg_49, 1)},
    "equivalencia": equivalencia,
    "distribuicao_teste": distrib,
    "base_49": rodar("base_49", X),
    "grafo_52": rodar("grafo_52", Xg),
    "segundos_total": None,
}
res["segundos_total"] = round(time.perf_counter() - T0, 1)
Path(args.saida).mkdir(parents=True, exist_ok=True)
(Path(args.saida) / "resultado_experimento_grafo.json").write_text(
    json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
log("fim")
