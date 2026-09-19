"""Shared, benchmark-only image removal adapters and metric utilities."""

from __future__ import annotations

import json
import os
import hashlib
import platform
import statistics
import sys
import threading
import time
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

from PIL import Image, ImageChops, ImageFilter  # noqa: E402


BENCHMARK_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BENCHMARK_ROOT.parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
MODEL_CACHE_ROOT = BENCHMARK_ROOT / "models" / "rembg-cache"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_config() -> dict[str, Any]:
    return load_json(BENCHMARK_ROOT / "benchmark-config.json")


def load_acceptance_environment() -> dict[str, Any]:
    """The single machine-readable runtime contract for formal acceptance."""
    contract = load_json(BENCHMARK_ROOT / "acceptance-environment.json")
    validate_acceptance_environment_contract(contract)
    return contract


def validate_acceptance_environment_contract(contract: object) -> None:
    """Validate a frozen contract without consulting the current worktree."""
    if not isinstance(contract, dict):
        raise ValueError("invalid acceptance environment contract")
    packages = contract.get("packages")
    if contract.get("schemaVersion") != "background-removal.acceptance-environment/1" or not isinstance(contract.get("python"), str) or not isinstance(packages, dict):
        raise ValueError("invalid acceptance environment contract")
    required = {"rembg", "onnxruntime", "Pillow", "numpy", "psutil"}
    if set(packages) != required or not all(isinstance(packages[name], str) and packages[name] for name in required):
        raise ValueError("acceptance environment contract must pin every required package")


def canonical_environment_contract_sha256(contract: object) -> str:
    """Hash the semantic environment contract, independent of file formatting."""
    validate_acceptance_environment_contract(contract)
    payload = json.dumps(contract, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def validate_frozen_formal_dataset_snapshot(snapshot: object, dataset_validation: object) -> dict[str, int]:
    """Fail closed unless a frozen all-cases snapshot remains formal-acceptance eligible."""
    if not isinstance(snapshot, dict) or not isinstance(dataset_validation, dict):
        raise ValueError("formal acceptance requires a dataset snapshot and validation")
    required_count = snapshot.get("requiredProjectRealReviewedCaseCount")
    cases = snapshot.get("cases")
    selected = snapshot.get("selectedCaseIds")
    manifest_sha = snapshot.get("acceptanceDatasetManifestSha256")
    if required_count != 15 or not isinstance(cases, list) or len(cases) < required_count:
        raise ValueError("formal dataset snapshot must contain at least 15 required project-real cases")
    if not isinstance(selected, list) or not all(isinstance(case_id, str) and case_id for case_id in selected):
        raise ValueError("formal dataset snapshot selectedCaseIds is invalid")
    if len(selected) != len(set(selected)):
        raise ValueError("formal dataset snapshot selectedCaseIds contains duplicates")
    if not isinstance(manifest_sha, str) or len(manifest_sha) != 64:
        raise ValueError("formal dataset snapshot manifest identity is invalid")

    case_ids: set[str] = set()
    lineages: set[str] = set()
    for entry in cases:
        if not isinstance(entry, dict):
            raise ValueError("formal dataset snapshot case must be an object")
        case_id = entry.get("caseId")
        lineage = entry.get("sourceLineageId")
        if not isinstance(case_id, str) or not case_id or not isinstance(lineage, str) or not lineage:
            raise ValueError("formal dataset snapshot case identity is invalid")
        if case_id in case_ids or lineage in lineages:
            raise ValueError("formal dataset snapshot contains duplicate caseId or sourceLineageId")
        case_ids.add(case_id)
        lineages.add(lineage)
        if entry.get("datasetRole") != "PROJECT_REAL_ACCEPTANCE":
            raise ValueError("formal dataset snapshot may contain only PROJECT_REAL_ACCEPTANCE cases")
        tags = entry.get("coverageTags")
        if not isinstance(tags, list) or not tags or not all(isinstance(tag, str) and tag.strip() for tag in tags):
            raise ValueError("formal dataset snapshot coverageTags must be a non-empty string array")
        review = entry.get("groundTruthReview")
        if not isinstance(review, dict) or review.get("state") != "APPROVED" or review.get("signoff") != "SIGNED_OFF" or review.get("reviewerRole") != "PROJECT_DATASET_REVIEWER":
            raise ValueError("formal dataset snapshot ground truth review is not approved and signed off")

    if set(selected) != case_ids:
        raise ValueError("formal dataset snapshot selectedCaseIds do not match snapshot cases")
    recomputed = {"projectRealReviewedCaseCount": len(case_ids), "sourceLineageCount": len(lineages)}
    if (
        dataset_validation.get("valid") is not True
        or dataset_validation.get("requiredProjectRealReviewedCaseCount") != required_count
        or dataset_validation.get("projectRealReviewedCaseCount") != recomputed["projectRealReviewedCaseCount"]
        or dataset_validation.get("sourceLineageCount") != recomputed["sourceLineageCount"]
        or dataset_validation.get("selectedCaseIds") != selected
        or dataset_validation.get("manifestSha256") != manifest_sha
    ):
        raise ValueError("formal dataset validation does not match frozen snapshot")
    return recomputed


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
        self.cache_root = MODEL_CACHE_ROOT

    @property
    def _model_path(self) -> Path:
        return self.cache_root / str(self.metadata["cacheFile"])

    @property
    def model_size_bytes(self) -> int | None:
        return self._model_path.stat().st_size if self._model_path.is_file() else None

    def availability(self) -> AdapterAvailability:
        artifact = model_artifact_record(self.model_id, self.metadata)
        if not self.allow_model_download and not artifact["artifactVerified"]:
            return AdapterAvailability(False, artifact["verificationReason"])
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
        artifact = model_artifact_record(self.model_id, self.metadata)
        if not artifact["artifactVerified"]:
            raise RuntimeError(artifact["verificationReason"])

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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def model_artifact_record(model_id: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Inspect the local artifact; manifest values alone never verify a weight."""
    exact_revision = metadata.get("exactModelRevision")
    license_status = metadata.get("weightLicenseVerificationStatus")
    if model_id == "current-rule":
        return {
            "modelPath": "NOT_APPLICABLE",
            "modelSizeBytes": None,
            "expectedSha256": "NOT_APPLICABLE",
            "actualSha256": "NOT_APPLICABLE",
            "actualModelSha256": "NOT_APPLICABLE",
            "sha256Match": "NOT_APPLICABLE",
            "exactModelRevision": exact_revision,
            "weightLicenseVerificationStatus": license_status,
            "artifactVerified": True,
            "verificationReason": None,
        }
    cache_file = str(metadata["cacheFile"])
    path = MODEL_CACHE_ROOT / cache_file
    expected = metadata.get("modelSha256")
    try:
        display_path = str(path.relative_to(BENCHMARK_ROOT))
    except ValueError:
        display_path = str(path)
    record: dict[str, Any] = {
        "modelPath": display_path,
        "modelSizeBytes": path.stat().st_size if path.is_file() else None,
        "expectedSha256": expected,
        "actualSha256": sha256_file(path) if path.is_file() else None,
        "exactModelRevision": exact_revision,
        "weightLicenseVerificationStatus": license_status,
    }
    record["actualModelSha256"] = record["actualSha256"]
    record["sha256Match"] = bool(expected and record["actualSha256"] and str(expected).lower() == str(record["actualSha256"]).lower())
    record["artifactVerified"] = bool(record["sha256Match"] and exact_revision and license_status == "VERIFIED")
    if not path.is_file():
        record["verificationReason"] = f"model artifact is not cached: {cache_file}"
    elif not expected:
        record["verificationReason"] = f"model artifact has no expected SHA-256 in manifest: {cache_file}"
    elif not record["sha256Match"]:
        record["verificationReason"] = f"model artifact SHA-256 mismatch: {cache_file}"
    elif not exact_revision:
        record["verificationReason"] = f"model artifact exact revision is not recorded: {cache_file}"
    elif license_status != "VERIFIED":
        record["verificationReason"] = f"model artifact licence is not verified: {cache_file}"
    else:
        record["verificationReason"] = None
    return record


def run_timed(adapter: BackgroundRemover, source: Image.Image, warm_runs: int) -> tuple[Image.Image, float, list[float]]:
    """Return first inference output/timing, then repeated warm timings."""
    start = time.perf_counter()
    first = adapter.remove(source)
    first_inference_ms = (time.perf_counter() - start) * 1000
    samples: list[float] = []
    for _ in range(warm_runs):
        started = time.perf_counter()
        adapter.remove(source)
        samples.append((time.perf_counter() - started) * 1000)
    return first, first_inference_ms, samples


def performance_record(initialize_ms: float, first_inference_ms: float, warm_ms: list[float], *, model_size_bytes: int | None, output: Image.Image) -> dict[str, Any]:
    return {
        "modelSizeBytes": model_size_bytes,
        "initializeMs": initialize_ms,
        "firstInferenceMs": first_inference_ms,
        "warmInferenceMedianMs": statistics.median(warm_ms) if warm_ms else None,
        "warmInferenceP95Ms": percentile_95(warm_ms),
        "outputWidth": output.width,
        "outputHeight": output.height,
        "warmRuns": len(warm_ms),
    }


class ProcessRssSampler:
    """High-frequency RSS sampler covering initialization and all inferences."""

    def __init__(self, interval_ms: int = 10) -> None:
        if interval_ms < 1:
            raise ValueError("RSS sample interval must be at least 1 ms")
        self.interval_seconds = interval_ms / 1000
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._peak_rss_mb: float | None = None
        try:
            import psutil  # pylint: disable=import-outside-toplevel

            self._process: Any | None = psutil.Process()
        except ImportError:
            self._process = None

    @property
    def available(self) -> bool:
        return self._process is not None

    @property
    def peak_rss_mb(self) -> float | None:
        return self._peak_rss_mb

    def _sample_once(self) -> None:
        if self._process is None:
            return
        rss_mb = self._process.memory_info().rss / (1024 * 1024)
        self._peak_rss_mb = rss_mb if self._peak_rss_mb is None else max(self._peak_rss_mb, rss_mb)

    def _sample_loop(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            self._sample_once()

    def start(self) -> None:
        self._sample_once()
        if not self.available:
            return
        self._thread = threading.Thread(target=self._sample_loop, name="benchmark-rss-sampler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=max(1.0, self.interval_seconds * 4))
        self._sample_once()


def installed_runtime_versions() -> dict[str, str | None]:
    """Report exact installed distributions without pulling in optional packages."""
    def installed(package: str) -> str | None:
        try:
            return version(package)
        except PackageNotFoundError:
            return None

    return {
        "python": platform.python_version(),
        "rembg": installed("rembg"),
        "onnxruntime": installed("onnxruntime"),
        "Pillow": installed("Pillow"),
        "numpy": installed("numpy"),
        "psutil": installed("psutil"),
    }


def runtime_environment_validation(runtime_versions: dict[str, Any], contract: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fail closed unless every formal runtime requirement exactly matches."""
    expected = contract or load_acceptance_environment()
    try:
        validate_acceptance_environment_contract(expected)
    except ValueError as exc:
        return {"valid": False, "mismatches": {"environmentContract": {"expected": "valid frozen contract", "actual": str(exc)}}}
    required_python = str(expected["python"])
    required_packages = expected["packages"]
    mismatches: dict[str, dict[str, Any]] = {}
    actual_python = runtime_versions.get("python")
    if not isinstance(actual_python, str) or not actual_python.startswith(f"{required_python}."):
        mismatches["python"] = {"expected": f"{required_python}.x", "actual": actual_python}
    for package, required_version in required_packages.items():
        actual = runtime_versions.get(package)
        if actual != required_version:
            mismatches[package] = {"expected": required_version, "actual": actual}
    return {"valid": not mismatches, "mismatches": mismatches}


def reproducibility_complete(reproducibility: dict[str, Any], selected_models: list[str]) -> bool:
    runtime_versions = reproducibility.get("runtimeVersions", {})
    environment_contract = reproducibility.get("environmentContract")
    environment_contract_sha256 = reproducibility.get("environmentContractSha256")
    try:
        expected_contract_sha256 = canonical_environment_contract_sha256(environment_contract)
    except ValueError:
        return False
    if (
        not isinstance(runtime_versions, dict)
        or not isinstance(environment_contract, dict)
        or not isinstance(environment_contract_sha256, str)
        or environment_contract_sha256 != expected_contract_sha256
        or not runtime_environment_validation(runtime_versions, environment_contract).get("valid")
    ):
        return False
    artifacts = reproducibility.get("modelArtifacts", {})
    for model_id in selected_models:
        artifact = artifacts.get(model_id, {})
        if model_id == "current-rule":
            continue
        if not artifact.get("exactModelRevision") or not artifact.get("expectedSha256"):
            return False
        if artifact.get("weightLicenseVerificationStatus") != "VERIFIED" or artifact.get("sha256Match") is not True or artifact.get("artifactVerified") is not True:
            return False
    return True


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


def manual_review_complete(review: dict[str, Any] | None) -> bool:
    if review is None:
        return False
    if review.get("boundaryQuality") not in {"A", "B", "C", "D"}:
        return False
    if review.get("criticalStructure") not in {"PASS", "PARTIAL", "FAIL"}:
        return False
    if not isinstance(review.get("visibleInternalHole"), bool):
        return False
    return final_verdict_for_review(review) != "UNREVIEWED"


def model_run_status(case_rows: list[dict[str, Any]], expected_case_count: int) -> str:
    """A model cannot be run-complete when any expected case failed or is absent."""
    if len(case_rows) != expected_case_count or any(row.get("status") != "SUCCESS" for row in case_rows):
        return "FAILED"
    return "RUN_COMPLETE"


def classify_benchmark_status(result: dict[str, Any]) -> str:
    """Return the only status allowed to make an acceptance conclusion explicit."""
    dataset_validation = result.get("datasetValidation", {})
    if result.get("scope") != "all-cases":
        return "PARTIAL"
    try:
        validate_frozen_formal_dataset_snapshot(result.get("datasetSnapshot"), dataset_validation)
    except ValueError:
        return "PARTIAL"

    selected_models = list(result.get("selectedModels", []))
    snapshot = result["datasetSnapshot"]
    snapshot_case_ids = snapshot["selectedCaseIds"]
    if result.get("caseIds") != snapshot_case_ids:
        return "PARTIAL"
    configuration = result.get("configuration")
    if not isinstance(configuration, dict) or selected_models != configuration.get("modelOrder"):
        return "PARTIAL"
    case_ids = snapshot_case_ids
    expected_pairs = {(model_id, case_id) for model_id in selected_models for case_id in case_ids}
    rows = result.get("caseResults", [])
    actual_pairs = {(row.get("modelId"), row.get("caseId")) for row in rows}
    model_records = result.get("models", {})

    initialized = all(
        model_records.get(model_id, {}).get("initializeStatus") == "SUCCESS"
        and model_records.get(model_id, {}).get("status") == "RUN_COMPLETE"
        for model_id in selected_models
    )
    successful_rows = all(row.get("status") == "SUCCESS" for row in rows)
    if not selected_models or not case_ids or actual_pairs != expected_pairs or len(rows) != len(expected_pairs) or not initialized or not successful_rows:
        return "FAILED"

    if not all(manual_review_complete(row.get("manualReview")) for row in rows):
        return "RUN_COMPLETE_UNREVIEWED"

    if not reproducibility_complete(result.get("reproducibility", {}), selected_models):
        return "RUN_COMPLETE_UNVERIFIED"
    return "ACCEPTANCE_COMPLETE"
