"""Fixed, trusted style references loaded only by the Gateway."""

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
_FELT_STYLE_REF_V1 = StyleReferenceSet(
    reference_set_id="felt-style-ref-v1",
    filenames=tuple(f"{index:02d}.png" for index in range(1, 9)),
)
_SETS = {_FELT_STYLE_REF_V1.reference_set_id: _FELT_STYLE_REF_V1}


def get_style_reference_set(reference_set_id: str) -> StyleReferenceSet:
    ref_set = _SETS.get((reference_set_id or "").strip())
    if ref_set is None or len(ref_set.filenames) != 8:
        raise StyleReferenceSetError("unknown or invalid style reference set")
    return ref_set


def _contained_file(root: Path, filename: str) -> Path:
    if Path(filename).name != filename or not filename.lower().endswith(".png"):
        raise StyleReferenceSetError("invalid reference filename")
    try:
        resolved_root = root.resolve(strict=True)
        candidate = (resolved_root / filename).resolve(strict=True)
        candidate.relative_to(resolved_root)
    except (OSError, ValueError) as exc:
        raise StyleReferenceSetError("reference path is unavailable or escaped root") from exc
    if not candidate.is_file():
        raise StyleReferenceSetError("reference is not a file")
    return candidate


def resolve_reference_images(reference_set_id: str) -> list[str]:
    """Return data URIs for Ark; never expose a path or URI outside backend code."""
    ref_set = get_style_reference_set(reference_set_id)
    root = REFERENCE_ASSETS_ROOT / ref_set.reference_set_id
    images: list[str] = []
    for filename in ref_set.filenames:
        try:
            raw = _contained_file(root, filename).read_bytes()
        except OSError as exc:
            raise StyleReferenceSetError("reference is unreadable") from exc
        # Signature plus mandatory IHDR makes the accepted format explicit.
        if len(raw) < 33 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
            raise StyleReferenceSetError("reference is not a supported PNG")
        images.append("data:image/png;base64," + base64.b64encode(raw).decode("ascii"))
    if len(images) != 8:
        raise StyleReferenceSetError("reference count mismatch")
    return images


def reference_set_summary(reference_set_id: str) -> dict[str, object]:
    ref_set = get_style_reference_set(reference_set_id)
    return {"referenceSetId": ref_set.reference_set_id, "referenceCount": len(ref_set.filenames)}
