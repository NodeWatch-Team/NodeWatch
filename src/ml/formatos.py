"""Formatos de arquivo reconhecidos pelo NodeWatch e detecção pelo cabeçalho.

Contratos de entrada (independentes de nome, caminho, datas, contas ou tamanho):

* ``hismall_v1``: transações no formato original do IBM AML (cabeçalho
  ``Timestamp,From Bank,Account,To Bank,Account,...``, ``Account`` repetido:
  o 1º é a origem e o 2º o destino); ``Is Laundering`` opcional;
* ``transacao_hismall_v1``: os mesmos campos com nomes em português
  (``id_transacao,timestamp,banco_origem,...``); ``rotulo`` opcional;
* ``rede_v1``: medições de rede com os atributos já preparados (módulo
  ``estado_rede``; o painel do analista não analisa este formato).

Reconhecidos, mas não analisáveis: CSV de previsões já calculadas e o CSV do
grafo antigo (``step,type,amount,nameOrig,nameDest``). Nada é completado nem
inventado: :func:`detectar_formato` só informa o que falta.

Usado pelo painel (``src/painel/datasets.py``) e pela área "Analisar dataset"
da interface antiga (``src/ml/analises.py``).
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from src.ml.esquemas import COLUNAS_HISMALL, FEATURES_REDE

CAMPOS_PT = ("id_transacao", "timestamp", "banco_origem", "conta_origem", "banco_destino", "conta_destino",
             "valor_pago", "moeda_pagamento", "valor_recebido", "moeda_recebimento", "formato")
CAMPOS_GRAFO = ("step", "type", "amount", "nameOrig", "nameDest")
OBRIGATORIAS_REDE = ("id_fluxo", "anchor_id", "probe_id", "timestamp", *FEATURES_REDE)

FORMATOS: Dict[str, Dict[str, Any]] = {
    "hismall_v1": {
        "dominio": "lavagem", "nome": "Transações no formato original do IBM AML (HI-Small)",
        "cabecalho": ",".join(COLUNAS_HISMALL[:-1]),
        "rotulo": "Is Laundering (opcional; 0 ou 1)",
        "regras": ["Timestamp em AAAA/MM/DD HH:MM (UTC presumido; resolução de minuto)",
                   "From Bank/To Bank numéricos; a conta é identificada por banco-conta",
                   "a 1ª coluna Account é a origem e a 2ª, o destino",
                   "valores numéricos >= 0; moedas e formato não vazios",
                   "moedas e formatos fora dos do treino são aceitos, mas sinalizados"],
    },
    "transacao_hismall_v1": {
        "dominio": "lavagem", "nome": "Transações com nomes de colunas em português",
        "cabecalho": ",".join(CAMPOS_PT),
        "rotulo": "rotulo (opcional; 0 ou 1)",
        "regras": ["timestamp em ISO 8601, AAAA/MM/DD HH:MM ou época (s); sem fuso = UTC",
                   "id_transacao único e estável (repetido = recusado)",
                   "demais regras iguais às do formato hismall_v1"],
    },
    "rede_v1": {
        "dominio": "rede", "nome": "Medições de rede com atributos já preparados",
        "cabecalho": ",".join(OBRIGATORIAS_REDE),
        "rotulo": "alvo (opcional; OK, RISCO ou FALHA da próxima medição)",
        "regras": ["os 21 atributos rede_v1 precisam vir prontos (telemetria bruta não é aceita: "
                   "a referência p95/p99 por fluxo não está documentada)",
                   "faixas, domínios e sentinelas -1 conforme docs/ml/DICIONARIO_DADOS.md",
                   "chave id_fluxo + timestamp repetida = recusada"],
    },
}

# Colunas que identificam um CSV de PREVISÕES já calculadas (saída de `python -m src.ml.cli prever`).
COLUNAS_CHAVE_PREVISAO = {
    "rede": ("classe_prevista", "score_alerta_rede"),
    "lavagem": ("score_lavagem", "alerta_lavagem"),
}

_FMT_HISMALL = "%Y/%m/%d %H:%M"


def detectar_dominio(colunas: Iterable[str]) -> Optional[str]:
    cols = set(colunas)
    achados = [d for d, chave in COLUNAS_CHAVE_PREVISAO.items() if set(chave) <= cols]
    return achados[0] if len(achados) == 1 else None


def detectar_formato(colunas: List[str]) -> Dict[str, Any]:
    """Formato e análises possíveis; o que falta para as demais. Nunca completa colunas."""
    cols = set(colunas)
    previsao = detectar_dominio(colunas)
    if previsao:
        return {"formato": f"previsao_{previsao}_v1", "dominio": None, "analisavel": False,
                "possiveis": [f"Explorar previsões ({'rede' if previsao == 'rede' else 'financeira'})"],
                "faltando": {}, "leitura": "É um arquivo de PREVISÕES já calculadas, não de dados novos. "
                                          "Abra-o em Explorar previsões (Importar CSV)."}
    if colunas[:len(COLUNAS_HISMALL) - 1] == list(COLUNAS_HISMALL[:-1]) and \
            len(colunas) in (len(COLUNAS_HISMALL) - 1, len(COLUNAS_HISMALL)) and \
            (len(colunas) == len(COLUNAS_HISMALL) - 1 or colunas[-1] == COLUNAS_HISMALL[-1]):
        return {"formato": "hismall_v1", "dominio": "lavagem", "analisavel": True,
                "possiveis": ["Lavagem (score, alertas, motivos verificáveis)"],
                "rotulos": "Is Laundering" in cols, "faltando": {}}
    if set(CAMPOS_PT) <= cols:
        return {"formato": "transacao_hismall_v1", "dominio": "lavagem", "analisavel": True,
                "possiveis": ["Lavagem (score, alertas, motivos verificáveis)"],
                "rotulos": "rotulo" in cols, "faltando": {}}
    if set(OBRIGATORIAS_REDE) <= cols:
        return {"formato": "rede_v1", "dominio": "rede", "analisavel": True,
                "possiveis": ["Estado da próxima medição de rede (classe, score, alerta, deriva)"],
                "rotulos": "alvo" in cols, "faltando": {}}
    faltando = {
        "hismall_v1": [c for c in COLUNAS_HISMALL[:-1] if c not in cols],
        "transacao_hismall_v1": [c for c in CAMPOS_PT if c not in cols],
        "rede_v1": [c for c in OBRIGATORIAS_REDE if c not in cols],
    }
    if set(CAMPOS_GRAFO) <= cols:
        return {"formato": "csv_grafo_nodewatch", "dominio": None, "analisavel": False,
                "possiveis": ["Análise de grafos (ciclos, SCC, fan-in/out) pela CLI do NodeWatch"],
                "faltando": {"transacao_hismall_v1": faltando["transacao_hismall_v1"]},
                "leitura": ("Serve para a análise de grafos, mas não para o modelo financeiro: não tem bancos, "
                            "moedas, valor recebido nem data absoluta (step é relativo). Esses campos não são "
                            "inventados.")}
    melhor = min(faltando, key=lambda k: len(faltando[k]) / len(FORMATOS[k]["cabecalho"].split(",")))
    return {"formato": None, "dominio": None, "analisavel": False, "possiveis": [], "faltando": faltando,
            "mais_proximo": melhor,
            "leitura": f"Nenhum contrato atendido. O mais próximo é {melhor}; faltam: "
                       f"{', '.join(faltando[melhor][:12])}{' …' if len(faltando[melhor]) > 12 else ''}."}


def ler_tempo(serie: pd.Series, so_hismall: bool) -> pd.Series:
    """Texto → instante UTC (``NaT`` quando não reconhecido).

    Sempre aceita ``AAAA/MM/DD HH:MM`` (HI-Small); fora do formato ``hismall_v1``
    também ISO 8601 e época em segundos (0 a 4e9). Sem fuso = UTC.
    """
    t = pd.to_datetime(serie, format=_FMT_HISMALL, errors="coerce", utc=True)
    if so_hismall:
        return t
    faltam = t.isna() & (serie != "")
    if faltam.any():
        iso = pd.to_datetime(serie[faltam], format="ISO8601", errors="coerce", utc=True)
        num = pd.to_numeric(serie[faltam], errors="coerce")
        epoca = pd.to_datetime(num.where((num >= 0) & (num <= 4e9)), unit="s", utc=True)
        t.loc[faltam] = iso.fillna(epoca)
    return t
