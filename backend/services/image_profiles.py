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
    transform_prompt_addon: str
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

# This is deliberately distinct from the T2I addon above.  In I2I, Image 1
# carries user content while the remaining images are Gateway-owned style refs.
_I2I_CONTENT_AND_STYLE_CONSTRAINT_V1 = (
    "Image 1 is the user's content and structure reference. Preserve the subjects, subject count, "
    "major silhouette, pose, relative positions, semantic relationships, and critical structures "
    "from Image 1.\n\n"
    "Images 2 through 9 are style references only. Use them only for visual language, shape treatment, "
    "color-block treatment, simplification level, and overall expression. Do not copy their specific "
    "subjects, objects, text, or compositions.\n\n"
    "Transform the content of Image 1 into the visual language represented by Images 2 through 9. Keep "
    "the composition structurally simple and easy to cut, use large clear color regions and minimal "
    "perspective, reduce tiny internal details and meaningless fragments, and do not add unrelated objects."
)

# V2 changes production constraints only. The fixed style-reference set remains
# responsible for visual language; this addon is deliberately not a new style.
_CUTOUT_FRIENDLY_PRODUCTION_CONSTRAINTS_V2 = (
    "Use large, clean, stable color regions with minimal unnecessary tonal variation, minimal "
    "highlights, minimal perspective, and few meaningless fragments.\n\n"
    "For later automatic cutout, use one plain, uniform, solid-color background. Do not use a scene, "
    "decorative background, pattern, gradient, or background objects. Do not use white or near-white "
    "as the background. Keep the background clearly distinguishable from all major subject colors, "
    "especially white, cream, very light gray, and other very light subject regions.\n\n"
    "The outer silhouette must directly meet the background. Do not create a sticker border, white outline, "
    "pale outer outline, decorative outer stroke around the complete subject, cutout-frame effect, glow, "
    "halo, drop shadow, cast shadow, or soft shadow surrounding the silhouette. Do not blur or feather "
    "the outer boundary. Keep the silhouette clear and easy to segment."
)

_HIDDEN_FELT_CONSTRAINT_V2_CUTOUT = (
    "Use the provided reference images only for their overall visual language, shape treatment, and visual "
    "expression. Do not copy or introduce their specific subjects, objects, text, or compositions. Keep all "
    "requested subjects, subject count, important relationships, major structures, and recognizable silhouettes. "
    "Keep the composition structurally simple and easy to cut, and do not add objects unrelated to the request.\n\n"
    + _CUTOUT_FRIENDLY_PRODUCTION_CONSTRAINTS_V2
)

_I2I_CONTENT_AND_STYLE_CONSTRAINT_V2_CUTOUT = (
    "Image 1 is the user's content and structure reference. Preserve the subjects, subject count, major "
    "silhouette, pose, relative positions, semantic relationships, and critical structures from Image 1.\n\n"
    "Images 2 through 9 are style references only. Use them only for visual language, shape treatment, "
    "color-block treatment, simplification level, and overall expression. Do not copy their specific subjects, "
    "objects, text, or compositions.\n\n"
    "Transform the content of Image 1 into the visual language represented by Images 2 through 9. Do not change "
    "the content, requested subject count, pose, relative positions, silhouettes, or relationships from Image 1.\n\n"
    + _CUTOUT_FRIENDLY_PRODUCTION_CONSTRAINTS_V2
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
            transform_prompt_addon=_I2I_CONTENT_AND_STYLE_CONSTRAINT_V1,
            reference_set_id="felt-style-ref-v1",
        ),
        "felt-seedream45-ref8-v2-cutout": GenerationProfile(
            profile_id="felt-seedream45-ref8-v2-cutout",
            provider="seedream_ark",
            model=_seedream_model_id(),
            hidden_prompt_addon=_HIDDEN_FELT_CONSTRAINT_V2_CUTOUT,
            transform_prompt_addon=_I2I_CONTENT_AND_STYLE_CONSTRAINT_V2_CUTOUT,
            reference_set_id="felt-style-ref-v1",
        ),
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
