"""Creation-intent parser Provider 抽象。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class IntentProvider(ABC):
    name: str = "base"

    @abstractmethod
    def parse(self, *, text: str, locked_role: str | None) -> dict[str, Any]:
        raise NotImplementedError
