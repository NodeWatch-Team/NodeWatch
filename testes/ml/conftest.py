"""Dados sintéticos pequenos para os testes do módulo de ML."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest



def gerar_transacoes(n: int = 3_000, n_contas: int = 120, semente: int = 0) -> pd.DataFrame:
    """Transações no formato interno de ``DadosHISmall.trans``."""
    rng = np.random.default_rng(semente)
    minuto = np.sort(rng.integers(0, 6 * 1440, size=n)) + 27_000_000
    o = rng.integers(0, n_contas, size=n)
    d = rng.integers(0, n_contas, size=n)
    moedas = np.array(["US Dollar", "Euro", "Yen"])
    mp = moedas[rng.integers(0, 3, size=n)]
    troca = rng.random(n) < 0.2
    mr = np.where(troca, moedas[rng.integers(0, 3, size=n)], mp)
    taxa = {"US Dollar": 1.0, "Euro": 1.1, "Yen": 0.007}
    valor_pago = np.round(rng.lognormal(6, 1.5, size=n), 2)
    usd = valor_pago * np.vectorize(taxa.get)(mp)
    valor_rec = usd / np.vectorize(taxa.get)(mr)
    formato = np.array(["ACH", "Wire", "Cheque"])[rng.integers(0, 3, size=n)]
    rotulo = ((formato == "ACH") & (rng.random(n) < 0.1)).astype(np.int8)
    return pd.DataFrame({
        "id_transacao": np.arange(n, dtype=np.int64),
        "minuto": minuto.astype(np.int64),
        "banco_origem": (o % 5).astype(np.int32), "conta_origem": o.astype(np.int32),
        "banco_destino": (d % 5).astype(np.int32), "conta_destino": d.astype(np.int32),
        "valor_recebido": valor_rec, "moeda_recebimento": pd.Categorical(mr),
        "valor_pago": valor_pago, "moeda_pagamento": pd.Categorical(mp),
        "formato": pd.Categorical(formato), "rotulo": rotulo,
    })


def nomes_contas(n: int = 120) -> np.ndarray:
    """Nomes ``banco-conta`` para os códigos de :func:`gerar_transacoes` (banco = código % 5)."""
    return np.array([f"{i % 5}-C{i:04d}" for i in range(n)], dtype=object)


def transacoes_normalizadas(trans: pd.DataFrame, nomes: np.ndarray, prefixo: str = "") -> list:
    """Linhas de ``DadosHISmall.trans`` no formato aceito por :meth:`EstadoFinanceiro.receber`."""
    saida = []
    for r in trans.itertuples(index=False):
        t = float(r.minuto * 60)
        saida.append({
            "id_transacao": f"{prefixo}{int(r.id_transacao)}", "epoca": t, "minuto": int(r.minuto),
            "timestamp_disponivel": t, "banco_origem": str(int(r.banco_origem)),
            "banco_destino": str(int(r.banco_destino)), "conta_origem": str(nomes[r.conta_origem]),
            "conta_destino": str(nomes[r.conta_destino]), "valor_pago": float(r.valor_pago),
            "valor_recebido": float(r.valor_recebido), "moeda_pagamento": str(r.moeda_pagamento),
            "moeda_recebimento": str(r.moeda_recebimento), "formato": str(r.formato),
        })
    return saida


def gravar_hismall(trans: pd.DataFrame, nomes: np.ndarray, caminho: Path) -> Path:
    """Escreve transações sintéticas no formato do CSV original do HI-Small (sem rótulo)."""
    contas_o = [str(nomes[c]).split("-", 1) for c in trans["conta_origem"]]
    contas_d = [str(nomes[c]).split("-", 1) for c in trans["conta_destino"]]
    df = pd.DataFrame({
        "Timestamp": pd.to_datetime(trans["minuto"], unit="m").dt.strftime("%Y/%m/%d %H:%M"),
        "From Bank": [b for b, _ in contas_o], "Account": [c for _, c in contas_o],
        "To Bank": [b for b, _ in contas_d], "Account.1": [c for _, c in contas_d],
        "Amount Received": trans["valor_recebido"].round(2), "Receiving Currency": trans["moeda_recebimento"],
        "Amount Paid": trans["valor_pago"].round(2), "Payment Currency": trans["moeda_pagamento"],
        "Payment Format": trans["formato"],
    })
    texto = df.to_csv(index=False).replace("Account.1", "Account", 1)
    caminho.write_text(texto, encoding="utf-8")
    return caminho


@pytest.fixture(scope="session")
def modelo_minimo():
    """ModeloUnificado pequeno (floresta de 15 árvores) treinado em dados sintéticos.

    Serve para testar o painel e o provisionamento: não é o modelo do projeto.
    """
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.pipeline import Pipeline

    from src.ml.modelos import CabecaClassificacao, ModeloUnificado
    from src.ml.preparacao import PreparadorFinanceiro, atributos_financeiros

    trans = gerar_transacoes()
    prep = PreparadorFinanceiro.ajustar(trans)
    Xf = atributos_financeiros(trans, np.arange(len(trans)), prep)
    prep.colunas = list(Xf.columns)
    prep.registrar_quantis(Xf)
    rf_f = RandomForestClassifier(n_estimators=15, random_state=0, n_jobs=2).fit(Xf, trans["rotulo"])
    cab_f = CabecaClassificacao("lavagem", Pipeline([("modelo", rf_f)]), [0, 1], list(Xf.columns),
                                "random_forest", {}, 0.2, metadados={"versao": "teste-lavagem"})
    modelo = ModeloUnificado()
    modelo.registrar("lavagem", cab_f, "financeiro", prep)
    return modelo
