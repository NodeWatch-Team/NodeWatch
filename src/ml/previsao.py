"""Inferência com o artefato salvo (nada é reajustado aqui).

As saídas preservam a identidade (``arquivo_origem``, ``linha_origem``) e a
ordem dos registros de entrada, e trazem ``tipo_saida = "previsao"``: uma
previsão nunca é apresentada como evento ou fraude confirmada.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

import numpy as np
import pandas as pd

from src.ml.ingestao import DadosHISmall, ler_hismall
from src.ml.preparacao import atributos_financeiros

Caminho = Union[str, Path]
AVISO_LAVAGEM = (
    "Pontuação de lavagem aprendida no IBM AML HI-Small (sintético). Não é probabilidade "
    "nem confirmação de fraude."
)


def pontuar_lavagem(cab, prep, X: pd.DataFrame, formato: pd.Series) -> Tuple[np.ndarray, np.ndarray]:
    """Score da cabeça ``lavagem`` e motivos verificáveis (só para quem passa o limiar)."""
    s = cab.probabilidades(X)[:, list(cab.classes).index(1)]
    m = np.asarray(prep.motivos(X, formato.reset_index(drop=True)), dtype=object)
    m[s < cab.limiar_alerta] = ""
    return s, m


def _concatenar(historico: DadosHISmall, alvo: DadosHISmall) -> Tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    """Junta histórico + transações a pontuar com códigos de conta unificados."""
    nomes = np.concatenate([historico.nomes_contas, alvo.nomes_contas])
    codigos, unicos = pd.factorize(nomes)
    th = historico.trans.copy()
    ta = alvo.trans.copy()
    for col in ("conta_origem", "conta_destino"):
        th[col] = codigos[th[col].to_numpy()].astype(np.int32)
        ta[col] = codigos[len(historico.nomes_contas) + ta[col].to_numpy()].astype(np.int32)
    comb = pd.concat([th.drop(columns="rotulo", errors="ignore"),
                      ta.drop(columns="rotulo", errors="ignore")], ignore_index=True)
    for col in ("moeda_pagamento", "moeda_recebimento", "formato"):
        comb[col] = comb[col].astype(str)
    consulta = np.arange(len(th), len(comb))
    return comb, consulta, np.asarray(unicos, dtype=object)


def prever_lavagem(modelo, caminho: Caminho, historico: Optional[Caminho] = None,
                   lote: int = 500_000) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Pontua transações no formato HI-Small (rótulo opcional).

    Os atributos dependem do histórico das contas: forneça em ``historico``
    as transações anteriores (>= 72 h) ou aceite que as primeiras horas do
    arquivo tenham histórico incompleto (coluna ``historico_incompleto``).
    """
    cab = modelo.cabeca("lavagem")
    prep = modelo.codificadores["financeiro"]
    dados = ler_hismall(caminho, exigir_rotulo=False)
    if historico:
        # Só o que veio antes da primeira transação a pontuar: o histórico pode ser
        # o arquivo original completo sem duplicar nem antecipar transações.
        hist = ler_hismall(historico, exigir_rotulo=False)
        hist.trans = hist.trans.loc[hist.trans["minuto"] < dados.trans["minuto"].min()].reset_index(drop=True)
        trans, consulta, nomes = _concatenar(hist, dados)
    else:
        trans, consulta, nomes = dados.trans, np.arange(len(dados.trans)), dados.nomes_contas
    inicio_hist = int(trans["minuto"].min())
    scores, motivos = [], []
    for i in range(0, len(consulta), lote):
        q = consulta[i:i + lote]
        X = atributos_financeiros(trans, q, prep)
        s, m = pontuar_lavagem(cab, prep, X, trans["formato"].iloc[q])
        scores.append(s)
        motivos.append(m)
    score = np.concatenate(scores) if scores else np.empty(0)
    t = trans.iloc[consulta]
    saida = pd.DataFrame({
        "arquivo_origem": Path(dados.arquivo).name,
        "linha_origem": dados.trans["id_transacao"].to_numpy(),
        "id_transacao": dados.trans["id_transacao"].astype(str).to_numpy(),
        "timestamp_transacao": pd.to_datetime(t["minuto"].to_numpy(), unit="m"),
        "conta_origem": nomes[t["conta_origem"].to_numpy()],
        "conta_destino": nomes[t["conta_destino"].to_numpy()],
        "valor_pago": t["valor_pago"].to_numpy(),
        "moeda_pagamento": t["moeda_pagamento"].astype(str).to_numpy(),
        "formato": t["formato"].astype(str).to_numpy(),
        "score_lavagem": score,
        "alerta_lavagem": score >= cab.limiar_alerta,
        "limiar_alerta": cab.limiar_alerta,
        "motivos_verificaveis": np.concatenate(motivos) if motivos else np.empty(0, dtype=object),
        "historico_incompleto": (t["minuto"].to_numpy() - inicio_hist) < 72 * 60,
        "versao_modelo": cab.metadados.get("versao", ""),
        "tipo_saida": "previsao",
    })
    relatorio = {
        "tarefa": "lavagem",
        "arquivo": dados.arquivo,
        "sha256": dados.sha256,
        "historico": str(historico) if historico else None,
        "linhas_previstas": int(len(saida)),
        "fracao_historico_incompleto": float(saida["historico_incompleto"].mean()) if len(saida) else None,
        "aviso": AVISO_LAVAGEM,
    }
    return saida, relatorio
