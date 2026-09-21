"""Read-only inventory for potential project-real background-removal sources.

This tool deliberately records evidence and conservative eligibility hints only. It
never creates a benchmark case, GT, review decision, or manifest entry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
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
    stem = Path(lowered).stem
    if (
        re.search(r"(?:^|[_-])(?:thumb|thumbnail|preview)(?:$|[_-])", stem)
        or "contact-sheet" in lowered
        or "contact_sheet" in lowered
        or "review" in lowered
    ):
        return "DERIVED_REVIEW_ARTIFACT"
    if "/outputs/" in f"/{lowered}" or "purified" in lowered or "overlay" in lowered:
        return "DERIVED_OUTPUT"
    if "/fixtures/source/" in f"/{lowered}":
        return "PROJECT_FIXTURE"
    if "/assets/generated/material/" in f"/{lowered}":
        return "PROJECT_GENERATED_ASSET"
    if "/backend/assets/style-references/" in f"/{lowered}":
        return "PROJECT_USER_ASSET"
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


def provisional_lineage_key(relative_path: str) -> str:
    """Group obvious filename variants without asserting a real-world lineage.

    This is deliberately a weak, reviewable heuristic: it helps a reviewer see
    that ``foo.png`` and ``foo_thumb.png`` should not be counted separately,
    but never promotes a group to a confirmed source lineage.
    """
    path = Path(relative_path)
    stem = path.stem.lower()
    stem = re.sub(r"(?:[_-](?:thumb|thumbnail|preview|small|large)|\s+copy)+$", "", stem)
    context = path.parent.as_posix().lower().strip(".") or "root"
    return f"provisional:{context}/{stem or 'unnamed'}"


def image_facts(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        alpha = image.convert("RGBA").getchannel("A")
        total = width * height
        histogram = alpha.histogram()
        transparent = histogram[0]
        opaque = histogram[255]
        semitransparent = total - transparent - opaque
    return {
        "width": width,
        "height": height,
        "mode": image.mode,
        "hasAlpha": "A" in image.getbands() or image.mode == "P",
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
    if "mock" in Path(lowered).stem:
        return origin, "NOT_SUITABLE", "BLOCKED", ["mock/test placeholder asset is not a project-real background-removal candidate"]
    if origin in {"DERIVED_REVIEW_ARTIFACT", "DERIVED_OUTPUT"}:
        return origin, "NOT_SUITABLE", "BLOCKED", ["derived artifact/output is not an original input source"]
    if facts["transparentPixelCount"] or facts["semiTransparentPixelCount"]:
        return origin, "NOT_SUITABLE", "BLOCKED", ["contains non-opaque pixels; likely a pre-cut/sticker asset and not a background-removal input"]
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
        provisional_lineage = provisional_lineage_key(relative)
        records.append({
            "candidateId": f"BRC-{len(records) + 1:03d}",
            "sourcePath": relative,
            "sourceSha256": digest,
            "contentIdentitySha256": digest,
            "gitBlobSha": git_blob_sha(repo_root, path),
            "sourceLineageId": provisional_lineage,
            "lineageStatus": "NEEDS_REVIEW",
            "variantOf": None,
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
    canonical_by_lineage: dict[str, str] = {}
    for record in records:
        digest = record["sourceSha256"]
        if digest in canonical_by_sha:
            record["duplicateOf"] = canonical_by_sha[digest]
            canonical = next(item for item in records if item["candidateId"] == canonical_by_sha[digest])
            record["sourceLineageId"] = canonical["sourceLineageId"]
            record["acceptanceEligibility"] = "BLOCKED"
            record["notes"].append("duplicate content SHA; does not create an independent byte identity or confirmed source lineage")
            # A byte duplicate is a complete identity finding, not filename-variant
            # evidence. Do not give it a second, misleading grouping reason.
            continue
        else:
            canonical_by_sha[digest] = record["candidateId"]
        lineage = record["sourceLineageId"]
        if lineage in canonical_by_lineage and record["candidateId"] != canonical_by_lineage[lineage]:
            record["variantOf"] = canonical_by_lineage[lineage]
            record["notes"].append("obvious filename variant grouped provisionally; human source-lineage confirmation is required")
        else:
            canonical_by_lineage[lineage] = record["candidateId"]
    return records


def discover_default_paths() -> list[Path]:
    return [path for root in DEFAULT_ROOTS if root.is_dir() for path in root.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES]


def write_inventory(records: list[dict[str, Any]], json_path: Path, markdown_path: Path) -> None:
    unique_byte_identities = len({record["contentIdentitySha256"] for record in records})
    confirmed_lineages = len({record["sourceLineageId"] for record in records if record["lineageStatus"] == "CONFIRMED"})
    unresolved_lineage_groups = len({record["sourceLineageId"] for record in records if record["lineageStatus"] == "NEEDS_REVIEW"})
    summary = Counter(record["backgroundRemovalSuitability"] for record in records)
    payload = {
        "schemaVersion": "background-removal.candidate-inventory/2",
        "generatedBy": "inventory_candidates.py",
        "candidateCount": len(records),
        "uniqueByteIdentityCount": unique_byte_identities,
        "confirmedSourceLineageCount": confirmed_lineages,
        "unresolvedLineageGroupCount": unresolved_lineage_groups,
        "records": records,
    }
    json_path.write_bytes((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    rows = [
        "# M3-C1 Background Removal Candidate Inventory",
        "",
        f"- Inventoried image files: {len(records)}",
        f"- Unique byte identities (SHA-256): {unique_byte_identities}",
        f"- Confirmed source lineages: {confirmed_lineages}",
        f"- Unresolved provisional lineage groups: {unresolved_lineage_groups}",
        f"- Suitability counts: {dict(sorted(summary.items()))}",
        "- This is a conservative preparation record, not a GT approval or acceptance manifest.",
        "",
        "| Candidate | Source | Origin | Lineage status | Alpha evidence | Suitability | Eligibility | Duplicate / variant |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for record in records:
        facts = record["imageFacts"]
        alpha = f"transparent={facts['transparentPixelCount']}; semi={facts['semiTransparentPixelCount']}"
        related = record["duplicateOf"] or record["variantOf"] or ""
        rows.append(f"| {record['candidateId']} | `{record['sourcePath']}` | {record['originClass']} | {record['lineageStatus']} | {alpha} | {record['backgroundRemovalSuitability']} | {record['acceptanceEligibility']} | {related} |")
    markdown_path.write_bytes(("\n".join(rows) + "\n").encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-json", type=Path, default=BENCHMARK_ROOT / "M3-C1_CANDIDATE_INVENTORY.json")
    parser.add_argument("--output-markdown", type=Path, default=BENCHMARK_ROOT / "M3-C1_CANDIDATE_INVENTORY.md")
    args = parser.parse_args()
    records = inventory_paths(discover_default_paths())
    write_inventory(records, args.output_json, args.output_markdown)
    print(f"inventoried={len(records)} uniqueByteIdentities={len({record['contentIdentitySha256'] for record in records})} confirmedSourceLineages=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
