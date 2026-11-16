"""Datasets sintéticos do ambiente de teste local (scripts/ambiente_teste.py).

Garante que o ambiente continua útil: os arquivos gerados passam na validação do painel, a análise conclui,
o rótulo bate com as tentativas (a análise não usa arquivo de padrões nem tem etapa de tipologias).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("ambiente_teste", RAIZ / "scripts" / "ambiente_teste.py")
amb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(amb)


def test_geracao_e_deterministica():
    a, b = amb.gerar(2_000, 7), amb.gerar(2_000, 7)
    pd.testing.assert_frame_equal(a, b)
    assert len(a) == 2_000 and set(a["rotulo"]) == {0, 1}
    assert set(a.loc[a["rotulo"] == 1, "tipologia"]) == {"FAN-OUT", "FAN-IN", "CYCLE"}


def test_dataset_sintetico_e_analisado_com_rotulo(ambiente, tmp_path):
    df = amb.gerar(3_000, amb.SEMENTE)
    csv = tmp_path / "sintetico.csv"
    amb.escrever_csv(df, csv, com_rotulo=True)
    m = ambiente.analisar(csv)
    assert m["status"] == "concluida", m
    assert m["contagens"]["validas"] == m["contagens"]["pontuadas"] == 3_000 and m["contagens"]["recusadas"] == 0
    assert m["rotulo"]["disponivel"] is True
    assert m["contagens"]["rotuladas_lavagem"] == int((df["rotulo"] == 1).sum())
    assert "tipologias" not in m and not hasattr(amb, "escrever_padroes")


def test_sem_rotulo_nao_tem_a_coluna(tmp_path):
    df = amb.gerar(500, 1)
    amb.escrever_csv(df, tmp_path / "s.csv", com_rotulo=False)
    cabecalho = (tmp_path / "s.csv").read_text(encoding="utf-8").splitlines()[0]
    assert cabecalho == amb.CABECALHO and "Is Laundering" not in cabecalho
