"""Local Stable Diffusion via Automatic1111 WebUI API + optional LoRA.

Canonical Prompt is already compiled upstream; this provider must not invent
new style prose. It only appends a LoRA tag and fixed A1111 parameters.
"""

from __future__ import annotations

import base64
import os
import re
import secrets
from typing import Any, Callable, Optional, Sequence

import requests

from services.image_types import err_image, ok_image_bytes

from .base import ImageProvider

DEFAULT_BASE_URL = "http://127.0.0.1:7860"
DEFAULT_LORA_WEIGHT = 0.8
DEFAULT_STEPS = 25
DEFAULT_CFG = 7.0
DEFAULT_SAMPLER = "Euler a"
DEFAULT_TIMEOUT_SEC = 120.0
PROMPT_CHAR_LIMIT = 1800


def _base_url() -> str:
    return (os.getenv("SD_LOCAL_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")


def _lora_name() -> str:
    return (os.getenv("SD_LOCAL_LORA_NAME") or "").strip()


def _lora_weight() -> float:
    raw = (os.getenv("SD_LOCAL_LORA_WEIGHT") or str(DEFAULT_LORA_WEIGHT)).strip()
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_LORA_WEIGHT
    return max(0.0, min(value, 1.5))


def _steps() -> int:
    raw = (os.getenv("SD_LOCAL_STEPS") or str(DEFAULT_STEPS)).strip()
    try:
        return max(5, min(int(raw), 60))
    except ValueError:
        return DEFAULT_STEPS


def _cfg() -> float:
    raw = (os.getenv("SD_LOCAL_CFG") or str(DEFAULT_CFG)).strip()
    try:
        return max(1.0, min(float(raw), 15.0))
    except ValueError:
        return DEFAULT_CFG


def _sampler() -> str:
    return (os.getenv("SD_LOCAL_SAMPLER") or DEFAULT_SAMPLER).strip() or DEFAULT_SAMPLER


def _seed() -> int:
    """Return configured seed, or a fresh random one when unset / -1.

    Fixed seeds make「再画一张」identical; random keeps redraw useful.
    """
    raw = (os.getenv("SD_LOCAL_SEED") or "-1").strip()
    try:
        value = int(raw)
    except ValueError:
        value = -1
    if value < 0:
        return secrets.randbelow(2_147_483_647)
    return value


def _checkpoint() -> str:
    return (os.getenv("SD_LOCAL_CHECKPOINT") or "").strip()


def _timeout_sec() -> float:
    raw = (os.getenv("SD_LOCAL_TIMEOUT_SEC") or str(DEFAULT_TIMEOUT_SEC)).strip()
    try:
        return max(10.0, min(float(raw), 300.0))
    except ValueError:
        return DEFAULT_TIMEOUT_SEC


_LORA_TAG = re.compile(r"<lora:[^>]+>", re.IGNORECASE)


def inject_lora_tag(prompt: str, *, name: str, weight: float) -> str:
    """Append ``<lora:name:weight>`` once; leave prompt unchanged if name empty."""
    text = (prompt or "").strip()
    lora = (name or "").strip()
    if not lora:
        return text
    if _LORA_TAG.search(text):
        return text
    tag = f"<lora:{lora}:{weight:.2f}>"
    if not text:
        return tag
    return f"{text}, {tag}"


class SdLocalProvider(ImageProvider):
    """Automatic1111 ``/sdapi/v1/txt2img`` (local GPU)."""

    name = "sd_local"

    def __init__(self, *, post: Optional[Callable[..., Any]] = None) -> None:
        self._post = post or requests.post

    def generate(
        self,
        *,
        positive_prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        reference_images: Sequence[str] | None = None,
        model: str = "",
    ) -> dict[str, Any]:
        _ = (reference_images, model)
        base = _base_url()
        if not base:
            return err_image(code="IMAGE_NETWORK_ERROR", message="未配置本地 SD 地址。")

        prompt = inject_lora_tag(
            positive_prompt,
            name=_lora_name(),
            weight=_lora_weight(),
        )[:PROMPT_CHAR_LIMIT]
        negative = (negative_prompt or "")[:PROMPT_CHAR_LIMIT]
        w = max(64, min(int(width), 1024))
        h = max(64, min(int(height), 1024))
        # A1111 prefers multiples of 8.
        w = w - (w % 8)
        h = h - (h % 8)

        payload: dict[str, Any] = {
            "prompt": prompt,
            "negative_prompt": negative,
            "width": w,
            "height": h,
            "steps": _steps(),
            "cfg_scale": _cfg(),
            "sampler_name": _sampler(),
            "seed": _seed(),
            "batch_size": 1,
            "n_iter": 1,
            "restore_faces": False,
            "enable_hr": False,
        }
        checkpoint = _checkpoint()
        if checkpoint:
            payload["override_settings"] = {"sd_model_checkpoint": checkpoint}
            payload["override_settings_restore_afterwards"] = True

        url = f"{base}/sdapi/v1/txt2img"
        try:
            resp = self._post(url, json=payload, timeout=_timeout_sec())
        except requests.Timeout:
            return err_image(code="IMAGE_TIMEOUT", message="本地画图超时，请再试一次。")
        except requests.RequestException:
            return err_image(
                code="IMAGE_NETWORK_ERROR",
                message="连不上本地 SD，请确认 WebUI 已用 --api 启动。",
            )

        if resp.status_code >= 400:
            return err_image(
                code="IMAGE_UPSTREAM_ERROR",
                message="本地 SD 暂时画不出来，请检查模型与 LoRA 是否已加载。",
            )

        try:
            body = resp.json()
        except ValueError:
            return err_image(code="IMAGE_UPSTREAM_ERROR")

        images = body.get("images") if isinstance(body, dict) else None
        if not isinstance(images, list) or not images:
            return err_image(code="IMAGE_UPSTREAM_ERROR")

        encoded = str(images[0] or "").strip()
        # Some builds prefix with data URL.
        if "," in encoded and encoded.lower().startswith("data:"):
            encoded = encoded.split(",", 1)[1]
        if not encoded:
            return err_image(code="IMAGE_UPSTREAM_ERROR")

        try:
            image_bytes = base64.b64decode(encoded)
        except Exception:  # noqa: BLE001
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        if not image_bytes:
            return err_image(code="IMAGE_UPSTREAM_ERROR")

        info = body.get("info") if isinstance(body, dict) else None
        request_id = ""
        if isinstance(info, str) and info.strip():
            request_id = info.strip()[:64]

        return ok_image_bytes(
            image_bytes=image_bytes,
            request_id=request_id,
            provider=self.name,
        )
