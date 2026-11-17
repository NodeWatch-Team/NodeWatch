"""Ingestão e validação do IBM AML HI-Small (transações, contas e padrões).

Nenhuma função daqui altera os arquivos de entrada. Cada registro lido recebe
``arquivo_origem`` e ``linha_origem`` (posição 0-based dentro do arquivo), o
que permite devolver as previsões na identidade e ordem originais.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Union

import numpy as np
import pandas as pd

from src.ml.esquemas import (
    COLUNAS_HISMALL,
    ESQUEMA_HISMALL_V1,
    ErroEsquema,
)

Caminho = Union[str, Path]
COLUNAS_RASTREIO = ("arquivo_origem", "linha_origem")


class ErroDados(ValueError):
    """Dados válidos no esquema, mas inconsistentes (duplicatas, splits...)."""


def sha256_arquivo(caminho: Caminho, bloco: int = 1 << 22) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as fh:
        for parte in iter(lambda: fh.read(bloco), b""):
            h.update(parte)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# HI-Small
# ---------------------------------------------------------------------------
@dataclass
class DadosHISmall:
    """Transações do HI-Small em tipos compactos.

    ``trans`` tem uma linha por transação, na ordem do arquivo:
    ``id_transacao`` (= linha 0-based), ``minuto`` (minutos desde a época),
    ``conta_origem``/``conta_destino`` (códigos int32 de ``banco-conta``),
    bancos, valores, moedas e formato (categóricos) e ``rotulo`` (se houver).
    ``nomes_contas[codigo]`` devolve o texto ``banco-conta``.
    """

    trans: pd.DataFrame
    nomes_contas: np.ndarray
    arquivo: str
    sha256: str
    relatorio: Dict[str, Any] = field(default_factory=dict)


@contextlib.contextmanager
def _abrir_binario(caminho: Path) -> Iterator[io.BufferedIOBase]:
    if caminho.suffix.lower() == ".zip":
        with zipfile.ZipFile(caminho) as z:
            membros = [m for m in z.infolist() if not m.is_dir()]
            csvs = [m for m in membros if m.filename.lower().endswith(".csv")]
            if len(csvs) != 1:
                raise ErroDados(f"{caminho.name}: esperado 1 CSV dentro do zip, há {len(csvs)}")
            with z.open(csvs[0]) as fh:
                yield fh
    else:
        with open(caminho, "rb") as fh:
            yield fh


def _normalizar_cabecalho(linha: str) -> List[str]:
    nomes = [n.strip() for n in linha.strip().split(",")]
    vistos: Dict[str, int] = {}
    saida = []
    for n in nomes:
        k = vistos.get(n, 0)
        saida.append(n if k == 0 else f"{n}.{k}")
        vistos[n] = k + 1
    return saida


def ler_hismall(caminho: Caminho, exigir_rotulo: bool = True) -> DadosHISmall:
    """Lê ``HI-Small_Trans.csv`` (ou o ``.zip`` que o contém) com pyarrow."""
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.csv as pcsv

    p = Path(caminho)
    if not p.is_file():
        raise FileNotFoundError(f"Arquivo de transações não encontrado: {p}")
    with _abrir_binario(p) as fh:
        cabecalho = _normalizar_cabecalho(fh.readline().decode("utf-8-sig"))
    esperado = list(COLUNAS_HISMALL)
    sem_rotulo = esperado[:-1]
    if cabecalho == esperado:
        nomes = esperado
    elif cabecalho == sem_rotulo and not exigir_rotulo:
        nomes = sem_rotulo
    else:
        raise ErroEsquema(ESQUEMA_HISMALL_V1.id, [f"cabeçalho inesperado: {cabecalho}"])

    tipos = {
        "Timestamp": pa.timestamp("s"),
        "From Bank": pa.int64(), "To Bank": pa.int64(),
        "Account": pa.string(), "Account.1": pa.string(),
        "Amount Received": pa.float64(), "Amount Paid": pa.float64(),
        "Receiving Currency": pa.string(), "Payment Currency": pa.string(),
        "Payment Format": pa.string(), "Is Laundering": pa.int8(),
    }
    with _abrir_binario(p) as fh:
        tab = pcsv.read_csv(
            fh,
            read_options=pcsv.ReadOptions(column_names=nomes, skip_rows=1, block_size=1 << 26),
            convert_options=pcsv.ConvertOptions(
                column_types={k: v for k, v in tipos.items() if k in nomes},
                timestamp_parsers=["%Y/%m/%d %H:%M"],
                strings_can_be_null=False,
            ),
        )
    problemas = [f"{n}: {tab[n].null_count} valor(es) ausente(s)" for n in nomes if tab[n].null_count]
    if problemas:
        raise ErroEsquema(ESQUEMA_HISMALL_V1.id, problemas)

    n = tab.num_rows
    contas = pa.concat_arrays([
        pc.binary_join_element_wise(pc.cast(tab["From Bank"], pa.string()), tab["Account"], "-").combine_chunks(),
        pc.binary_join_element_wise(pc.cast(tab["To Bank"], pa.string()), tab["Account.1"], "-").combine_chunks(),
    ]).dictionary_encode()
    codigos = contas.indices.to_numpy(zero_copy_only=False).astype(np.int32)
    nomes_contas = np.asarray(contas.dictionary.to_pylist(), dtype=object)
    del contas

    def categoria(col: str) -> pd.Categorical:
        d = tab[col].combine_chunks().dictionary_encode()
        return pd.Categorical.from_codes(
            d.indices.to_numpy(zero_copy_only=False).astype(np.int32),
            categories=pd.Index(d.dictionary.to_pylist(), dtype=str),
        )

    segundos = tab["Timestamp"].cast(pa.int64()).to_numpy()
    trans = pd.DataFrame({
        "id_transacao": np.arange(n, dtype=np.int64),
        "minuto": (segundos // 60).astype(np.int64),
        "banco_origem": tab["From Bank"].to_numpy().astype(np.int32),
        "conta_origem": codigos[:n],
        "banco_destino": tab["To Bank"].to_numpy().astype(np.int32),
        "conta_destino": codigos[n:],
        "valor_recebido": tab["Amount Received"].to_numpy(),
        "moeda_recebimento": categoria("Receiving Currency"),
        "valor_pago": tab["Amount Paid"].to_numpy(),
        "moeda_pagamento": categoria("Payment Currency"),
        "formato": categoria("Payment Format"),
    })
    if "Is Laundering" in nomes:
        trans["rotulo"] = tab["Is Laundering"].to_numpy().astype(np.int8)
    del tab
    problemas = []
    for col in ("valor_pago", "valor_recebido"):
        v = trans[col].to_numpy()
        if not np.isfinite(v).all():
            problemas.append(f"{col}: valores não finitos")
        if (v < 0).any():
            problemas.append(f"{col}: {int((v < 0).sum())} valor(es) negativo(s)")
    if "rotulo" in trans and not trans["rotulo"].isin([0, 1]).all():
        problemas.append("Is Laundering: valores fora de {0, 1}")
    if problemas:
        raise ErroEsquema(ESQUEMA_HISMALL_V1.id, problemas)
    relatorio = {
        "arquivo": str(p),
        "linhas": int(n),
        "contas_distintas": int(len(nomes_contas)),
        "duplicatas_exatas": int(trans.drop(columns="id_transacao").duplicated().sum()),
    }
    return DadosHISmall(trans, nomes_contas, str(p), sha256_arquivo(p), relatorio)


# ---------------------------------------------------------------------------
# Contas e padrões (auditoria e avaliação; padrões nunca viram atributo)
# ---------------------------------------------------------------------------
COLUNAS_CONTAS = ("Bank Name", "Bank ID", "Account Number", "Entity ID", "Entity Name")
_RE_TIPO_ENTIDADE = re.compile(r"^(.*?)\s*#\s*\d+\s*$")


def ler_contas(caminho: Caminho) -> pd.DataFrame:
    """Lê ``HI-Small_accounts.csv``; a chave ``conta`` segue ``banco-conta``."""
    p = Path(caminho)
    if not p.is_file():
        raise FileNotFoundError(f"Arquivo de contas não encontrado: {p}")
    df = pd.read_csv(p, dtype=str)
    df.columns = [c.strip() for c in df.columns]
    faltam = [c for c in COLUNAS_CONTAS if c not in df.columns]
    if faltam:
        raise ErroEsquema("contas", [f"colunas ausentes: {faltam}; cabeçalho: {list(df.columns)}"])
    banco = pd.to_numeric(df["Bank ID"], errors="coerce")
    if banco.isna().any():
        raise ErroEsquema("contas", [f"Bank ID não numérico em {int(banco.isna().sum())} linha(s)"])
    df["conta"] = banco.astype(np.int64).astype(str) + "-" + df["Account Number"].str.strip()
    df["tipo_entidade"] = df["Entity Name"].str.extract(_RE_TIPO_ENTIDADE, expand=False).fillna("desconhecido")
    return df


RE_INICIO_PADRAO = re.compile(r"BEGIN LAUNDERING ATTEMPT\s*-\s*([^:]+?)\s*(?::(.*))?$", re.IGNORECASE)
RE_FIM_PADRAO = re.compile(r"END LAUNDERING ATTEMPT", re.IGNORECASE)


def ler_padroes(caminho: Caminho) -> pd.DataFrame:
    """Lê ``HI-Small_Patterns.txt``, o arquivo de padrões que acompanha o IBM AML.

    Returns:
        Uma linha por transação listada em uma tentativa, com ``tentativa``
        (sequencial), ``tipo_padrao``, ``detalhe`` e as chaves de casamento
        com as transações (minuto, bancos, contas, valor pago, moeda, formato).
    """
    p = Path(caminho)
    if not p.is_file():
        raise FileNotFoundError(f"Arquivo de padrões não encontrado: {p}")
    linhas: List[List[Any]] = []
    tentativa, tipo, detalhe = -1, None, ""
    with p.open("r", encoding="utf-8", errors="replace") as fh:
        for bruta in fh:
            texto = bruta.strip()
            if not texto:
                continue
            m = RE_INICIO_PADRAO.match(texto)
            if m:
                tentativa += 1
                tipo, detalhe = m.group(1).strip().upper(), (m.group(2) or "").strip()
                continue
            if RE_FIM_PADRAO.match(texto):
                tipo = None
                continue
            if tipo is None:
                continue
            campos = [c.strip() for c in texto.split(",")]
            if len(campos) < 10:
                continue
            linhas.append([tentativa, tipo, detalhe] + campos[:11])
    colunas = ["tentativa", "tipo_padrao", "detalhe", "Timestamp", "From Bank", "Account",
               "To Bank", "Account.1", "Amount Received", "Receiving Currency", "Amount Paid",
               "Payment Currency", "Payment Format", "Is Laundering"]
    df = pd.DataFrame(linhas, columns=colunas[: 3 + max((len(r) - 3 for r in linhas), default=11)])
    if df.empty:
        return df
    ts = pd.to_datetime(df["Timestamp"], format="%Y/%m/%d %H:%M")
    df["minuto"] = ((ts - pd.Timestamp("1970-01-01")) // pd.Timedelta(minutes=1)).astype(np.int64)
    df["conta_origem_txt"] = pd.to_numeric(df["From Bank"]).astype(np.int64).astype(str) + "-" + df["Account"]
    df["conta_destino_txt"] = pd.to_numeric(df["To Bank"]).astype(np.int64).astype(str) + "-" + df["Account.1"]
    df["valor_pago"] = pd.to_numeric(df["Amount Paid"])
    return df


def casar_padroes(dados: DadosHISmall, padroes: pd.DataFrame) -> pd.DataFrame:
    """Associa cada transação de padrão a ``id_transacao`` (pode não casar)."""
    if padroes.empty:
        return padroes.assign(id_transacao=pd.Series(dtype="Int64"))
    indice = pd.Index(dados.nomes_contas)
    t = dados.trans
    chave_t = pd.DataFrame({
        "minuto": t["minuto"].to_numpy(),
        "conta_origem": t["conta_origem"].to_numpy(),
        "conta_destino": t["conta_destino"].to_numpy(),
        "valor_cent": np.round(t["valor_pago"].to_numpy() * 100).astype(np.int64),
        "formato": t["formato"].astype(str).to_numpy(),
        "id_transacao": t["id_transacao"].to_numpy(),
    })
    pp = padroes.copy()
    pp["conta_origem"] = indice.get_indexer(pp["conta_origem_txt"])
    pp["conta_destino"] = indice.get_indexer(pp["conta_destino_txt"])
    pp["valor_cent"] = np.round(pp["valor_pago"].to_numpy() * 100).astype(np.int64)
    pp["formato"] = pp["Payment Format"].astype(str)
    chaves = ["minuto", "conta_origem", "conta_destino", "valor_cent", "formato"]
    candidatos = chave_t.merge(pp[chaves].drop_duplicates(), on=chaves, how="inner")
    casado = pp.merge(candidatos, on=chaves, how="left")
    # Uma linha de padrão que case com mais de uma transação idêntica fica com a primeira.
    casado = casado.sort_values("id_transacao").drop_duplicates(
        ["tentativa"] + chaves, keep="first"
    )
    return casado
