"""QaService：儿童适龄问答入口。"""

from __future__ import annotations

import os
from typing import Any, Optional

from providers.qa.deepseek_provider import DeepSeekQaProvider
from providers.qa.mock_provider import MockQaProvider
from services.qa_types import err_qa


class QaService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        name = (provider_name or os.getenv("QA_PROVIDER") or "deepseek").strip()
        if name == "mock":
            self.provider = MockQaProvider()
        else:
            self.provider = DeepSeekQaProvider()

    def ask(
        self,
        *,
        question: str,
        asset: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        asset = asset or {}
        if not asset.get("nameZh") and not asset.get("assetId"):
            return err_qa(
                code="QA_MISSING_ASSET",
                message="缺少当前素材信息（至少提供 nameZh 或 assetId）",
                retryable=False,
            )
        try:
            return self.provider.ask(question=question, asset=asset)
        except Exception as exc:  # noqa: BLE001
            return err_qa(
                code="QA_UPSTREAM_ERROR",
                message=str(exc),
                retryable=True,
                details={"exception": type(exc).__name__},
            )
