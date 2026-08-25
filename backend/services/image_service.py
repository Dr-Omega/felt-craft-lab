"""ImageService：Canonical Prompt → Provider → normalize → quality → imageBase64."""

from __future__ import annotations

import base64
from typing import Any, Optional

from providers.image.mock_provider import MockImageProvider
from providers.image.sd_local import SdLocalProvider
from providers.image.seedream_ark import SeedreamArkProvider
from providers.image.wan_dashscope import WanDashScopeProvider
from services.guards import image_provider_allowed
from services.image_profiles import UnknownGenerationProfile, resolve_generation_profile
from services.image_postprocess import normalize_rgba_png
from services.image_quality import evaluate_felt_quality
from services.image_types import err_image, ok_image_bytes
from services.style_reference_sets import StyleReferenceSetError, resolve_reference_images


class UnknownImageProvider(ValueError):
    pass


def compose_positive_prompt(canonical_prompt: str, hidden_prompt_addon: str) -> str:
    canonical = (canonical_prompt or "").strip()
    addon = (hidden_prompt_addon or "").strip()
    if not canonical:
        return ""
    return canonical if not addon else f"{canonical}\n\n{addon}"


def finalize_image_bytes(
    image_bytes: bytes,
    *,
    width: int,
    height: int,
    asset_role: str = "core_pattern",
    request_id: str = "",
    provider: str = "mock",
) -> dict[str, Any]:
    """Pillow normalize + felt quality gate. Shared by generate and finalize routes."""
    normalized = normalize_rgba_png(image_bytes, width=width, height=height)
    if not normalized.get("ok"):
        return normalized
    final_bytes = normalized["image_bytes"]
    quality = evaluate_felt_quality(final_bytes, asset_role=asset_role)
    envelope = ok_image_bytes(
        image_bytes=final_bytes,
        request_id=request_id,
        provider=provider,
    )
    if envelope.get("ok") and isinstance(envelope.get("result"), dict):
        envelope["result"]["width"] = normalized["width"]
        envelope["result"]["height"] = normalized["height"]
        envelope["result"]["quality"] = quality
        envelope["result"]["assetRole"] = asset_role
    return envelope


class ImageService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        self._provider_name_explicit = provider_name is not None
        self.provider = self._provider_for(provider_name.strip()) if provider_name else None

    def generate(
        self,
        *,
        positive_prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        asset_role: str = "core_pattern",
        request_id: str = "",
    ) -> dict:
        text = (positive_prompt or "").strip()
        if not text:
            return err_image(code="INVALID_ARGUMENT", message="缺少正向提示词。")
        if len(text) > 2000:
            return err_image(code="INVALID_ARGUMENT", message="正向提示词过长。")
        try:
            profile = None
            references = None
            generation_width = width
            generation_height = height
            provider = self.provider
            # `provider_name=None` is the normal Main → Gateway path. Core
            # Pattern policy is resolved here, after Canonical Prompt, rather
            # than leaked into GenerationSpec or Main.
            if not self._is_explicit_provider():
                profile = resolve_generation_profile(asset_role)
                provider = self._provider_for(profile.provider)
                text = compose_positive_prompt(text, profile.hidden_prompt_addon)
                references = resolve_reference_images(profile.reference_set_id)
                generation_width = profile.generation_width
                generation_height = profile.generation_height
            if provider is None:
                raise UnknownImageProvider("missing profile provider")
            raw = provider.generate(
                positive_prompt=text,
                negative_prompt=(negative_prompt or "")[:2000],
                width=generation_width,
                height=generation_height,
                reference_images=references,
                model=profile.model if profile else "",
            )
            if not raw.get("ok"):
                return raw
            encoded = ((raw.get("result") or {}).get("imageBase64") or "").strip()
            if not encoded:
                return err_image(code="UNKNOWN", message="生图结果为空。")
            image_bytes = base64.b64decode(encoded)
            provider_name = getattr(provider, "name", "mock")
            return finalize_image_bytes(
                image_bytes,
                width=width,
                height=height,
                asset_role=asset_role,
                request_id=request_id or ((raw.get("result") or {}).get("requestId") or ""),
                provider=str(provider_name),
            )
        except UnknownGenerationProfile:
            return err_image(code="IMAGE_PROFILE_UNAVAILABLE")
        except StyleReferenceSetError:
            return err_image(code="IMAGE_REFERENCE_INVALID")
        except Exception:  # noqa: BLE001
            return err_image(code="UNKNOWN", message="生图服务暂时不可用。")

    def transform(
        self,
        *,
        content_image: str,
        asset_role: str = "core_pattern",
        request_id: str = "",
    ) -> dict:
        """Gateway-owned I2I orchestration: one content image plus eight fixed style images."""
        if not isinstance(content_image, str) or not content_image.startswith(
            ("data:image/png;base64,", "data:image/jpeg;base64,")
        ):
            return err_image(code="INVALID_ARGUMENT", message="缺少有效图片输入。")
        try:
            profile = resolve_generation_profile(asset_role)
            style_references = resolve_reference_images(profile.reference_set_id)
            if len(style_references) != 8:
                raise StyleReferenceSetError("reference count mismatch")
            references = [content_image, *style_references]
            if len(references) != 9:
                raise StyleReferenceSetError("transform reference count mismatch")
            # Transform is a normal production profile path: explicit/development
            # provider construction must not replace the profile's provider policy.
            provider = self._provider_for(profile.provider)
            raw = provider.generate(
                positive_prompt=profile.transform_prompt_addon,
                negative_prompt="",
                width=profile.generation_width,
                height=profile.generation_height,
                reference_images=references,
                model=profile.model,
            )
            if not raw.get("ok"):
                return raw
            encoded = ((raw.get("result") or {}).get("imageBase64") or "").strip()
            if not encoded:
                return err_image(code="UNKNOWN", message="生图结果为空。")
            image_bytes = base64.b64decode(encoded)
            return finalize_image_bytes(
                image_bytes,
                width=512,
                height=512,
                asset_role=asset_role,
                request_id=request_id or ((raw.get("result") or {}).get("requestId") or ""),
                provider=str(getattr(provider, "name", "mock")),
            )
        except UnknownGenerationProfile:
            return err_image(code="IMAGE_PROFILE_UNAVAILABLE")
        except StyleReferenceSetError:
            return err_image(code="IMAGE_REFERENCE_INVALID")
        except Exception:  # noqa: BLE001
            return err_image(code="UNKNOWN", message="图片转换服务暂时不可用。")

    def _is_explicit_provider(self) -> bool:
        return bool(getattr(self, "_provider_name_explicit", False))

    def _provider_for(self, name: str):
        if not image_provider_allowed(name):
            raise UnknownImageProvider(name)
        if name == "mock":
            return MockImageProvider()
        if name == "wan_dashscope":
            return WanDashScopeProvider()
        if name == "sd_local":
            return SdLocalProvider()
        if name == "seedream_ark":
            return SeedreamArkProvider()
        raise UnknownImageProvider(name)
