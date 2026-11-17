"""Conversão de resultados (numpy, pandas, NaN) em valores aceitos pelo JSON das APIs."""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np
import pandas as pd


def iso_timestamp(ts: Any) -> Optional[str]:
    """``pd.Timestamp`` (ou equivalente) → ``AAAA-MM-DDTHH:MM:SS``; ausente → ``None``."""
    if ts is None or pd.isna(ts):
        return None
    return pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%S")


def para_json(obj: Any) -> Any:
    """Converte tipos do numpy/pandas e NaN em valores serializáveis."""
    if isinstance(obj, dict):
        return {str(k): para_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [para_json(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return None if not math.isfinite(float(obj)) else float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        return iso_timestamp(obj)
    return obj
