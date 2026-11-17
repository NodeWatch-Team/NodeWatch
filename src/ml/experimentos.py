"""Orquestração do modelo de lavagem: treino (seleção na validação) e avaliação final (teste).

Protocolo:

1. auditoria dos dados (refeita a cada execução);
2. ajuste de cada configuração da grade SÓ no treino;
3. escolha da configuração e do limiar SÓ na validação;
4. o artefato é salvo (procedimento congelado);
5. ``avaliar_lavagem`` usa o teste uma vez, com o artefato salvo, sem reajustes.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from src.ml import auditoria
from src.ml.avaliacao import calibracao_binaria, limiar_max_f1, metricas_binarias, recall_por_grupo
from src.ml.config import pasta_artefatos
from src.ml.ingestao import ErroDados, casar_padroes, ler_contas, ler_hismall, ler_padroes
from src.ml.modelos import CabecaClassificacao, ModeloUnificado, grade_financeira
from src.ml.preparacao import (
    MINUTOS_DIA,
    PreparadorFinanceiro,
    amostrar_treino_financeiro,
    atribuir_split_financeiro,
    atributos_financeiros,
    montar_pipeline_financeiro,
)


def _agora() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _salvar_json(obj: Any, destino: Path) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return destino


def _log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def _proba(pipe: Any, X: pd.DataFrame, classes: List[Any], lote: int = 250_000) -> np.ndarray:
    ordem = list(pipe.classes_)
    idx = [ordem.index(c) for c in classes]
    return np.vstack([pipe.predict_proba(X.iloc[i:i + lote])[:, idx] for i in range(0, len(X), lote)])


# ---------------------------------------------------------------------------
# Financeiro (HI-Small)
# ---------------------------------------------------------------------------
def _opcional(caminho: str) -> Optional[Path]:
    return Path(caminho) if caminho and Path(caminho).is_file() else None


def _carregar_financeiro(cfg: Dict[str, Any]):
    fin = cfg["financeiro"]
    if not fin["transacoes"]:
        raise ValueError("Configure [financeiro].transacoes no ml_config.local.toml.")
    _log("lavagem: lendo transações")
    dados = ler_hismall(fin["transacoes"])
    p_contas, p_padroes = _opcional(fin["contas"]), _opcional(fin["padroes"])
    contas = ler_contas(p_contas) if p_contas else None
    casados = casar_padroes(dados, ler_padroes(p_padroes)) if p_padroes else None
    pendentes = [n for n, p in (("contas", p_contas), ("padroes", p_padroes)) if p is None]
    return dados, contas, casados, pendentes


def treinar_lavagem(cfg: Dict[str, Any]) -> Dict[str, Any]:
    fin = cfg["financeiro"]
    semente, n_jobs = cfg["geral"]["semente"], cfg["geral"]["n_jobs"]
    pasta = pasta_artefatos(cfg)
    dados, contas, casados, pendentes = _carregar_financeiro(cfg)
    _log("lavagem: auditando")
    aud = auditoria.auditar_financeiro(dados, fin, contas, casados)
    aud["arquivos_pendentes"] = pendentes
    auditoria.salvar(aud, pasta / "auditoria", "auditoria_financeiro")

    t = dados.trans
    y = t["rotulo"].to_numpy()
    split = atribuir_split_financeiro(t["minuto"].to_numpy(), fin)
    idx = {sp: np.flatnonzero(split == sp) for sp in ("treino", "validacao", "teste", "cauda")}
    prep = PreparadorFinanceiro.ajustar(t.iloc[idx["treino"]])
    rel_amostra, pesos = amostrar_treino_financeiro(y[idx["treino"]], fin["fracao_negativos_treino"], semente)
    idx_tr = idx["treino"][rel_amostra]
    consulta = np.concatenate([idx_tr, idx["validacao"], idx["teste"], idx["cauda"]])
    _log(f"lavagem: calculando atributos point-in-time de {len(consulta):,} transações")
    t0 = time.perf_counter()
    X = atributos_financeiros(t, consulta, prep)
    prep.colunas = list(X.columns)
    _log(f"lavagem: {X.shape[1]} atributos em {time.perf_counter() - t0:.0f} s")
    cortes = np.cumsum([len(idx_tr), len(idx["validacao"]), len(idx["teste"])])
    Xtr, Xva = X.iloc[:cortes[0]], X.iloc[cortes[0]:cortes[1]]
    ytr, yva = y[idx_tr], y[idx["validacao"]]
    prep.registrar_quantis(Xtr)

    cache = pasta / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    for nome, ini, fim, ids in (("teste", cortes[1], cortes[2], idx["teste"]),
                                ("cauda", cortes[2], len(X), idx["cauda"])):
        bloco = X.iloc[ini:fim].reset_index(drop=True).copy()
        bloco["_id_transacao"] = t["id_transacao"].to_numpy()[ids]
        bloco["_minuto"] = t["minuto"].to_numpy()[ids]
        bloco["_formato"] = t["formato"].astype(str).to_numpy()[ids]
        bloco["_rotulo"] = y[ids]
        bloco.to_parquet(cache / f"financeiro_{nome}.parquet", index=False)
    _salvar_json({"sha256": dados.sha256, "colunas": prep.colunas}, cache / "financeiro_cache.json")
    del X

    resultados: List[Dict[str, Any]] = []
    base_va = np.full(len(yva), prep.taxa_base)
    resultados.append({"nome": "prevalencia", "familia": "baseline", "params": {},
                       "validacao": {"average_precision": float(average_precision_score(yva, base_va))}})
    formato_va = t["formato"].astype(str).to_numpy()[idx["validacao"]]
    score_fmt = pd.Series(formato_va).map(prep.taxa_formato).fillna(prep.taxa_base).to_numpy()
    lim_fmt = limiar_max_f1(yva, score_fmt)
    resultados.append({"nome": "taxa_do_formato", "familia": "baseline", "params": {},
                       "validacao": {"average_precision": float(average_precision_score(yva, score_fmt)),
                                     **{f"{k}_no_limiar": v for k, v in lim_fmt.items()}}})
    melhor = None
    for cand in grade_financeira(fin["grade"], semente, n_jobs):
        t0 = time.perf_counter()
        pipe = montar_pipeline_financeiro(cand.fabrica(), cand.linear)
        pipe.fit(Xtr, ytr, modelo__sample_weight=pesos)
        s_va = _proba(pipe, Xva, [0, 1], fin["tamanho_lote_previsao"])[:, 1]
        ap = float(average_precision_score(yva, s_va))
        lim = limiar_max_f1(yva, s_va)
        m = {"average_precision": ap, **{f"{k}_no_limiar": v for k, v in lim.items()},
             "segundos": round(time.perf_counter() - t0, 1)}
        resultados.append({"nome": cand.nome, "familia": cand.familia, "params": cand.params, "validacao": m})
        _log(f"lavagem: {cand.nome} AP val={ap:.4f} ({m['segundos']} s)")
        if melhor is None or ap > melhor[0]:
            melhor = (ap, cand, pipe, s_va, lim)
    ap, cand, pipe, s_va, lim = melhor

    versao = f"lavagem-{_agora()}"
    cab = CabecaClassificacao(
        "lavagem", pipe, [0, 1], prep.colunas, cand.familia, cand.params, lim["limiar"],
        metadados={
            "versao": versao,
            "fonte": "IBM AML HI-Small (sintético); alvo = Is Laundering",
            "arquivo": dados.arquivo, "sha256": dados.sha256,
            "treinado_ate": fin["treino_ate"],
            "limites": {k: fin[k] for k in ("inicio", "treino_ate", "validacao_ate", "teste_ate", "inicio_cauda")},
            "criterio_selecao": "maior average precision na validação (distribuição original)",
            "criterio_limiar": "maior F1 da classe lavagem na validação (sem custos fornecidos)",
            "limiar_validacao": lim, "ap_validacao": ap,
            "fracao_negativos_treino": fin["fracao_negativos_treino"],
            "n_treino_ajuste": int(len(idx_tr)), "positivos_treino": int(ytr.sum()),
            "n_treino_periodo": int(len(idx["treino"])),
            "semente": semente,
            "limiar_baseline_formato": lim_fmt["limiar"],
            "arquivos_pendentes": pendentes,
            "aviso": "Pontuação de lavagem; não é fraude confirmada nem probabilidade calibrada.",
        },
    )
    modelo = ModeloUnificado.carregar_ou_novo(pasta)
    modelo.registrar("lavagem", cab, "financeiro", prep)
    modelo.salvar(pasta)
    rel = {
        "tarefa": "lavagem", "versao": versao,
        "escolhido": {"nome": cand.nome, "familia": cand.familia, "params": cand.params},
        "limiar": lim, "grade_validacao": resultados,
        "atributos": prep.colunas, "cambio": prep.cambio, "info_cambio": prep.info_cambio,
        "arquivos_pendentes": pendentes,
        "splits": aud["splits"],
    }
    _salvar_json(rel, pasta / "resultados" / "treino_lavagem.json")
    _log(f"lavagem: escolhido {cand.nome}; limiar {lim['limiar']:.4f}")
    return rel


def avaliar_lavagem(cfg: Dict[str, Any]) -> Dict[str, Any]:
    pasta = pasta_artefatos(cfg)
    modelo = ModeloUnificado.carregar(pasta)
    cab = modelo.cabeca("lavagem")
    prep: PreparadorFinanceiro = modelo.codificadores["financeiro"]
    info = json.loads((pasta / "cache" / "financeiro_cache.json").read_text(encoding="utf-8"))
    if info["sha256"] != cab.metadados["sha256"]:
        raise ErroDados("Cache de atributos não corresponde ao arquivo usado no treino; treine novamente.")
    resultado: Dict[str, Any] = {"tarefa": "lavagem", "versao": cab.metadados["versao"],
                                 "escolhido": {"familia": cab.familia, "params": cab.params,
                                               "limiar_alerta": cab.limiar_alerta}}
    for nome in ("teste", "cauda"):
        bloco = pd.read_parquet(pasta / "cache" / f"financeiro_{nome}.parquet")
        if bloco.empty:
            continue
        y = bloco["_rotulo"].to_numpy()
        dia = pd.to_datetime(bloco["_minuto"].to_numpy() // MINUTOS_DIA, unit="D").strftime("%Y-%m-%d").to_numpy()
        score = cab.probabilidades(bloco[prep.colunas])[:, 1]
        r: Dict[str, Any] = {"modelo": metricas_binarias(y, score, cab.limiar_alerta, dia)}
        r["baseline_prevalencia"] = metricas_binarias(y, np.full(len(y), prep.taxa_base), prep.taxa_base)
        s_fmt = pd.Series(bloco["_formato"]).map(prep.taxa_formato).fillna(prep.taxa_base).to_numpy()
        r["baseline_formato"] = metricas_binarias(y, s_fmt, cab.metadados["limiar_baseline_formato"], dia)
        if nome == "teste":
            r["calibracao"] = calibracao_binaria(y, score)
            r["padroes"] = _avaliar_por_padrao(cfg, bloco, score >= cab.limiar_alerta)
        resultado[nome] = r
        _log(f"lavagem: {nome} AP={r['modelo']['average_precision']} F1={r['modelo']['f1']:.4f}")
    _salvar_json(resultado, pasta / "resultados" / "avaliacao_lavagem.json")
    return resultado


def _avaliar_por_padrao(cfg: Dict[str, Any], bloco: pd.DataFrame, alerta: np.ndarray) -> Dict[str, Any]:
    fin = cfg["financeiro"]
    p_padroes = _opcional(fin["padroes"])
    if p_padroes is None:
        return {"status": "pendente", "motivo": "HI-Small_Patterns.txt não disponível"}
    dados = ler_hismall(fin["transacoes"])
    casados = casar_padroes(dados, ler_padroes(p_padroes)).dropna(subset=["id_transacao"])
    casados["id_transacao"] = casados["id_transacao"].astype(np.int64)
    inicio = casados.groupby("tentativa")["minuto"].transform("min")
    from src.ml.preparacao import minuto_de
    casados["ja_iniciada_antes_do_teste"] = inicio < minuto_de(fin["validacao_ate"])
    pos = bloco[bloco["_rotulo"] == 1][["_id_transacao"]].assign(alerta=alerta[bloco["_rotulo"].to_numpy() == 1])
    m = pos.merge(casados.drop_duplicates("id_transacao")[["id_transacao", "tipo_padrao", "ja_iniciada_antes_do_teste"]],
                  left_on="_id_transacao", right_on="id_transacao", how="left")
    m["tipo_padrao"] = m["tipo_padrao"].fillna("sem_padrao")
    m["ja_iniciada_antes_do_teste"] = m["ja_iniciada_antes_do_teste"].map({True: "iniciada_antes", False: "nova"}).fillna("sem_padrao")
    return {
        "recall_por_tipo": recall_por_grupo(m["tipo_padrao"], m["alerta"]),
        "recall_por_inicio_da_tentativa": recall_por_grupo(m["ja_iniciada_antes_do_teste"], m["alerta"]),
    }


# ---------------------------------------------------------------------------
# Exemplos de inferência
# ---------------------------------------------------------------------------


def gerar_exemplo_lavagem(cfg: Dict[str, Any], dia: str = "2022-09-10") -> Path:
    """Transações de um dia do teste no formato HI-Small, sem ``Is Laundering``."""
    from src.ml.preparacao import minuto_de
    dados = ler_hismall(cfg["financeiro"]["transacoes"])
    t = dados.trans
    ini = minuto_de(dia)
    sel = t[(t["minuto"] >= ini) & (t["minuto"] < ini + MINUTOS_DIA)]
    origem = dados.nomes_contas[sel["conta_origem"].to_numpy()]
    destino_c = dados.nomes_contas[sel["conta_destino"].to_numpy()]
    saida = pd.DataFrame({
        "Timestamp": pd.to_datetime(sel["minuto"].to_numpy(), unit="m").strftime("%Y/%m/%d %H:%M"),
        "From Bank": sel["banco_origem"].to_numpy(),
        "Account": [c.split("-", 1)[1] for c in origem],
        "To Bank": sel["banco_destino"].to_numpy(),
        "Account.1": [c.split("-", 1)[1] for c in destino_c],
        "Amount Received": sel["valor_recebido"].to_numpy(),
        "Receiving Currency": sel["moeda_recebimento"].astype(str).to_numpy(),
        "Amount Paid": sel["valor_pago"].to_numpy(),
        "Payment Currency": sel["moeda_pagamento"].astype(str).to_numpy(),
        "Payment Format": sel["formato"].astype(str).to_numpy(),
    })
    destino = pasta_artefatos(cfg) / "exemplos" / f"hismall_{dia}_sem_rotulo.csv"
    destino.parent.mkdir(parents=True, exist_ok=True)
    saida.to_csv(destino, index=False, header=[c if c != "Account.1" else "Account" for c in saida.columns])
    return destino
