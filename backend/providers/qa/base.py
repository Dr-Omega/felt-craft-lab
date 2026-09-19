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
    ) -> dict[str, Any]:
        raise NotImplementedError
