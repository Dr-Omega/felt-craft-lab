"""Offline keyword parse used when INTENT_PROVIDER=mock."""

from __future__ import annotations

import re
from typing import Any

from services.intent_sanitize import sanitize_generation_spec_patch
from services.intent_types import ok_intent_patch

from .base import IntentProvider

KNOWN_SUBJECTS = (
    "玉兔",
    "兔子",
    "熊猫",
    "小猫",
    "小鹿",
    "鲸鱼",
    "蝴蝶",
    "荷花",
    "月饼",
    "皮球",
    "灯笼",
)
KNOWN_COLORS = (
    "黑白",
    "白色",
    "金色",
    "红色",
    "粉色",
    "绿色",
    "蓝色",
    "黄色",
    "橙色",
    "紫色",
    "黑色",
)
ACTION_PATTERNS = (
    r"坐在地上抱着[^，。！？]{0,12}",
    r"抱着[^，。！？]{0,12}",
    r"追着?[^，。！？]{0,8}",
    r"坐着?",
    r"站着?",
    r"抱着?",
)


class MockIntentProvider(IntentProvider):
    name = "mock"

    def parse(
        self,
        *,
        text: str,
        locked_role: str | None,
        pending_field: str | None = None,
    ) -> dict[str, Any]:
        _ = pending_field
        source = (text or "").strip()
        subjects = []
        positions: list[tuple[str, int]] = []
        for name in KNOWN_SUBJECTS:
            index = source.find(name)
            if index >= 0:
                positions.append((name, index))
        positions.sort(key=lambda item: item[1])
        for i, (name, index) in enumerate(positions):
            prev_end = 0 if i == 0 else positions[i - 1][1] + len(positions[i - 1][0])
            nearby = source[prev_end : index + len(name)]
            attributes = [color for color in KNOWN_COLORS if color in nearby]
            subject: dict[str, Any] = {"name": name}
            if attributes:
                subject["attributes"] = attributes
            subjects.append(subject)
        colors = [
            color
            for color in KNOWN_COLORS
            if color in source and not any(color in (subject.get("attributes") or []) for subject in subjects)
        ]
        action = ""
        for pattern in ACTION_PATTERNS:
            match = re.search(pattern, source)
            if match and len(match.group(0)) >= len(action):
                action = match.group(0)
        forbidden_match = re.search(r"(?:不要|别|不能有|禁止)\s*([^，。！？]+)", source)
        forbidden = []
        if forbidden_match:
            forbidden = [part.strip() for part in re.split(r"[和与、,，]", forbidden_match.group(1)) if part.strip()]

        raw: dict[str, Any] = {"content": {}}
        if subjects:
            raw["content"]["primarySubjects"] = subjects
        if colors:
            raw["content"]["preferredColors"] = colors
        if action:
            raw["content"]["actionOrRelationship"] = action
        if forbidden:
            raw["content"]["forbiddenElements"] = forbidden
        if "背景" in source or locked_role == "background":
            cleaned = re.sub(r"(?:做|画|生成)?(?:一个|一张)?", "", source)
            cleaned = re.sub(r"背景|底图|场景画", "", cleaned).strip()
            if cleaned:
                raw["content"]["environmentDescription"] = cleaned[:80]
        if not raw["content"]:
            raw.pop("content")
        return ok_intent_patch(
            patch=sanitize_generation_spec_patch(raw, locked_role),
            request_id="mock-intent",
        )
