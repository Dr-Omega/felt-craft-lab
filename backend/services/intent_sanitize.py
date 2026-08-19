"""Strip Prompt/Provider pollution and bound fields on a GenerationSpec patch."""

from __future__ import annotations

from typing import Any

POLLUTION_KEYS = frozenset(
    {
        "prompt",
        "negativePrompt",
        "canonicalPrompt",
        "provider",
        "providerPrompt",
        "model",
        "apiKey",
        "adapter",
        "temperature",
        "seed",
        "lora",
        "stylePrompt",
        "imageUrl",
        "roleConstraints",
        "styleConstraints",
    }
)
ROLES = frozenset({"core_pattern", "element", "background"})
MAX_NAME_CHARS = 16
MAX_ACTION_CHARS = 40
MAX_COLOR_CHARS = 12
MAX_ENV_CHARS = 80
MAX_LIST_ITEMS = 8
MAX_ATTRIBUTES = 4


def _clean_text(value: Any, max_chars: int) -> str:
    text = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").replace("\t", " ").split())
    return text[:max_chars]


def _clean_list(value: Any, max_chars: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _clean_text(item, max_chars)
        if not text or text in seen:
            continue
        seen.add(text)
        items.append(text)
        if len(items) >= MAX_LIST_ITEMS:
            break
    return items


def _clean_subjects(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    subjects: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if isinstance(item, dict):
            name = _clean_text(item.get("name"), MAX_NAME_CHARS)
            attributes = _clean_list(item.get("attributes"), MAX_COLOR_CHARS)[:MAX_ATTRIBUTES]
        else:
            name = _clean_text(item, MAX_NAME_CHARS)
            attributes = []
        if not name or name in seen:
            continue
        seen.add(name)
        subject: dict[str, Any] = {"name": name}
        if attributes:
            subject["attributes"] = attributes
        subjects.append(subject)
        if len(subjects) >= MAX_LIST_ITEMS:
            break
    return subjects


def sanitize_generation_spec_patch(raw: Any, locked_role: str | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"assetRole": locked_role} if locked_role in ROLES else {}

    safe = {key: value for key, value in raw.items() if key not in POLLUTION_KEYS}
    patch: dict[str, Any] = {}
    if locked_role in ROLES:
        patch["assetRole"] = locked_role
    elif safe.get("assetRole") in ROLES:
        patch["assetRole"] = safe["assetRole"]

    content_raw = safe.get("content") if isinstance(safe.get("content"), dict) else safe
    content: dict[str, Any] = {}
    subjects = _clean_subjects(content_raw.get("primarySubjects"))
    if subjects:
        content["primarySubjects"] = subjects
    colors = _clean_list(content_raw.get("preferredColors"), MAX_COLOR_CHARS)
    if colors:
        content["preferredColors"] = colors
    action = _clean_text(content_raw.get("actionOrRelationship"), MAX_ACTION_CHARS)
    if action:
        content["actionOrRelationship"] = action
    forbidden = _clean_list(content_raw.get("forbiddenElements"), MAX_NAME_CHARS)
    if forbidden:
        content["forbiddenElements"] = forbidden
    required = _clean_list(content_raw.get("requiredElements"), MAX_NAME_CHARS)
    if required:
        content["requiredElements"] = required
    environment = _clean_text(content_raw.get("environmentDescription"), MAX_ENV_CHARS)
    if environment:
        content["environmentDescription"] = environment
    if content:
        patch["content"] = content
    return patch
