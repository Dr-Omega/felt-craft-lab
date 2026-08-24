"""Trusted, fixed style-reference sets for server-side generation profiles."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path


class StyleReferenceSetError(ValueError):
    pass


@dataclass(frozen=True)
class StyleReferenceSet:
    reference_set_id: str
    filenames: tuple[str, ...]


REFERENCE_ASSETS_ROOT = Path(__file__).resolve().parents[1] / "assets" / "style-references"
_FELT_REF_V1 = StyleReferenceSet(
    reference_set_id="felt-style-ref-v1",
    filenames=tuple(f"{index:02d}.png" for index in range(1, 9)),
)
_SETS = {_FELT_REF_V1.reference_set_id: _FELT_REF_V1}


def get_style_reference_set(reference_set_id: str) -> StyleReferenceSet:
    ref_set = _SETS.get((reference_set_id or "").strip())
    if ref_set is None:
        raise StyleReferenceSetError("unknown style reference set")
    if len(ref_set.filenames) != 8:
        raise StyleReferenceSetError("style reference set must contain exactly 8 files")
    return ref_set


def _contained_file(root: Path, filename: str) -> Path:
    # The registry gives only bare names, but retain containment verification so
    # future registry changes cannot turn style assets into arbitrary file reads.
    if Path(filename).name != filename or not filename.lower().endswith(".png"):
        raise StyleReferenceSetError("invalid reference filename")
    root_resolved = root.resolve(strict=True)
    candidate = (root_resolved / filename).resolve(strict=True)
    try:
        candidate.relative_to(root_resolved)
    except ValueError as exc:
        raise StyleReferenceSetError("reference path escapes configured root") from exc
    if not candidate.is_file():
        raise StyleReferenceSetError("reference is not a file")
    return candidate


def resolve_reference_images(reference_set_id: str) -> list[str]:
    """Load a set as API-ready data URIs without exposing paths to callers."""
    ref_set = get_style_reference_set(reference_set_id)
    root = REFERENCE_ASSETS_ROOT / ref_set.reference_set_id
    try:
        root.resolve(strict=True)
    except OSError as exc:
        raise StyleReferenceSetError("reference directory is unavailable") from exc

    images: list[str] = []
    for filename in ref_set.filenames:
        try:
            path = _contained_file(root, filename)
            raw = path.read_bytes()
        except OSError as exc:
            raise StyleReferenceSetError("style reference is unavailable") from exc
        # PNG signature + mandatory first IHDR chunk: cheap deterministic format
        # validation before a third-party API ever receives the reference data.
        if len(raw) < 33 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
            raise StyleReferenceSetError("style reference has an unsupported format")
        images.append("data:image/png;base64," + base64.b64encode(raw).decode("ascii"))
    if len(images) != 8:
        raise StyleReferenceSetError("style reference count mismatch")
    return images


def reference_set_summary(reference_set_id: str) -> dict[str, object]:
    ref_set = get_style_reference_set(reference_set_id)
    # Deliberately do not include paths, URLs, or image data.
    return {"referenceSetId": ref_set.reference_set_id, "referenceCount": len(ref_set.filenames)}
