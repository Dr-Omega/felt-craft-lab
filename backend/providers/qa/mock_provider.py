"""Mock 问答，供 SXY 并行开发。"""

from __future__ import annotations

from typing import Any

from services.qa_types import ok_qa

from .base import QaProvider


class MockQaProvider(QaProvider):
    name = "mock"

    def ask(self, *, question: str, asset: dict[str, Any]) -> dict[str, Any]:
        name = asset.get("nameZh") or "这个贴纸"
        return ok_qa(
            answer=f"（Mock）关于「{name}」：它很适合不织布手工哦！你可以再问问它的颜色或形状。",
            safety_action="allow",
            request_id="mock-qa",
            latency_ms=20,
        )
