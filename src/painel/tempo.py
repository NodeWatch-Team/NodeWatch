"""Relógio do servidor e formatação de instantes (época em segundos, UTC).

Usado pelas sessões da interface (``src.painel.sessoes``).
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional


def iso(epoca: Optional[float]) -> Optional[str]:
    """Época (s, UTC) → ``AAAA-MM-DDTHH:MM:SSZ``; ``None`` ou NaN → ``None``."""
    if epoca is None or (isinstance(epoca, float) and math.isnan(epoca)):
        return None
    return datetime.fromtimestamp(float(epoca), tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def agora() -> float:
    """Instante atual como época em segundos (UTC)."""
    return datetime.now(timezone.utc).timestamp()
