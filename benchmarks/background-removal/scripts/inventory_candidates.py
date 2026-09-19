"""Read-only inventory for potential project-real background-removal sources.

This tool deliberately records evidence and conservative eligibility hints only. It
never creates a benchmark case, GT, review decision, or manifest entry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image


BENCHMARK_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BENCHMARK_ROOT.parents[1]
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
DEFAULT_ROOTS = (
    REPO_ROOT / "benchmarks" / "fabrication-layer-decomposition" / "fixtures" / "source",
    REPO_ROOT / "assets" / "generated" / "material",
    REPO_ROOT / "backend" / "assets" / "style-references",
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_blob_sha(repo_root: Path, path: Path) -> str | None:
    try:
        relative = path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return None
    result = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "-s", "--", relative],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    fields = result.stdout.split()[1:2]
    return fields[0] if fields else None


def origin_class_for(relative_path: str) -> str:
    lowered = relative_path.lower()
    if "/fixtures/source/" in f"/{lowered}":
        return "PROJECT_FIXTURE"
    if "_thumb" in Path(lowered).stem or "contact-sheet" in lowered or "review" in lowered:
        return "DERIVED_REVIEW_ARTIFACT"
    if "/assets/generated/material/" in f"/{lowered}":
        return "PROJECT_GENERATED_ASSET"
    if "/backend/assets/style-references/" in f"/{lowered}":
        return "PROJECT_USER_ASSET"
    if "/outputs/" in f"/{lowered}" or "purified" in lowered or "overlay" in lowered:
        return "DERIVED_OUTPUT"
    return "UNKNOWN"


def coverage_hints(relative_path: str) -> list[str]:
    lowered = relative_path.lower()
    hints: list[str] = []
    if "white" in lowered or "snow" in lowered:
        hints.append("light-or-white-background")
    if "lantern" in lowered or "flower" in lowered:
        hints.append("irregular-outline")
    if "window" in lowered or "street" in lowered:
        hints.append("textured-or-scene-background")
    if "moon" in lowered:
        hints.append("internal-hole-or-curved-edge-needs-review")
    return hints or ["background-removal-characteristics-needs-review"]


def image_facts(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        has_alpha = "A" in image.getbands() or image.mode == "P"
        alpha = image.convert("RGBA").getchannel("A") if has_alpha else None
        total = width * height
        if alpha is None:
            transparent = semitransparent = 0
            opaque = total
        else:
            histogram = alpha.histogram()
            transparent = histogram[0]
            opaque = histogram[255]
            semitransparent = total - transparent - opaque
    return {
        "width": width,
        "height": height,
        "mode": image.mode,
        "hasAlpha": has_alpha,
        "transparentPixelCount": transparent,
        "semiTransparentPixelCount": semitransparent,
        "opaquePixelCount": opaque,
        "transparentRatio": transparent / total,
        "semiTransparentRatio": semitransparent / total,
    }


def conservative_assessment(relative_path: str, facts: dict[str, Any]) -> tuple[str, str, str, list[str]]:
    origin = origin_class_for(relative_path)
    lowered = relative_path.lower()
    notes: list[str] = []
    if origin in {"DERIVED_REVIEW_ARTIFACT", "DERIVED_OUTPUT"}:
        return origin, "NOT_SUITABLE", "BLOCKED", ["derived artifact/output is not an original input source"]
    if facts["transparentPixelCount"]:
        return origin, "NOT_SUITABLE", "BLOCKED", ["contains transparent pixels; likely a pre-cut/sticker asset and not a background-removal input"]
    if "background_" in Path(lowered).name:
        return origin, "NOT_SUITABLE", "BLOCKED", ["path indicates a background-only asset rather than a foreground-plus-background input"]
    if origin == "UNKNOWN":
        return origin, "NEEDS_REVIEW", "BLOCKED", ["origin and project-use evidence require human confirmation"]
    notes.append("opaque source is a possible input, but real-background content, rights, and GT must be reviewed by a human")
    return origin, "NEEDS_REVIEW", "CANDIDATE", notes


def inventory_paths(paths: list[Path], repo_root: Path = REPO_ROOT) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted({item.resolve() for item in paths}, key=lambda item: item.as_posix()):
        if path.suffix.lower() not in IMAGE_SUFFIXES or not path.is_file():
            continue
        relative = path.resolve().relative_to(repo_root.resolve()).as_posix()
        facts = image_facts(path)
        origin, suitability, eligibility, notes = conservative_assessment(relative, facts)
        digest = sha256_file(path)
        records.append({
            "candidateId": f"BRC-{len(records) + 1:03d}",
            "sourcePath": relative,
            "sourceSha256": digest,
            "gitBlobSha": git_blob_sha(repo_root, path),
            "sourceLineageId": f"sha256:{digest}",
            "duplicateOf": None,
            "originClass": origin,
            "projectUseEvidence": f"tracked project path: {relative}" if git_blob_sha(repo_root, path) else f"project workspace path: {relative}",
            "backgroundRemovalSuitability": suitability,
            "coverageTags": coverage_hints(relative),
            "rightsStatus": "NEEDS_CONFIRMATION",
            "gtStatus": "MISSING",
            "acceptanceEligibility": eligibility,
            "notes": notes,
            "imageFacts": facts,
        })
    canonical_by_sha: dict[str, str] = {}
    for record in records:
        digest = record["sourceSha256"]
        if digest in canonical_by_sha:
            record["duplicateOf"] = canonical_by_sha[digest]
            record["sourceLineageId"] = next(item["sourceLineageId"] for item in records if item["candidateId"] == canonical_by_sha[digest])
            record["acceptanceEligibility"] = "BLOCKED"
            record["notes"].append("duplicate content SHA; does not create an independent source lineage")
        else:
            canonical_by_sha[digest] = record["candidateId"]
    return records


def discover_default_paths() -> list[Path]:
    return [path for root in DEFAULT_ROOTS if root.is_dir() for path in root.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES]


def write_inventory(records: list[dict[str, Any]], json_path: Path, markdown_path: Path) -> None:
    unique_lineages = len({record["sourceLineageId"] for record in records if record["duplicateOf"] is None})
    summary = Counter(record["backgroundRemovalSuitability"] for record in records)
    payload = {
        "schemaVersion": "background-removal.candidate-inventory/1",
        "generatedBy": "inventory_candidates.py",
        "candidateCount": len(records),
        "uniqueSourceLineageCount": unique_lineages,
        "records": records,
    }
    json_path.write_bytes((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    rows = [
        "# M3-C1 Background Removal Candidate Inventory",
        "",
        f"- Inventoried image files: {len(records)}",
        f"- Unique content-SHA source lineages: {unique_lineages}",
        f"- Suitability counts: {dict(sorted(summary.items()))}",
        "- This is a conservative preparation record, not a GT approval or acceptance manifest.",
        "",
        "| Candidate | Source | Origin | Alpha evidence | Suitability | Eligibility | Duplicate |",
        "|---|---|---|---|---|---|---|",
    ]
    for record in records:
        facts = record["imageFacts"]
        alpha = f"transparent={facts['transparentPixelCount']}; semi={facts['semiTransparentPixelCount']}"
        rows.append(f"| {record['candidateId']} | `{record['sourcePath']}` | {record['originClass']} | {alpha} | {record['backgroundRemovalSuitability']} | {record['acceptanceEligibility']} | {record['duplicateOf'] or ''} |")
    markdown_path.write_bytes(("\n".join(rows) + "\n").encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-json", type=Path, default=BENCHMARK_ROOT / "M3-C1_CANDIDATE_INVENTORY.json")
    parser.add_argument("--output-markdown", type=Path, default=BENCHMARK_ROOT / "M3-C1_CANDIDATE_INVENTORY.md")
    args = parser.parse_args()
    records = inventory_paths(discover_default_paths())
    write_inventory(records, args.output_json, args.output_markdown)
    print(f"inventoried={len(records)} uniqueLineages={len({record['sourceLineageId'] for record in records if record['duplicateOf'] is None})}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
