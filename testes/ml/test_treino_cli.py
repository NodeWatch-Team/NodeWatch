"""Treino do modelo de lavagem de ponta a ponta pela CLI, com dados sintéticos no formato do HI-Small.

Cobre o caminho que o painel não exercita: auditar → treinar → avaliar → prever → relatorio → documentar,
numa pasta temporária (nada toca em artefatos_ml/ nem em modelos/).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.ml import cli
from src.ml.modelos import ModeloUnificado
from testes.ml.conftest import gerar_transacoes, nomes_contas

INICIO_SETEMBRO_2022 = 1661990400 // 60  # minutos desde a época


@pytest.fixture(scope="module")
def projeto(tmp_path_factory) -> Path:
    pasta = tmp_path_factory.mktemp("treino")
    t = gerar_transacoes(n=20_000, n_contas=300, semente=1)
    rng = np.random.default_rng(1)
    t["minuto"] = np.sort(rng.integers(0, 12 * 1440, size=len(t))) + INICIO_SETEMBRO_2022  # 01 a 12/09/2022
    nomes = nomes_contas(300)
    o = [str(nomes[c]).split("-", 1) for c in t["conta_origem"]]
    d = [str(nomes[c]).split("-", 1) for c in t["conta_destino"]]
    df = pd.DataFrame({
        "Timestamp": pd.to_datetime(t["minuto"], unit="m").dt.strftime("%Y/%m/%d %H:%M"),
        "From Bank": [b for b, _ in o], "Account": [c for _, c in o],
        "To Bank": [b for b, _ in d], "Account.1": [c for _, c in d],
        "Amount Received": t["valor_recebido"].round(2), "Receiving Currency": t["moeda_recebimento"],
        "Amount Paid": t["valor_pago"].round(2), "Payment Currency": t["moeda_pagamento"],
        "Payment Format": t["formato"], "Is Laundering": t["rotulo"],
    })
    with open(pasta / "HI-Small_Trans.csv", "w", encoding="utf-8", newline="") as fh:
        fh.write(df.to_csv(index=False, lineterminator="\n").replace("Account.1", "Account", 1))
    (pasta / "cfg.toml").write_text('[geral]\npasta_artefatos = "artefatos"\npasta_docs = "docs"\nn_jobs = 1\n'
                                    '[financeiro]\ntransacoes = "HI-Small_Trans.csv"\ngrade = "rapida"\n',
                                    encoding="utf-8")
    return pasta


def _cli(projeto: Path, *args: str) -> int:
    return cli.main(["--config", str(projeto / "cfg.toml"), *args])


def test_treino_avaliacao_e_previsao_pela_cli(projeto: Path):
    assert _cli(projeto, "auditar") == 0
    assert (projeto / "artefatos" / "auditoria" / "auditoria_financeiro.json").is_file()
    assert _cli(projeto, "treinar", "--tarefa", "lavagem") == 0
    modelo = ModeloUnificado.carregar(projeto / "artefatos")
    assert modelo.tarefas_disponiveis() == {"lavagem": "treinada"} and list(modelo.codificadores) == ["financeiro"]
    cab = modelo.cabeca("lavagem")
    assert 0 < cab.limiar_alerta < 1 and len(cab.colunas_entrada) == len(modelo.codificadores["financeiro"].colunas)
    assert _cli(projeto, "avaliar") == 0
    aval = json.loads((projeto / "artefatos" / "resultados" / "avaliacao_lavagem.json").read_text(encoding="utf-8"))
    assert aval["tarefa"] == "lavagem" and "teste" in aval
    saida = projeto / "prev.csv"
    assert _cli(projeto, "prever", "--entrada", str(projeto / "HI-Small_Trans.csv"), "--saida", str(saida)) == 0
    prev = pd.read_csv(saida)
    assert len(prev) == 20_000 and prev["score_lavagem"].between(0, 1).all()


def test_relatorio_e_documentacao_so_tem_lavagem(projeto: Path):
    if not (projeto / "artefatos" / "modelo_unificado.joblib").is_file():
        assert _cli(projeto, "treinar") == 0 and _cli(projeto, "avaliar") == 0
    assert _cli(projeto, "relatorio") == 0 and _cli(projeto, "documentar") == 0
    relatorio = (projeto / "docs" / "RELATORIO_ML.md").read_text(encoding="utf-8")
    assert "## 1. Tarefa `lavagem`" in relatorio and "estado_rede" not in relatorio and "Fusão" not in relatorio
    assert [p.name for p in (projeto / "docs" / "esquemas").iterdir()] == ["hismall_v1.json"]
