"""Inferência da floresta com várias threads: resultado idêntico, bit a bit, ao de 1 thread e entre execuções.

Antes, o ``predict_proba`` do sklearn somava as árvores na ordem em que as threads terminavam, e o score do
HI-Small variava no último bit entre análises do mesmo arquivo (uma transação trocou de alerta). Esta é a
base do critério de aceite das otimizações de desempenho: igualdade bit a bit de score_bruto, score e alerta.
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from src.ml.modelos import CabecaClassificacao, LIMITE_LINHAS_UMA_THREAD, _proba_floresta_em_ordem


def _dados(n: int = 4_000, semente: int = 0):
    rng = np.random.default_rng(semente)
    X = pd.DataFrame(rng.normal(size=(n, 8)).astype(np.float32), columns=[f"a{i}" for i in range(8)])
    y = ((X["a0"] + 0.5 * X["a1"] * X["a2"] + rng.normal(scale=0.8, size=n)) > 0.9).astype(int)
    return X, y


def _uma_thread(modelo):
    copia = copy.deepcopy(modelo)
    est = copia.steps[-1][1] if hasattr(copia, "steps") else copia
    est.n_jobs = 1
    return copia


def test_soma_em_ordem_igual_a_uma_thread_bit_a_bit():
    X, y = _dados()
    rf = RandomForestClassifier(n_estimators=60, min_samples_leaf=3, n_jobs=4, random_state=1).fit(X, y)
    esperado = _uma_thread(rf).predict_proba(X)
    obtido = _proba_floresta_em_ordem(rf, X)
    assert obtido is not None and obtido.dtype == np.float64
    assert np.array_equal(obtido, esperado)                  # bit a bit, não aproximado
    for _ in range(3):                                       # e igual de uma execução para outra
        assert np.array_equal(_proba_floresta_em_ordem(rf, X), obtido)


def test_pipeline_com_transformador_e_cabeca_usam_a_soma_em_ordem():
    X, y = _dados(n=3_000, semente=2)
    pipe = Pipeline([("escala", StandardScaler()),
                     ("modelo", RandomForestClassifier(n_estimators=40, n_jobs=3, random_state=4))]).fit(X, y)
    esperado = _uma_thread(pipe).predict_proba(X)
    assert np.array_equal(_proba_floresta_em_ordem(pipe, X), esperado)
    cab = CabecaClassificacao(tarefa="teste", pipeline=pipe, classes=[1, 0], colunas_entrada=list(X.columns),
                              familia="random_forest", params={}, limiar_alerta=0.5)
    assert len(X) >= LIMITE_LINHAS_UMA_THREAD
    p = cab.probabilidades(X, lote=1_000)                    # em lotes, com as classes na ordem da cabeça
    assert np.array_equal(p, esperado[:, [1, 0]])


def test_fora_da_floresta_ou_com_uma_thread_usa_o_predict_proba_normal():
    X, y = _dados(n=500)
    rf1 = RandomForestClassifier(n_estimators=5, n_jobs=1, random_state=0).fit(X, y)
    assert _proba_floresta_em_ordem(rf1, X) is None
    from sklearn.linear_model import LogisticRegression
    assert _proba_floresta_em_ordem(LogisticRegression().fit(X, y), X) is None
