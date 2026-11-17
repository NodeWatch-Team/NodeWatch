"""Módulos neutros usados pelo painel: formatos de entrada, datas, métricas oficiais, JSON e sessão única."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

from src.ml import sessoes
from src.ml.esquemas import COLUNAS_HISMALL, FEATURES_REDE
from src.ml.formatos import CAMPOS_PT, detectar_formato, ler_tempo
from src.ml.resultados_oficiais import avaliacao_oficial, modelo_resumo
from src.ml.serializacao import para_json


# -- detecção de formato pelo cabeçalho -----------------------------------------------------
def test_formatos_de_transacoes_sao_analisaveis():
    ibm = detectar_formato(list(COLUNAS_HISMALL[:-1]))
    assert ibm["formato"] == "hismall_v1" and ibm["dominio"] == "lavagem" and ibm["analisavel"] and not ibm["rotulos"]
    assert detectar_formato(list(COLUNAS_HISMALL))["rotulos"] is True
    pt = detectar_formato([*CAMPOS_PT, "rotulo"])
    assert pt["formato"] == "transacao_hismall_v1" and pt["analisavel"] and pt["rotulos"]


def test_previsoes_grafo_e_rede_sao_reconhecidos_mas_nao_viram_analise_de_transacoes():
    prev = detectar_formato(["arquivo_origem", "linha_origem", "score_lavagem", "alerta_lavagem"])
    assert prev["formato"] == "previsao_lavagem_v1" and not prev["analisavel"] and prev["possiveis"] == []
    assert "PREVISÕES" in prev["leitura"] and "Explorar" not in prev["leitura"]   # a tela antiga não existe mais
    grafo = detectar_formato(["step", "type", "amount", "nameOrig", "nameDest", "isFraud"])
    assert grafo["formato"] == "csv_grafo_nodewatch" and not grafo["analisavel"]
    assert "moeda_pagamento" in grafo["faltando"]["transacao_hismall_v1"]
    rede = detectar_formato(["id_fluxo", "anchor_id", "probe_id", "timestamp", *FEATURES_REDE])
    assert rede["formato"] == "rede_v1" and rede["dominio"] == "rede"


def test_cabecalho_incompleto_informa_o_que_falta_sem_completar():
    d = detectar_formato([c for c in CAMPOS_PT if c != "moeda_pagamento"])
    assert d["formato"] is None and not d["analisavel"]
    assert d["mais_proximo"] == "transacao_hismall_v1" and d["faltando"]["transacao_hismall_v1"] == ["moeda_pagamento"]


# -- datas ----------------------------------------------------------------------------------------
def test_ler_tempo_aceita_os_formatos_documentados_e_recusa_o_resto():
    s = pd.Series(["2022/09/01 00:20", "2022-09-01T00:20:00Z", "1661991600", "ontem", ""])
    so_ibm, todos = ler_tempo(s, True), ler_tempo(s, False)
    assert so_ibm[0] == pd.Timestamp("2022-09-01 00:20", tz="UTC") and so_ibm[1:].isna().all()
    assert todos[0] == todos[1] == pd.Timestamp("2022-09-01 00:20", tz="UTC")
    assert todos[2] == pd.Timestamp(1661991600, unit="s", tz="UTC")
    assert pd.isna(todos[3]) and pd.isna(todos[4])


# -- métricas oficiais e metadados ------------------------------------------------------------------
def test_sem_resultados_gravados_tudo_fica_indisponivel_com_motivo(tmp_path: Path):
    a = avaliacao_oficial(tmp_path)
    assert a["rede"]["disponivel"] is False and "avaliar" in a["rede"]["motivo"]
    assert a["lavagem"]["disponivel"] is False
    assert a["modelo"]["disponivel"] is False and "metadados_modelo.json" in a["modelo"]["motivo"]
    assert "teste" in a["reuso_do_teste"]
    assert modelo_resumo(tmp_path)["disponivel"] is False


def test_resultados_versionados_do_repositorio_sao_lidos():
    raiz = Path(__file__).resolve().parents[2]
    lav = avaliacao_oficial(raiz)["lavagem"]
    assert lav["disponivel"] and lav["versao"].startswith("lavagem-")
    assert modelo_resumo(raiz)["cabecas"]["lavagem"]["familia"] == "random_forest"


# -- JSON das APIs -----------------------------------------------------------------------------------
def test_para_json_converte_tipos_do_numpy_e_do_pandas():
    saida = para_json({"i": np.int64(3), "f": np.float32(0.5), "nan": float("nan"), "inf": np.inf,
                       "b": np.bool_(True), "t": pd.Timestamp("2022-09-01 00:20"), 1: (np.int8(1), "x")})
    assert saida == {"i": 3, "f": 0.5, "nan": None, "inf": None, "b": True, "t": "2022-09-01T00:20:00",
                     "1": [1, "x"]}
    assert all(not isinstance(v, float) or math.isfinite(v) for v in saida.values())


# -- sessão única do processo -------------------------------------------------------------------------
def test_gerenciador_padrao_e_unico_no_processo():
    assert sessoes.padrao() is sessoes.padrao()
