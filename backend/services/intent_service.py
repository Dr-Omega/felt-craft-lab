"""Intent parse service. Reuses DeepSeek credentials; mock is development-only."""

from __future__ import annotations

import os
from typing import Optional

from providers.intent.deepseek_provider import DeepSeekIntentProvider
from providers.intent.mock_provider import MockIntentProvider
from services.guards import qa_provider_allowed
from services.intent_types import err_intent


class UnknownIntentProvider(ValueError):
    pass


class IntentService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        name = (
            provider_name
            or os.getenv("INTENT_PROVIDER")
            or os.getenv("QA_PROVIDER")
            or "deepseek"
        ).strip()
        if not qa_provider_allowed(name):
            raise UnknownIntentProvider(name)
        if name == "mock":
            self.provider = MockIntentProvider()
        else:
            self.provider = DeepSeekIntentProvider()

    def parse(self, *, text: str, locked_role: str | None) -> dict:
        try:
            return self.provider.parse(text=text, locked_role=locked_role)
        except Exception:  # noqa: BLE001
            return err_intent(code="QA_UPSTREAM_ERROR")
