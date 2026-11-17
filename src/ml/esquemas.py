"""Contratos versionados dos dados (esquemas) e sua validação.

Cada esquema descreve as colunas, tipos, domínios, sentinelas e o significado
de cada campo. O significado traz um ``status``:

* ``verificado`` — conferido nos dados por ``src.treino.auditoria`` (a auditoria
  refaz a conferência a cada execução);
* ``inferido``   — deduzido do nome e da distribuição; a construção original
  da coluna não está documentada.

Esquema:

* ``hismall_v1`` — transações brutas do IBM AML HI-Small.

A validação nunca preenche colunas ausentes: coluna obrigatória faltando,
tipo incompatível, NaN/inf ou valor fora do domínio geram :class:`ErroEsquema`
com a lista completa de problemas.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd


class ErroEsquema(ValueError):
    """Dados incompatíveis com o esquema. ``problemas`` lista cada falha."""

    def __init__(self, esquema: str, problemas: Sequence[str]):
        self.problemas = list(problemas)
        texto = "\n  - ".join(self.problemas)
        super().__init__(f"Dados incompatíveis com o esquema {esquema}:\n  - {texto}")


@dataclass(frozen=True)
class Coluna:
    nome: str
    tipo: str                      # "int", "float", "str", "cat", "datahora"
    papel: str                     # "id", "tempo", "controle", "alvo", "feature", "contexto"
    descricao: str
    unidade: str = ""
    status: str = "inferido"
    obrigatoria_treino: bool = True
    obrigatoria_inferencia: bool = True
    dominio: Optional[Tuple[Any, ...]] = None
    faixa: Optional[Tuple[float, float]] = None
    sentinela: Optional[float] = None
    significado_sentinela: str = ""


@dataclass(frozen=True)
class Esquema:
    nome: str
    versao: str
    descricao: str
    colunas: Tuple[Coluna, ...]
    proposta: bool = False
    observacoes: Tuple[str, ...] = field(default_factory=tuple)

    @property
    def id(self) -> str:
        return f"{self.nome}_{self.versao}"

    def coluna(self, nome: str) -> Coluna:
        for c in self.colunas:
            if c.nome == nome:
                return c
        raise KeyError(nome)

    def nomes(self, papel: Optional[str] = None) -> List[str]:
        return [c.nome for c in self.colunas if papel is None or c.papel == papel]

    def sentinelas(self) -> Dict[str, float]:
        return {c.nome: c.sentinela for c in self.colunas if c.sentinela is not None}

    def para_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["id"] = self.id
        return d

    # ------------------------------------------------------------------
    def validar(
        self,
        df: pd.DataFrame,
        modo: str = "treino",
        exigir: Sequence[str] = (),
        ignorar_ausentes: Sequence[str] = (),
    ) -> None:
        """Valida ``df``; levanta :class:`ErroEsquema` se houver problemas.

        Args:
            modo: ``"treino"`` ou ``"inferencia"`` (decide quais colunas são
                obrigatórias).
            exigir: colunas obrigatórias adicionais (ex.: ``classe_atual``
                quando o modelo escolhido depende dela).
            ignorar_ausentes: colunas que podem faltar mesmo sendo obrigatórias.
        """
        if modo not in ("treino", "inferencia"):
            raise ValueError(f"modo inválido: {modo}")
        problemas: List[str] = []
        presentes = set(df.columns)
        for c in self.colunas:
            obrig = c.obrigatoria_treino if modo == "treino" else c.obrigatoria_inferencia
            if c.nome in exigir:
                obrig = True
            if c.nome not in presentes:
                if obrig and c.nome not in ignorar_ausentes:
                    problemas.append(f"coluna obrigatória ausente: {c.nome}")
                continue
            problemas.extend(_validar_coluna(df[c.nome], c))
        if len(df) == 0:
            problemas.append("nenhuma linha")
        if problemas:
            raise ErroEsquema(self.id, problemas)


def _validar_coluna(s: pd.Series, c: Coluna) -> List[str]:
    p: List[str] = []
    if c.tipo in ("int", "float"):
        if not pd.api.types.is_numeric_dtype(s) or pd.api.types.is_bool_dtype(s):
            conv = pd.to_numeric(s, errors="coerce")
            ruins = int(conv.isna().sum() - s.isna().sum())
            if ruins:
                return [f"{c.nome}: {ruins} valor(es) não numérico(s)"]
            s = conv
        valores = s.to_numpy(dtype="float64", na_value=np.nan)
        n_nan = int(np.isnan(valores).sum())
        n_inf = int(np.isinf(valores).sum())
        if n_nan:
            p.append(f"{c.nome}: {n_nan} valor(es) ausente(s) (NaN)")
        if n_inf:
            p.append(f"{c.nome}: {n_inf} valor(es) infinito(s)")
        finitos = valores[np.isfinite(valores)]
        if c.tipo == "int" and finitos.size and not np.all(np.equal(np.mod(finitos, 1), 0)):
            p.append(f"{c.nome}: esperado inteiro, há valores fracionários")
        if c.faixa is not None and finitos.size:
            lo, hi = c.faixa
            fora = (finitos < lo) | (finitos > hi)
            if c.sentinela is not None:
                fora &= finitos != c.sentinela
            if fora.any():
                p.append(f"{c.nome}: {int(fora.sum())} valor(es) fora da faixa [{lo}, {hi}]")
        if c.dominio is not None and finitos.size:
            fora = ~np.isin(finitos, np.asarray(c.dominio, dtype="float64"))
            if fora.any():
                p.append(f"{c.nome}: {int(fora.sum())} valor(es) fora do domínio {c.dominio}")
    elif c.tipo in ("str", "cat"):
        n_nan = int(s.isna().sum())
        if n_nan:
            p.append(f"{c.nome}: {n_nan} valor(es) ausente(s)")
        if c.dominio is not None:
            fora = ~s.dropna().astype(str).isin([str(v) for v in c.dominio])
            if fora.any():
                exemplos = sorted(s.dropna().astype(str)[fora].unique())[:5]
                p.append(f"{c.nome}: {int(fora.sum())} valor(es) fora do domínio {c.dominio}: {exemplos}")
    elif c.tipo == "datahora":
        conv = pd.to_datetime(s, errors="coerce")
        ruins = int(conv.isna().sum())
        if ruins:
            p.append(f"{c.nome}: {ruins} data(s)/hora(s) inválida(s) ou ausente(s)")
    return p


# ---------------------------------------------------------------------------
# hismall_v1 (transações brutas do IBM AML HI-Small)
# ---------------------------------------------------------------------------
COLUNAS_HISMALL = (
    "Timestamp", "From Bank", "Account", "To Bank", "Account.1", "Amount Received",
    "Receiving Currency", "Amount Paid", "Payment Currency", "Payment Format", "Is Laundering",
)

ESQUEMA_HISMALL_V1 = Esquema(
    nome="hismall",
    versao="v1",
    descricao=(
        "Transações sintéticas do IBM AML (AMLworld), conjunto HI-Small. A coluna "
        "'Account' aparece duas vezes no cabeçalho original (origem e destino)."
    ),
    colunas=(
        Coluna("Timestamp", "datahora", "tempo", "Data e hora da transação (resolução de minuto, "
               "fuso não documentado).", status="verificado"),
        Coluna("From Bank", "int", "id", "Banco de origem.", status="verificado"),
        Coluna("Account", "str", "id", "Conta de origem (única dentro do banco).", status="verificado"),
        Coluna("To Bank", "int", "id", "Banco de destino.", status="verificado"),
        Coluna("Account.1", "str", "id", "Conta de destino.", status="verificado"),
        Coluna("Amount Received", "float", "feature", "Valor recebido, na moeda de recebimento.",
               "moeda", "verificado", faixa=(0, 1e15)),
        Coluna("Receiving Currency", "cat", "feature", "Moeda de recebimento.", status="verificado"),
        Coluna("Amount Paid", "float", "feature", "Valor pago, na moeda de pagamento.",
               "moeda", "verificado", faixa=(0, 1e15)),
        Coluna("Payment Currency", "cat", "feature", "Moeda de pagamento.", status="verificado"),
        Coluna("Payment Format", "cat", "feature", "Meio de pagamento (ACH, Wire, Cheque, ...).",
               status="verificado"),
        Coluna("Is Laundering", "int", "alvo", "1 = transação faz parte de lavagem segundo o "
               "simulador (verdade sintética, sem data de confirmação).", status="verificado",
               obrigatoria_inferencia=False, dominio=(0, 1)),
    ),
)

ESQUEMAS = {e.id: e for e in (ESQUEMA_HISMALL_V1,)}
