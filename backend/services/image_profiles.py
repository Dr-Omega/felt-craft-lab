"""Server-side image generation profiles.

Profiles deliberately live outside GenerationSpec.  They are production policy,
not user or renderer input, and unknown identifiers are rejected (never
silently downgraded to another provider).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class UnknownGenerationProfile(ValueError):
    """Raised when an image profile is absent or not permitted for a role."""


@dataclass(frozen=True)
class GenerationProfile:
    profile_id: str
    provider: str
    model: str
    hidden_prompt_addon: str
    reference_set_id: str
    default_width: int = 1024
    default_height: int = 1024


# This constraint is intentionally not returned from any Gateway response.
_FELT_HIDDEN_CONSTRAINT_V1 = (
    "Render the requested subject as a single handmade felt applique craft asset. "
    "Use soft cut felt shapes, visible textile fibers, clean rounded edges, simple "
    "child-friendly forms, and a plain transparent-looking light background. "
    "No lettering, logo, watermark, frame, collage, photorealism, or extra objects."
)


def _seedream_model() -> str:
    # Deployments may use an Ark endpoint/model ID while local tests use the
    # public model name.  This remains server-only policy.
    return (os.getenv("SEEDREAM_MODEL_ID") or "doubao-seedream-4.5").strip()


def _core_profile_id() -> str:
    return (os.getenv("IMAGE_PROFILE_CORE_PATTERN") or "felt-seedream45-ref8-v1").strip()


def _profiles() -> dict[str, GenerationProfile]:
    return {
        "felt-seedream45-ref8-v1": GenerationProfile(
            profile_id="felt-seedream45-ref8-v1",
            provider="seedream_ark",
            model=_seedream_model(),
            hidden_prompt_addon=_FELT_HIDDEN_CONSTRAINT_V1,
            reference_set_id="felt-style-ref-v1",
        )
    }


def resolve_generation_profile(asset_role: str) -> GenerationProfile:
    """Resolve the only P0 image profile, based on the server-known asset role."""
    if (asset_role or "").strip() != "core_pattern":
        raise UnknownGenerationProfile("no image profile is configured for this asset role")
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
