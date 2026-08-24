"""DashScope 通义万相文生图。Compiler 已写好 Canonical Prompt，这里禁止再改写。"""

from __future__ import annotations

import os
import time
from typing import Any, Callable, Optional, Sequence

import requests

from services.image_types import err_image, ok_image_bytes

from .base import ImageProvider

SYNTHESIS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
DEFAULT_MODEL = "wanx2.1-t2i-turbo"
CLOUD_SIZE = "1024*1024"
PROMPT_CHAR_LIMIT = 800
POLL_INTERVAL_SEC = 1.0
POLL_TIMEOUT_SEC = 80.0
# Hard cap for downloaded image bytes (matches preview PNG ceiling).
MAX_WAN_IMAGE_BYTES = int(os.getenv("WAN_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))


def _api_key() -> str:
    return (
        os.getenv("DASHSCOPE_API_KEY", "").strip()
        or os.getenv("QWEN_ASR_API_KEY", "").strip()
    )


def _model() -> str:
    return (os.getenv("WAN_IMAGE_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL


class WanDashScopeProvider(ImageProvider):
    name = "wan_dashscope"

    def __init__(
        self,
        *,
        post: Optional[Callable[..., Any]] = None,
        get: Optional[Callable[..., Any]] = None,
        sleep: Optional[Callable[[float], None]] = None,
    ) -> None:
        self._post = post or requests.post
        self._get = get or requests.get
        self._sleep = sleep or time.sleep

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
        _ = (width, height, reference_images, model)
        key = _api_key()
        if not key:
            return err_image(code="IMAGE_MISSING_API_KEY")

        started = time.perf_counter()
        created = self._create_task(key, positive_prompt, negative_prompt)
        if not created.get("ok"):
            return created
        task_id = str((created.get("result") or {}).get("requestId") or "")
        polled = self._poll_task(key, task_id)
        if not polled.get("ok"):
            return polled
        image_url = str((polled.get("result") or {}).get("url") or "")
        downloaded = self._download_image(image_url)
        if not downloaded.get("ok"):
            return downloaded
        image_bytes = (downloaded.get("result") or {}).get("image_bytes") or b""
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        _ = elapsed_ms
        return ok_image_bytes(
            image_bytes=image_bytes,
            request_id=task_id,
            provider=self.name,
        )

    def _headers(self, key: str, *, async_enable: bool = False) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if async_enable:
            headers["X-DashScope-Async"] = "enable"
        return headers

    def _create_task(self, key: str, prompt: str, negative: str) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": _model(),
            "input": {
                "prompt": prompt[:PROMPT_CHAR_LIMIT],
                "negative_prompt": (negative or "")[:PROMPT_CHAR_LIMIT],
            },
            "parameters": {
                "size": CLOUD_SIZE,
                "n": 1,
                "prompt_extend": False,
                "watermark": False,
            },
        }
        try:
            resp = self._post(
                SYNTHESIS_URL,
                headers=self._headers(key, async_enable=True),
                json=payload,
                timeout=30,
            )
        except requests.Timeout:
            return err_image(code="IMAGE_TIMEOUT")
        except requests.RequestException:
            return err_image(code="IMAGE_NETWORK_ERROR")

        body = _json_body(resp)
        if resp.status_code == 401 or resp.status_code == 403:
            return err_image(code="IMAGE_MISSING_API_KEY")
        if resp.status_code >= 400:
            return _upstream_error(body)
        task_id = _nested_text(body, "output", "task_id") or _nested_text(body, "task_id")
        if not task_id:
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        return {"ok": True, "result": {"requestId": task_id}}

    def _poll_task(self, key: str, task_id: str) -> dict[str, Any]:
        deadline = time.perf_counter() + POLL_TIMEOUT_SEC
        url = TASK_URL.format(task_id=task_id)
        while time.perf_counter() < deadline:
            try:
                resp = self._get(url, headers=self._headers(key), timeout=20)
            except requests.Timeout:
                return err_image(code="IMAGE_TIMEOUT")
            except requests.RequestException:
                return err_image(code="IMAGE_NETWORK_ERROR")
            body = _json_body(resp)
            status = (
                _nested_text(body, "output", "task_status")
                or _nested_text(body, "task_status")
                or ""
            ).upper()
            if status == "SUCCEEDED":
                image_url = _image_url_from_task(body)
                if not image_url:
                    return err_image(code="IMAGE_UPSTREAM_ERROR")
                return {"ok": True, "result": {"url": image_url}}
            if status in {"FAILED", "CANCELED", "UNKNOWN"}:
                return _upstream_error(body)
            self._sleep(POLL_INTERVAL_SEC)
        return err_image(code="IMAGE_TIMEOUT")

    def _download_image(self, image_url: str) -> dict[str, Any]:
        if not image_url.startswith("https://"):
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        try:
            resp = self._get(image_url, timeout=30, stream=True)
        except requests.Timeout:
            return err_image(code="IMAGE_TIMEOUT")
        except requests.RequestException:
            return err_image(code="IMAGE_NETWORK_ERROR")
        if resp.status_code >= 400:
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        content_length = resp.headers.get("Content-Length") if hasattr(resp, "headers") else None
        try:
            if content_length is not None and int(content_length) > MAX_WAN_IMAGE_BYTES:
                return err_image(
                    code="PAYLOAD_TOO_LARGE",
                    message="画出来的图太大了，请再试一次。",
                    retryable=False,
                )
        except (TypeError, ValueError):
            pass
        chunks: list[bytes] = []
        total = 0
        try:
            iterator = resp.iter_content(64 * 1024) if hasattr(resp, "iter_content") else None
            if iterator is None:
                raw = getattr(resp, "content", b"") or b""
                if len(raw) > MAX_WAN_IMAGE_BYTES:
                    return err_image(
                        code="PAYLOAD_TOO_LARGE",
                        message="画出来的图太大了，请再试一次。",
                        retryable=False,
                    )
                if not raw:
                    return err_image(code="IMAGE_UPSTREAM_ERROR")
                return {"ok": True, "result": {"image_bytes": raw}}
            for chunk in iterator:
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_WAN_IMAGE_BYTES:
                    return err_image(
                        code="PAYLOAD_TOO_LARGE",
                        message="画出来的图太大了，请再试一次。",
                        retryable=False,
                    )
                chunks.append(chunk)
        except requests.RequestException:
            return err_image(code="IMAGE_NETWORK_ERROR")
        if not chunks:
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        return {"ok": True, "result": {"image_bytes": b"".join(chunks)}}


def _json_body(resp: Any) -> dict[str, Any]:
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


def _nested_text(body: dict[str, Any], *keys: str) -> str:
    cursor: Any = body
    for key in keys:
        if not isinstance(cursor, dict):
            return ""
        cursor = cursor.get(key)
    return str(cursor).strip() if cursor else ""


def _image_url_from_task(body: dict[str, Any]) -> str:
    output = body.get("output") if isinstance(body.get("output"), dict) else body
    results = output.get("results") if isinstance(output, dict) else None
    if isinstance(results, list) and results:
        first = results[0]
        if isinstance(first, dict):
            url = str(first.get("url") or "").strip()
            if url:
                return url
    choices = output.get("choices") if isinstance(output, dict) else None
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("image"):
                    return str(item.get("image")).strip()
    return ""


def _upstream_error(body: dict[str, Any]) -> dict[str, Any]:
    joined = " ".join(
        [
            _nested_text(body, "code"),
            _nested_text(body, "message"),
            _nested_text(body, "output", "code"),
            _nested_text(body, "output", "message"),
        ]
    ).lower()
    if "ipinfringement" in joined or "datainspection" in joined or "inappropriate" in joined:
        return err_image(code="IMAGE_BLOCKED")
    return err_image(code="IMAGE_UPSTREAM_ERROR")
