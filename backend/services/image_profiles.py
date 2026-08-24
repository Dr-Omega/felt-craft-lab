"""Gateway-owned generation profiles; never part of GenerationSpec or Renderer input."""

from __future__ import annotations

import os
from dataclasses import dataclass


class UnknownGenerationProfile(ValueError):
    pass


@dataclass(frozen=True)
class GenerationProfile:
    profile_id: str
    provider: str
    model: str
    hidden_prompt_addon: str
    reference_set_id: str
    generation_width: int = 1024
    generation_height: int = 1024


_HIDDEN_FELT_CONSTRAINT_V1 = (
    "Use the provided reference images only for their overall visual language, shape treatment, "
    "and visual expression. Do not copy or introduce their specific subjects, objects, text, or "
    "compositions. Keep the composition structurally simple and easy to cut. Reduce tiny internal "
    "details and meaningless fragments. Keep the background simple, make the requested subjects "
    "and their requested relationships clear, and do not add objects unrelated to the request."
)


def _seedream_model_id() -> str:
    return (os.getenv("SEEDREAM_MODEL_ID") or "doubao-seedream-4-5-251128").strip()


def _core_profile_id() -> str:
    return (os.getenv("IMAGE_PROFILE_CORE_PATTERN") or "felt-seedream45-ref8-v1").strip()


def _profiles() -> dict[str, GenerationProfile]:
    return {
        "felt-seedream45-ref8-v1": GenerationProfile(
            profile_id="felt-seedream45-ref8-v1",
            provider="seedream_ark",
            model=_seedream_model_id(),
            hidden_prompt_addon=_HIDDEN_FELT_CONSTRAINT_V1,
            reference_set_id="felt-style-ref-v1",
        )
    }


def resolve_generation_profile(asset_role: str) -> GenerationProfile:
    if (asset_role or "").strip() != "core_pattern":
        raise UnknownGenerationProfile("no profile configured for asset role")
    profile_id = _core_profile_id()
    profile = _profiles().get(profile_id)
    if profile is None:
        raise UnknownGenerationProfile(profile_id)
    return profile


def get_generation_profile(profile_id: str) -> GenerationProfile:
    profile = _profiles().get((profile_id or "").strip())
    if profile is None:
        raise UnknownGenerationProfile(profile_id)
    return profile
