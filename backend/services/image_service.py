"""ImageService：Canonical Prompt → Provider → normalize → quality → imageBase64."""

from __future__ import annotations

import base64
import os
from typing import Any, Optional

from providers.image.mock_provider import MockImageProvider
from providers.image.sd_local import SdLocalProvider
from providers.image.wan_dashscope import WanDashScopeProvider
from services.guards import image_provider_allowed
from services.image_postprocess import normalize_rgba_png
from services.image_quality import evaluate_felt_quality
from services.image_types import err_image, ok_image_bytes


class UnknownImageProvider(ValueError):
    pass


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
        name = (provider_name or os.getenv("IMAGE_PROVIDER") or "mock").strip()
        if not image_provider_allowed(name):
            raise UnknownImageProvider(name)
        if name == "mock":
            self.provider = MockImageProvider()
        elif name == "wan_dashscope":
            self.provider = WanDashScopeProvider()
        elif name == "sd_local":
            self.provider = SdLocalProvider()
        else:
            raise UnknownImageProvider(name)

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
            raw = self.provider.generate(
                positive_prompt=text,
                negative_prompt=(negative_prompt or "")[:2000],
                width=width,
                height=height,
            )
            if not raw.get("ok"):
                return raw
            encoded = ((raw.get("result") or {}).get("imageBase64") or "").strip()
            if not encoded:
                return err_image(code="UNKNOWN", message="生图结果为空。")
            image_bytes = base64.b64decode(encoded)
            provider_name = getattr(self.provider, "name", "mock")
            return finalize_image_bytes(
                image_bytes,
                width=width,
                height=height,
                asset_role=asset_role,
                request_id=request_id or ((raw.get("result") or {}).get("requestId") or ""),
                provider=str(provider_name),
            )
        except Exception:  # noqa: BLE001
            return err_image(code="UNKNOWN", message="生图服务暂时不可用。")
