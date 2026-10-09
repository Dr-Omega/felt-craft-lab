"""QaService。"""

from __future__ import annotations

import os
from typing import Optional

from providers.qa.deepseek_provider import DeepSeekQaProvider
from providers.qa.mock_provider import MockQaProvider
from services.guards import qa_provider_allowed
from services.qa_types import err_qa
from services.qa_history import valid_qa_history


class UnknownQaProvider(ValueError):
    pass


class QaService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        name = (provider_name or os.getenv("QA_PROVIDER") or "deepseek").strip()
        if not qa_provider_allowed(name):
            raise UnknownQaProvider(name)
        if name == "mock":
            self.provider = MockQaProvider()
        else:
            self.provider = DeepSeekQaProvider()

    def ask(self, *, question: str, asset: dict, history=None) -> dict:
        if not valid_qa_history(history):
            return err_qa(code="INVALID_ARGUMENT")
        asset = asset or {}
        if getattr(self.provider, "name", "") != "mock":
            if not (asset.get("assetId") or asset.get("nameZh")):
                return err_qa(code="QA_MISSING_ASSET")
        try:
            return self.provider.ask(question=question, asset=asset, **({'history': history} if history else {}))
        except Exception:  # noqa: BLE001
            return err_qa(code="QA_UPSTREAM_ERROR")
