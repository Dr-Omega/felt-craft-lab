"""问答 Provider 抽象。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class QaProvider(ABC):
    name: str = "base"

    @abstractmethod
    def ask(
        self,
        *,
        question: str,
        asset: dict[str, Any],
        history: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError
