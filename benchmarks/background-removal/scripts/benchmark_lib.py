"""Shared, benchmark-only image removal adapters and metric utilities."""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

from PIL import Image, ImageChops, ImageFilter  # noqa: E402


BENCHMARK_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BENCHMARK_ROOT.parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_config() -> dict[str, Any]:
    return load_json(BENCHMARK_ROOT / "benchmark-config.json")


def load_manifest() -> dict[str, dict[str, Any]]:
    return load_json(BENCHMARK_ROOT / "model-manifest.json")["models"]


def alpha_mask(image: Image.Image, threshold: int) -> Image.Image:
    return image.convert("RGBA").getchannel("A").point(lambda value: 255 if value >= threshold else 0)


def binary_mask(image: Image.Image, threshold: int) -> Image.Image:
    return image.convert("L").point(lambda value: 255 if value >= threshold else 0)


def _count(mask: Image.Image) -> int:
    return sum(1 for value in mask.get_flattened_data() if value >= 128)


def _intersection(left: Image.Image, right: Image.Image) -> int:
    return _count(ImageChops.logical_and(left.convert("1"), right.convert("1")).convert("L"))


def calculate_metrics(output: Image.Image, ground_truth: Image.Image, config: dict[str, Any]) -> dict[str, Any]:
    """Compute metrics against the binary GT at the common alpha threshold."""
    threshold = int(config["alphaThreshold"])
    if output.size != ground_truth.size:
        raise ValueError(f"output size {output.size} does not match ground truth {ground_truth.size}")

    predicted = alpha_mask(output, threshold)
    gt = binary_mask(ground_truth, threshold)
    gt_background = ImageChops.invert(gt)
    pred_background = ImageChops.invert(predicted)

    gt_foreground_count = _count(gt)
    gt_background_count = _count(gt_background)
    retained = _intersection(gt, predicted)
    cleared = _intersection(gt_background, pred_background)
    union = _count(ImageChops.logical_or(gt.convert("1"), predicted.convert("1")).convert("L"))

    kernel = int(config["internalHoleErosionKernel"])
    if kernel < 3 or kernel % 2 == 0:
        raise ValueError("internalHoleErosionKernel must be odd and >= 3")
    interior = gt.filter(ImageFilter.MinFilter(kernel))
    interior_count = _count(interior)
    interior_missing = _intersection(interior, pred_background)

    alpha = output.convert("RGBA").getchannel("A")
    total = alpha.width * alpha.height
    values = list(alpha.get_flattened_data())
    transparent = sum(value < threshold for value in values)
    opaque = sum(value >= 250 for value in values)
    semi = total - transparent - opaque
    return {
        "subjectRetention": retained / gt_foreground_count if gt_foreground_count else None,
        "backgroundClearRate": cleared / gt_background_count if gt_background_count else None,
        "internalHoleRate": interior_missing / interior_count if interior_count else None,
        "foregroundIoU": retained / union if union else None,
        "outputAlphaStats": {
            "alphaThreshold": threshold,
            "transparentRatio": transparent / total if total else 0.0,
            "semiTransparentRatio": semi / total if total else 0.0,
            "opaqueRatio": opaque / total if total else 0.0,
        },
    }


def percentile_95(samples: list[float]) -> float | None:
    if not samples:
        return None
    ordered = sorted(samples)
    index = max(0, min(len(ordered) - 1, int((len(ordered) - 1) * 0.95 + 0.999999)))
    return ordered[index]


@dataclass
class AdapterAvailability:
    available: bool
    reason: str | None = None


class BackgroundRemover:
    """Benchmark seam only. Nothing here is imported by production code."""

    def availability(self) -> AdapterAvailability:
        raise NotImplementedError

    def initialize(self) -> None:
        raise NotImplementedError

    def remove(self, source: Image.Image) -> Image.Image:
        raise NotImplementedError

    @property
    def model_size_bytes(self) -> int | None:
        return None


class CurrentRuleAdapter(BackgroundRemover):
    def availability(self) -> AdapterAvailability:
        return AdapterAvailability(True)

    def initialize(self) -> None:
        if str(BACKEND_ROOT) not in sys.path:
            sys.path.insert(0, str(BACKEND_ROOT))
        from services.image_postprocess import remove_plain_background  # pylint: disable=import-outside-toplevel

        self._remove = remove_plain_background

    def remove(self, source: Image.Image) -> Image.Image:
        return self._remove(source.convert("RGBA"))


class RembgAdapter(BackgroundRemover):
    """Optional ONNX Runtime CPU adapter; no production code relies on rembg."""

    def __init__(self, model_id: str, metadata: dict[str, Any], *, allow_model_download: bool) -> None:
        self.model_id = model_id
        self.metadata = metadata
        self.allow_model_download = allow_model_download
        self._session: Any | None = None
        self._remove: Any | None = None
        self.cache_root = BENCHMARK_ROOT / "models" / "rembg-cache"

    @property
    def _model_path(self) -> Path:
        return self.cache_root / str(self.metadata["cacheFile"])

    @property
    def model_size_bytes(self) -> int | None:
        return self._model_path.stat().st_size if self._model_path.is_file() else None

    def availability(self) -> AdapterAvailability:
        if not self.allow_model_download and not self._model_path.is_file():
            return AdapterAvailability(False, f"model not cached at benchmark-only path: {self._model_path.name}")
        try:
            import rembg  # noqa: F401 # pylint: disable=import-outside-toplevel,unused-import
        except ImportError:
            return AdapterAvailability(False, "optional benchmark dependency rembg[cpu] is not installed")
        return AdapterAvailability(True)

    def initialize(self) -> None:
        # rembg reads this cache location at session creation.  It must remain
        # benchmark-local so model weights never enter a production asset path.
        self.cache_root.mkdir(parents=True, exist_ok=True)
        os.environ["U2NET_HOME"] = str(self.cache_root)
        from rembg import new_session, remove  # pylint: disable=import-outside-toplevel

        self._remove = remove
        self._session = new_session(str(self.metadata["rembgSession"]))

    def remove(self, source: Image.Image) -> Image.Image:
        if self._remove is None or self._session is None:
            raise RuntimeError("adapter has not been initialized")
        rendered = self._remove(source.convert("RGBA"), session=self._session, only_mask=False)
        return rendered.convert("RGBA")


def create_adapter(model_id: str, *, allow_model_download: bool) -> BackgroundRemover:
    manifest = load_manifest()
    if model_id not in manifest:
        raise ValueError(f"unknown benchmark model: {model_id}")
    if model_id == "current-rule":
        return CurrentRuleAdapter()
    return RembgAdapter(model_id, manifest[model_id], allow_model_download=allow_model_download)


def run_timed(adapter: BackgroundRemover, source: Image.Image, warm_runs: int) -> tuple[Image.Image, float, list[float]]:
    """Return first real output plus cold and repeated warm measurements."""
    start = time.perf_counter()
    first = adapter.remove(source)
    cold_ms = (time.perf_counter() - start) * 1000
    samples: list[float] = []
    for _ in range(warm_runs):
        started = time.perf_counter()
        adapter.remove(source)
        samples.append((time.perf_counter() - started) * 1000)
    return first, cold_ms, samples


def performance_record(cold_ms: float, warm_ms: list[float], *, model_size_bytes: int | None, output: Image.Image, peak_rss_mb: float | None) -> dict[str, Any]:
    return {
        "modelSizeBytes": model_size_bytes,
        "coldStartMs": cold_ms,
        "warmInferenceMedianMs": statistics.median(warm_ms) if warm_ms else None,
        "warmInferenceP95Ms": percentile_95(warm_ms),
        "peakRssMb": peak_rss_mb,
        "outputWidth": output.width,
        "outputHeight": output.height,
        "warmRuns": len(warm_ms),
    }


HARD_FAIL_REASONS = {
    "largeSubjectDeletion",
    "visibleInternalHole",
    "criticalStructureLost",
    "multiSubjectMissing",
}


def final_verdict_for_review(review: dict[str, Any]) -> str:
    """Hard failures dominate manual grading; non-reviewed rows stay explicit."""
    reasons = set(review.get("hardFailReasons") or [])
    unknown = reasons - HARD_FAIL_REASONS
    if unknown:
        raise ValueError(f"unknown hard fail reasons: {sorted(unknown)}")
    if reasons or review.get("criticalStructure") == "FAIL" or review.get("visibleInternalHole") is True:
        return "FAIL"
    if review.get("boundaryQuality") is None or review.get("criticalStructure") is None or review.get("visibleInternalHole") is None:
        return "UNREVIEWED"
    if review.get("criticalStructure") == "PARTIAL" or review.get("boundaryQuality") in {"C", "D"}:
        return "WARN"
    return "PASS"
