"""Mock 问答。"""

from __future__ import annotations

from typing import Any

from services.qa_types import ok_qa

from .base import QaProvider


class MockQaProvider(QaProvider):
    name = "mock"

    def ask(self, *, question: str, asset: dict[str, Any], history=None) -> dict[str, Any]:
        name = (asset or {}).get("nameZh") or "当前素材"
        return ok_qa(
            answer=f"我是{name}。你可以再问问我的颜色、形状，或怎么把我做成不织布手工。",
            safety_action="allow",
            request_id="mock-qa",
        )
