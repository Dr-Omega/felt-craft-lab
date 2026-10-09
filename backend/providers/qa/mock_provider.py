"""Mock 问答。"""

from __future__ import annotations

from typing import Any

from services.qa_types import ok_qa

from .base import QaProvider


class MockQaProvider(QaProvider):
    name = "mock"

    def ask(self, *, question: str, asset: dict[str, Any], history=None) -> dict[str, Any]:
        name = (asset or {}).get("nameZh") or "这个贴纸"
        return ok_qa(
            answer=f"关于「{name}」：它很适合不织布手工哦！你可以再问问它的颜色或形状。",
            safety_action="allow",
            request_id="mock-qa",
        )
