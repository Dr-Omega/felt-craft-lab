"""Image generation orchestration, kept on the Gateway side of the boundary."""

from __future__ import annotations

import os
from typing import Optional

from providers.image.mock_provider import MockImageProvider
from providers.image.sd_local import SdLocalImageProvider
from providers.image.seedream_ark import SeedreamArkImageProvider
from providers.image.wan_dashscope import WanDashscopeImageProvider
from services.guards import image_provider_allowed
from services.image_profiles import UnknownGenerationProfile, resolve_generation_profile
from services.image_types import ImageProviderError, err_image, normalize_to_png, ok_image, quality_gate
from services.style_reference_sets import StyleReferenceSetError, resolve_reference_images


class UnknownImageProvider(ValueError):
    pass


def _provider(name: str):
    if name == "seedream_ark":
        return SeedreamArkImageProvider()
    if name == "mock":
        return MockImageProvider()
    if name == "wan_dashscope":
        return WanDashscopeImageProvider()
    if name == "sd_local":
        return SdLocalImageProvider()
    raise UnknownImageProvider(name)


def compose_positive_prompt(canonical_prompt: str, hidden_prompt_addon: str) -> str:
    canonical = (canonical_prompt or "").strip()
    addon = (hidden_prompt_addon or "").strip()
    if not canonical:
        raise ImageProviderError("IMAGE_MISSING_PROMPT")
    # This function is the single append point. It prevents profile additions
    # from being repeated when callers retry or re-use the canonical prompt.
    return canonical if not addon else f"{canonical}\n\n{addon}"


class ImageService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        # The caller does not choose provider: production source of truth is the
        # resolved profile.  Explicit construction is only for provider tests.
        self._provider_name_override = (provider_name or "").strip() or None

    def generate(
        self,
        *,
        canonical_prompt: str,
        asset_role: str,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> dict:
        try:
            profile = resolve_generation_profile(asset_role)
            provider_name = self._provider_name_override or profile.provider
            if not image_provider_allowed(provider_name):
                raise UnknownImageProvider(provider_name)
            positive_prompt = compose_positive_prompt(canonical_prompt, profile.hidden_prompt_addon)
            reference_images = resolve_reference_images(profile.reference_set_id)
            target_width = _dimension(width, profile.default_width)
            target_height = _dimension(height, profile.default_height)
            generated = _provider(provider_name).generate(
                positive_prompt=positive_prompt,
                model=profile.model,
                width=target_width,
                height=target_height,
                reference_images=reference_images,
            )
            normalized = normalize_to_png(generated)
            verdict = quality_gate(normalized)
            return ok_image(png_bytes=normalized, quality_verdict=verdict, request_id=generated.request_id)
        except UnknownGenerationProfile:
            return err_image("IMAGE_PROFILE_UNAVAILABLE")
        except StyleReferenceSetError:
            return err_image("IMAGE_REFERENCE_INVALID")
        except UnknownImageProvider:
            return err_image("INVALID_PROVIDER")
        except ImageProviderError as exc:
            return err_image(exc.code)


def _dimension(value: Optional[int], default: int) -> int:
    if value is None:
        return default
    # Keep request shape benign without introducing image strategy into the
    # GenerationSpec; sizes are purely output dimensions.
    if isinstance(value, bool) or not isinstance(value, int) or value < 128 or value > 4096:
        raise ImageProviderError("INVALID_ARGUMENT")
    return value


def selected_image_provider() -> str:
    """Health-only selection preview; does not validate or expose image data."""
    try:
        return resolve_generation_profile("core_pattern").provider
    except UnknownGenerationProfile:
        return "unavailable"


def image_provider_configured() -> bool:
    return bool((os.getenv("ARK_API_KEY") or "").strip())
