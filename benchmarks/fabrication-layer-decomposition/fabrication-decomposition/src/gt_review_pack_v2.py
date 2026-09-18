"""Build the bucketed project-real B2 GT review pack v2.

This module discovers review candidates only.  It never changes Frozen Region
geometry, B2-V0 pieces, or semantic ground truth.
"""

from __future__ import annotations

from collections import defaultdict
from itertools import combinations
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.color import deltaE_ciede2000

from b2_contract import PRIMARY_PROFILE, load_json, write_json
from gt_review_pack import (
    HIGH_VALUE_CASES,
    _candidate_panel,
    _color,
    _component_map,
    _overlay,
    _sheet,
)


PACK_STATUS = "PROJECT_REAL_B2_GT_PACK_V2_READY_FOR_EXTERNAL_REVIEW"
V1_STATUS = "AUDIT_SAMPLE_ONLY"
BUCKETS = (
    "SAME_REGION_MULTI_COMPONENT",
    "SAME_SURFACE_COLOR_SPLIT",
    "CONTAINED_OVERLAY_HOST",
    "DIRECT_FILL_FILL_ADJACENCY",
    "STROKE_MEDIATED_FILL_FILL_ADJACENCY",
    "STROKE_STRESS_CONTROL",
)
BUCKET_LIMITS = {
    "SAME_REGION_MULTI_COMPONENT": 2,
    "SAME_SURFACE_COLOR_SPLIT": 3,
    "CONTAINED_OVERLAY_HOST": 8,
    "DIRECT_FILL_FILL_ADJACENCY": 4,
    "STROKE_MEDIATED_FILL_FILL_ADJACENCY": 6,
    "STROKE_STRESS_CONTROL": 2,
}
QUESTIONS_V2 = {
    "samePhysicalPiece": ["YES", "NO", "AMBIGUOUS", "NOT_APPLICABLE"],
    "hiddenContinuousArea": ["YES", "NO", "AMBIGUOUS", "NOT_APPLICABLE"],
    "stacking": ["A_ABOVE_B", "B_ABOVE_A", "AMBIGUOUS", "NOT_APPLICABLE"],
    "hiddenGeometryNeeded": ["REQUIRED", "OPTIONAL", "NOT_REQUIRED", "AMBIGUOUS"],
    "multipleAcceptableDecompositions": ["YES", "NO"],
}
FABRICATION_ROLES = ["BASE_FILL", "OVERLAY_FILL", "STROKE_DETAIL", "UNKNOWN"]
# External-review focus pairs. These lock visual coverage only; they are not
# semantic labels and all corresponding review answers remain null.
REQUIRED_REVIEW_PAIRS = {
    "FLD-002": {(4, 7), (6, 7), (7, 9)},
    "FLD-003": {(2, 3), (3, 8), (3, 9)},
    "FLD-004": {(128, 132), (131, 132), (14, 128)},
    "FLD-006": {(6, 9), (6, 10), (6, 19), (6, 20), (6, 21), (6, 22), (6, 26)},
    "FLD-008": {(8, 9), (9, 11), (9, 17), (14, 15), (34, 36)},
}


def _largest_component_by_region(
    pieces: list[dict[str, Any]], component_records: dict[str, dict[str, Any]]
) -> tuple[dict[int, dict[str, Any]], dict[str, dict[str, Any]]]:
    pieces_by_component = {row["sourceComponentIds"][0]: row for row in pieces}
    by_region: dict[int, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for component_id, record in component_records.items():
        by_region[int(record["regionId"])].append((component_id, record))
    largest: dict[int, dict[str, Any]] = {}
    for region_id, rows in by_region.items():
        component_id, record = max(rows, key=lambda row: (int(row[1]["area"]), row[0]))
        largest[region_id] = {
            "componentId": component_id,
            "piece": pieces_by_component[component_id],
            **record,
        }
    return largest, pieces_by_component


def _is_stroke_like(region: dict[str, Any], image_area: int) -> bool:
    """Review-only stroke heuristic; it is evidence, never a semantic label."""
    lightness = float(region["representativeColorLab"][0])
    rgb = [int(value) for value in region["representativeColorRgb"]]
    channel_spread = max(rgb) - min(rgb)
    area = int(region["area"])
    bbox = region["bbox"]
    bbox_area = max(1, int(bbox[2]) * int(bbox[3]))
    occupancy = area / bbox_area
    # Neutral black/dark outlines are controls. Saturated dark-red surface
    # slices remain fill candidates; low lightness alone must not classify them
    # as legacy strokes.
    return (
        lightness <= 28.0
        and channel_spread <= 30
        and (area <= image_area * 0.20 or occupancy <= 0.42)
    )


def _delta_e(first: dict[str, Any], second: dict[str, Any]) -> float:
    a = np.asarray(first["representativeColorLab"], dtype=np.float64).reshape(1, 3)
    b = np.asarray(second["representativeColorLab"], dtype=np.float64).reshape(1, 3)
    return float(deltaE_ciede2000(a, b)[0])


def _bbox_contains(outer: list[int], inner: list[int], margin: int = 2) -> bool:
    ox, oy, ow, oh = map(int, outer)
    ix, iy, iw, ih = map(int, inner)
    return (
        ix >= ox + margin
        and iy >= oy + margin
        and ix + iw <= ox + ow - margin
        and iy + ih <= oy + oh - margin
    )


def _bbox_gap(first: list[int], second: list[int]) -> float:
    ax, ay, aw, ah = map(int, first)
    bx, by, bw, bh = map(int, second)
    dx = max(ax - (bx + bw), bx - (ax + aw), 0)
    dy = max(ay - (by + bh), by - (ay + ah), 0)
    return float(math.hypot(dx, dy))


def _base_candidate(
    bucket: str,
    piece_rows: list[dict[str, Any]],
    evidence: dict[str, Any],
    score: tuple[Any, ...],
) -> dict[str, Any]:
    return {
        "candidateType": bucket,
        "pieceIds": [row["piece"]["pieceId"] for row in piece_rows],
        "sourceComponentIds": [row["componentId"] for row in piece_rows],
        "sourceRegionIds": sorted({int(row["regionId"]) for row in piece_rows}),
        "selectionEvidence": evidence,
        "_score": score,
    }


def _discover_candidates(
    contract: dict[str, Any],
    pieces: list[dict[str, Any]],
    component_records: dict[str, dict[str, Any]],
    image_shape: tuple[int, int],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    regions = {int(row["regionId"]): row for row in contract["regions"]}
    largest, pieces_by_component = _largest_component_by_region(pieces, component_records)
    image_area = int(image_shape[0] * image_shape[1])
    min_review_area = max(48, int(image_area * 0.00005))
    meaningful = {
        region_id
        for region_id, row in regions.items()
        if int(row["area"]) >= min_review_area and region_id in largest
    }
    stroke_regions = {region_id for region_id in meaningful if _is_stroke_like(regions[region_id], image_area)}
    fill_regions = meaningful - stroke_regions

    adjacency: dict[tuple[int, int], dict[str, Any]] = {}
    neighbors: dict[int, set[int]] = defaultdict(set)
    for edge in contract["adjacency"]:
        a, b = sorted((int(edge["regionA"]), int(edge["regionB"])))
        adjacency[(a, b)] = edge
        neighbors[a].add(b)
        neighbors[b].add(a)

    discovered: dict[str, list[dict[str, Any]]] = {bucket: [] for bucket in BUCKETS}

    # A: one Frozen Region ID with multiple substantial 4-connected components.
    by_region_components: dict[int, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for component_id, record in component_records.items():
        if int(record["area"]) >= min_review_area:
            by_region_components[int(record["regionId"])].append((component_id, record))
    for region_id, rows in sorted(by_region_components.items()):
        if len(rows) < 2:
            continue
        rows.sort(key=lambda row: (-int(row[1]["area"]), row[0]))
        selected_rows = [
            {"componentId": component_id, "piece": pieces_by_component[component_id], **record}
            for component_id, record in rows[:4]
        ]
        discovered[BUCKETS[0]].append(
            _base_candidate(
                BUCKETS[0],
                selected_rows,
                {
                    "fact": "multiple substantial 4-connected components share one Frozen Region ID",
                    "componentAreas": [int(row["area"]) for row in selected_rows],
                    "semanticInference": None,
                },
                (-sum(int(row["area"]) for row in selected_rows), region_id),
            )
        )

    # Build the actual Fill -> Stroke -> Fill two-hop graph.  This is discovery
    # evidence only and does not alter the Frozen 4-connected adjacency graph.
    two_hop: dict[tuple[int, int], list[int]] = defaultdict(list)
    for stroke_id in sorted(stroke_regions):
        fill_neighbors = sorted(fill_regions & neighbors[stroke_id])
        for a, b in combinations(fill_neighbors, 2):
            two_hop[(a, b)].append(stroke_id)

    # B: near-color split surfaces must still have direct or stroke-mediated
    # spatial evidence. Same color alone never creates a candidate.
    spatial_pairs = set(adjacency) | set(two_hop)
    for a, b in sorted(spatial_pairs):
        if a not in fill_regions or b not in fill_regions:
            continue
        distance = _delta_e(regions[a], regions[b])
        if distance > 12.0:
            continue
        mode = "DIRECT_4_CONNECTED" if (a, b) in adjacency else "TWO_HOP_THROUGH_STROKE"
        discovered[BUCKETS[1]].append(
            _base_candidate(
                BUCKETS[1],
                [largest[a], largest[b]],
                {
                    "fact": "near representative colors plus explicit spatial evidence",
                    "representativeDeltaE00": round(distance, 6),
                    "spatialEvidence": mode,
                    "mediatingStrokeRegionIds": two_hop.get((a, b), []),
                    "semanticInference": None,
                },
                (distance, _bbox_gap(regions[a]["bbox"], regions[b]["bbox"]), a, b),
            )
        )

    # C: a smaller fill whose bbox is strictly inside a larger fill's bbox.
    # This is a host/overlay review prompt, not an automatic containment claim.
    for overlay_id in sorted(meaningful):
        overlay = regions[overlay_id]
        for host_id in sorted(fill_regions):
            if host_id == overlay_id:
                continue
            host = regions[host_id]
            if int(host["area"]) < int(overlay["area"]) * 2:
                continue
            if not _bbox_contains(host["bbox"], overlay["bbox"]):
                continue
            area_ratio = int(overlay["area"]) / int(host["area"])
            if area_ratio > 0.35:
                continue
            discovered[BUCKETS[2]].append(
                _base_candidate(
                    BUCKETS[2],
                    [largest[host_id], largest[overlay_id]],
                    {
                        "fact": "overlay bbox is strictly contained by a larger fill bbox",
                        "hostRegionId": host_id,
                        "overlayRegionId": overlay_id,
                        "overlayToHostAreaRatio": round(area_ratio, 8),
                        "semanticInference": None,
                    },
                    (-int(overlay["area"]), area_ratio, host_id, overlay_id),
                )
            )

    # D: direct fill/fill edges only; stroke edges are kept out of this bucket.
    for (a, b), edge in sorted(adjacency.items()):
        if a not in fill_regions or b not in fill_regions:
            continue
        discovered[BUCKETS[3]].append(
            _base_candidate(
                BUCKETS[3],
                [largest[a], largest[b]],
                {
                    "fact": "two fill-like Frozen Regions share a direct 4-connected boundary",
                    "uniqueSharedEdgeCount": int(edge["uniqueSharedEdgeCount"]),
                    "sharedBoundaryCoverage": float(edge["sharedBoundaryCoverage"]),
                    "semanticInference": None,
                },
                (-int(edge["uniqueSharedEdgeCount"]), a, b),
            )
        )

    # E: Fill A -> stroke-like Region -> Fill B.  Nearby bboxes rank first so a
    # single global outline cannot make distant fills monopolize the pack.
    for (a, b), stroke_ids in sorted(two_hop.items()):
        gap = _bbox_gap(regions[a]["bbox"], regions[b]["bbox"])
        max_dimension = max(image_shape)
        if gap > max_dimension * 0.18:
            continue
        boundary_edges = sum(
            int(adjacency[tuple(sorted((fill_id, stroke_id)))]["uniqueSharedEdgeCount"])
            for stroke_id in stroke_ids
            for fill_id in (a, b)
            if tuple(sorted((fill_id, stroke_id))) in adjacency
        )
        discovered[BUCKETS[4]].append(
            _base_candidate(
                BUCKETS[4],
                [largest[a], largest[b]],
                {
                    "fact": "two fill-like Regions have two-hop adjacency through a stroke-like Region",
                    "mediatingStrokeRegionIds": stroke_ids,
                    "bboxGapPixels": round(gap, 4),
                    "combinedStrokeBoundaryEdges": boundary_edges,
                    "semanticInference": None,
                },
                (gap, -boundary_edges, a, b),
            )
        )

    # F: bounded controls preserve visibility of the legacy-stroke failure mode.
    stroke_edges: list[tuple[dict[str, Any], int, int]] = []
    for (a, b), edge in adjacency.items():
        if (a in stroke_regions) == (b in stroke_regions):
            continue
        stroke_id, fill_id = (a, b) if a in stroke_regions else (b, a)
        stroke_edges.append((edge, stroke_id, fill_id))
    stroke_edges.sort(key=lambda row: (-int(row[0]["uniqueSharedEdgeCount"]), row[1], row[2]))
    for edge, stroke_id, fill_id in stroke_edges:
        discovered[BUCKETS[5]].append(
            _base_candidate(
                BUCKETS[5],
                [largest[fill_id], largest[stroke_id]],
                {
                    "fact": "bounded legacy stroke-vs-fill stress control",
                    "strokeRegionId": stroke_id,
                    "fillRegionId": fill_id,
                    "uniqueSharedEdgeCount": int(edge["uniqueSharedEdgeCount"]),
                    "semanticInference": None,
                },
                (-int(edge["uniqueSharedEdgeCount"]), stroke_id, fill_id),
            )
        )

    selected: list[dict[str, Any]] = []
    selected_keys: set[tuple[str, ...]] = set()
    selected_counts: dict[str, int] = {}
    for bucket in BUCKETS:
        rows = sorted(discovered[bucket], key=lambda row: row["_score"])
        count = 0
        for candidate in rows:
            key = tuple(sorted(candidate["pieceIds"]))
            if key in selected_keys:
                continue
            candidate.pop("_score", None)
            selected.append(candidate)
            selected_keys.add(key)
            count += 1
            if count == BUCKET_LIMITS[bucket]:
                break
        selected_counts[bucket] = count

    for index, candidate in enumerate(selected, start=1):
        candidate["candidateId"] = f"{contract['fixtureId']}-V2-CAND-{index:02d}"
        candidate["reviewAnswers"] = {question: None for question in QUESTIONS_V2}
        candidate["fabricationRole"] = {piece_id: None for piece_id in candidate["pieceIds"]}
        candidate["manualReason"] = None

    total = len(selected)
    largest_bucket = max(selected_counts.values(), default=0)
    audit = {
        "minimumReviewAreaPixels": min_review_area,
        "strokeHeuristic": "review-only: Lab L<=28, RGB channel spread<=30, and (area<=20% image or bbox occupancy<=0.42)",
        "bucketLimits": BUCKET_LIMITS,
        "discoveredCounts": {bucket: len(discovered[bucket]) for bucket in BUCKETS},
        "selectedCounts": selected_counts,
        "selectedTotal": total,
        "largestBucketShare": round(largest_bucket / total, 6) if total else 0.0,
        "strokeStressLimitPass": selected_counts["STROKE_STRESS_CONTROL"] <= 2,
        "selectionBalanceStatus": (
            "PASS"
            if selected_counts["STROKE_STRESS_CONTROL"] <= 2
            and (not total or largest_bucket / total <= 2.0 / 3.0)
            else "FAIL"
        ),
        "candidateDeduplication": "piece-set exact deduplication across buckets",
        "semanticLabelsGenerated": False,
    }
    return selected, audit


def _wrap(draw: ImageDraw.ImageDraw, text: str, width: int) -> list[str]:
    words = text.split()
    rows: list[str] = []
    current = ""
    for word in words:
        proposal = f"{current} {word}".strip()
        if draw.textlength(proposal, font=ImageFont.load_default()) <= width:
            current = proposal
        else:
            if current:
                rows.append(current)
            current = word
    if current:
        rows.append(current)
    return rows


def _candidate_card_v2(
    source: np.ndarray,
    component_map: np.ndarray,
    candidate: dict[str, Any],
    records: dict[str, dict[str, Any]],
    output: Path,
) -> None:
    boxes = [records[component_id]["bbox"] for component_id in candidate["sourceComponentIds"]]
    x0 = max(0, min(row[0] for row in boxes) - 64)
    y0 = max(0, min(row[1] for row in boxes) - 64)
    x1 = min(source.shape[1], max(row[0] + row[2] for row in boxes) + 64)
    y1 = min(source.shape[0], max(row[1] + row[3] for row in boxes) + 64)
    original = Image.fromarray(source[y0:y1, x0:x1, :3], "RGB")
    highlighted = original.convert("RGBA")
    for index, component_id in enumerate(candidate["sourceComponentIds"], start=1):
        record = records[component_id]
        mask = component_map[y0:y1, x0:x1] == record["serial"]
        pixels = np.zeros((highlighted.height, highlighted.width, 4), dtype=np.uint8)
        pixels[mask] = (*_color(index), 130)
        highlighted = Image.alpha_composite(highlighted, Image.fromarray(pixels, "RGBA"))
        draw = ImageDraw.Draw(highlighted)
        bx, by, width, height = record["bbox"]
        draw.rectangle(
            (bx - x0, by - y0, bx + width - x0, by + height - y0),
            outline=(*_color(index), 255),
            width=3,
        )
        draw.text(
            (bx - x0, by - y0),
            f"{chr(64 + index)} {component_id}",
            fill="white",
            stroke_width=2,
            stroke_fill="black",
            font=ImageFont.load_default(),
        )
    info_height = 210
    card = Image.new("RGB", (original.width * 2, original.height + info_height), "white")
    card.paste(original, (0, 0))
    card.paste(highlighted.convert("RGB"), (original.width, 0))
    draw = ImageDraw.Draw(card)
    evidence = json.dumps(candidate["selectionEvidence"], ensure_ascii=True, sort_keys=True)
    lines = [
        f"{candidate['candidateId']}  BUCKET={candidate['candidateType']}",
        "Pieces: " + ", ".join(candidate["pieceIds"]),
        "Review-only evidence: " + evidence,
        "Q1 same piece? YES / NO / AMBIGUOUS / NOT_APPLICABLE",
        "Q2 hidden continuous area? YES / NO / AMBIGUOUS / NOT_APPLICABLE",
        "Q3 stacking? A_ABOVE_B / B_ABOVE_A / AMBIGUOUS / NOT_APPLICABLE",
        "Q4 hidden geometry? REQUIRED / OPTIONAL / NOT_REQUIRED / AMBIGUOUS",
        "Q5 multiple acceptable decompositions? YES / NO",
        "Role per piece: BASE_FILL / OVERLAY_FILL / STROKE_DETAIL / UNKNOWN",
        "MANUAL_REASON: _________________________________________________",
    ]
    y = original.height + 7
    for line in lines:
        for wrapped in _wrap(draw, line, card.width - 16):
            draw.text((8, y), wrapped, fill="black", font=ImageFont.load_default())
            y += 18
    output.parent.mkdir(parents=True, exist_ok=True)
    card.save(output, format="PNG")


def build_review_pack_v2(repository_root: Path, benchmark_root: Path) -> dict[str, Any]:
    b2_root = benchmark_root / "fabrication-decomposition"
    review_root = b2_root / "reports" / "project-real-b2-gt-review-v2"
    review_root.mkdir(parents=True, exist_ok=True)
    index: dict[str, Any] = {
        "status": PACK_STATUS,
        "gtPackV1Status": V1_STATUS,
        "gtState": "PENDING_EXTERNAL_REVIEW",
        "candidateSelection": "BUCKETED_REVIEW_ONLY_V2",
        "questions": QUESTIONS_V2,
        "fabricationRoleOptions": FABRICATION_ROLES,
        "global1180PieceDistribution": "NOT_COMPUTED_NON_RANDOM_NON_EXHAUSTIVE_SAMPLE",
        "cases": [],
    }
    # Mark V1 without changing its 40 cards, review JSON, GT drafts, or null
    # population-distribution template.
    v1_status_path = b2_root / "reports" / "project-real-b2-gt-review" / "GT_PACK_V1_AUDIT_STATUS.json"
    write_json(
        v1_status_path,
        {
            "status": V1_STATUS,
            "candidateCount": 40,
            "groundTruthFreezeEligible": False,
            "populationInferencePermitted": False,
            "reason": "non-random, non-exhaustive audit sample with legacy-stroke selection bias",
            "existingReviewArtifactsModified": False,
        },
    )
    for fixture_id in HIGH_VALUE_CASES:
        result = load_json(b2_root / "outputs" / "v0" / fixture_id / "result.json")
        contract_path = (
            benchmark_root
            / "region-core"
            / "outputs"
            / "frozen"
            / PRIMARY_PROFILE
            / fixture_id
            / "region-core.json"
        )
        contract = load_json(contract_path)
        structural_path = repository_root / contract["artifacts"]["structuralLabelMap"]["path"]
        with np.load(structural_path, allow_pickle=False) as archive:
            structural = np.asarray(archive["labels"], dtype=np.int32)
        source_path = repository_root / contract["artifacts"]["source"]["path"]
        source = np.asarray(Image.open(source_path).convert("RGBA"), dtype=np.uint8)
        component_map, records = _component_map(structural, contract["regions"])
        candidates, audit = _discover_candidates(
            contract, result["pieces"], records, structural.shape
        )
        selected_pairs = {
            tuple(sorted(map(int, candidate["sourceRegionIds"])))
            for candidate in candidates
            if len(candidate["sourceRegionIds"]) == 2
        }
        required_pairs = REQUIRED_REVIEW_PAIRS[fixture_id]
        audit["requiredReviewFocusPairs"] = [list(pair) for pair in sorted(required_pairs)]
        audit["requiredReviewFocusCoverage"] = {
            "covered": [list(pair) for pair in sorted(required_pairs & selected_pairs)],
            "missing": [list(pair) for pair in sorted(required_pairs - selected_pairs)],
            "status": "PASS" if required_pairs <= selected_pairs else "FAIL",
            "semanticLabelsGenerated": False,
        }
        for candidate in candidates:
            card_path = review_root / "cards" / f"{candidate['candidateId']}.png"
            _candidate_card_v2(source, component_map, candidate, records, card_path)
            candidate["reviewCard"] = card_path.relative_to(repository_root).as_posix()

        region_labels = [
            (int(row["regionId"]), f"R{int(row['regionId'])}", row["bbox"], int(row["area"]))
            for row in contract["regions"]
        ]
        component_labels = [
            (record["serial"], key, record["bbox"], record["area"])
            for key, record in records.items()
        ]
        original = Image.fromarray(source[..., :3], "RGB")
        draw = ImageDraw.Draw(original)
        draw.rectangle((0, 0, original.width, 24), fill="black")
        draw.text((8, 7), "A  Original", fill="white", font=ImageFont.load_default())
        pieces_panel = _overlay(
            source,
            component_map,
            [(value, f"FP-{key}", bbox, area) for value, key, bbox, area in component_labels],
            "D  B2-V0 Pieces",
        )
        suggested = _candidate_panel(
            source, component_map, candidates, records, "E  V2 bucketed candidates (review-only)"
        )
        stacking_candidates = [
            row
            for row in candidates
            if row["candidateType"]
            in {
                "CONTAINED_OVERLAY_HOST",
                "DIRECT_FILL_FILL_ADJACENCY",
                "STROKE_MEDIATED_FILL_FILL_ADJACENCY",
            }
        ]
        stacking = _candidate_panel(
            source, component_map, stacking_candidates, records, "F  Containment/stacking review"
        )
        sheet_path = review_root / f"{fixture_id}_REVIEW_V2.png"
        _sheet(
            [
                original,
                _overlay(source, structural, region_labels, "B  Frozen Appearance/Region IDs"),
                _overlay(source, component_map, component_labels, "C  Frozen 4-connected Components"),
                pieces_panel,
                suggested,
                stacking,
            ],
            sheet_path,
        )
        review = {
            "caseId": fixture_id,
            "status": "PENDING_EXTERNAL_REVIEW",
            "source": source_path.relative_to(repository_root).as_posix(),
            "contactSheet": sheet_path.relative_to(repository_root).as_posix(),
            "candidateCount": len(candidates),
            "candidateSelectionAudit": audit,
            "candidates": candidates,
        }
        review_path = review_root / f"{fixture_id}.review-v2.json"
        write_json(review_path, review)
        index["cases"].append(
            {
                "caseId": fixture_id,
                "candidateCount": len(candidates),
                "contactSheet": review["contactSheet"],
                "reviewFile": review_path.relative_to(repository_root).as_posix(),
                "candidateSelectionAudit": audit,
            }
        )

    selection_audit = {
        "status": (
            "PASS"
            if all(
                row["candidateSelectionAudit"]["selectionBalanceStatus"] == "PASS"
                and row["candidateSelectionAudit"]["requiredReviewFocusCoverage"]["status"] == "PASS"
                for row in index["cases"]
            )
            else "FAIL"
        ),
        "semanticLabelsGenerated": False,
        "cases": [
            {
                "caseId": row["caseId"],
                **row["candidateSelectionAudit"],
            }
            for row in index["cases"]
        ],
    }
    index["candidateSelectionAudit"] = {
        "path": (review_root / "CANDIDATE_SELECTION_AUDIT.json")
        .relative_to(repository_root)
        .as_posix(),
        "status": selection_audit["status"],
    }
    write_json(review_root / "CANDIDATE_SELECTION_AUDIT.json", selection_audit)
    write_json(review_root / "PROJECT_REAL_B2_GT_PACK_V2.json", index)
    lines = [
        "# Project-real B2 GT Review Pack V2",
        "",
        f"Status: `{PACK_STATUS}`",
        "",
        f"GT Pack V1 status: `{V1_STATUS}`. Its 40 cards remain an audit sample only.",
        "",
        "V2 is a bucketed, non-random, non-exhaustive review set. It does not support population estimates over the 1180 V0 Pieces. No candidate is Ground Truth or an automatic merge/stacking/completion decision.",
        "",
        "| Fixture | Total | Same region | Same surface color split | Contained overlay | Direct fill/fill | Stroke-mediated | Stroke control | Sheet |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in index["cases"]:
        counts = row["candidateSelectionAudit"]["selectedCounts"]
        lines.append(
            f"| {row['caseId']} | {row['candidateCount']} | {counts[BUCKETS[0]]} | {counts[BUCKETS[1]]} | {counts[BUCKETS[2]]} | {counts[BUCKETS[3]]} | {counts[BUCKETS[4]]} | {counts[BUCKETS[5]]} | [{row['caseId']} V2]({Path(row['contactSheet']).name}) |"
        )
    lines.extend(
        [
            "",
            "## Candidate selection audit",
            "",
            "Each review JSON records discovered counts, selected counts, bucket caps, exact piece-set deduplication, and the bounded stroke-control check. `STROKE_STRESS_CONTROL` is capped at two per Fixture.",
            "",
            "`STROKE_MEDIATED_FILL_FILL_ADJACENCY` means an actual Frozen graph path `Fill A -> stroke-like Region -> Fill B`; it is candidate-discovery evidence only and does not alter Region geometry or create a semantic relationship.",
            "",
            "## Reviewer questions",
            "",
            "1. Same physical Piece? `YES / NO / AMBIGUOUS / NOT_APPLICABLE`",
            "2. Hidden continuous area? `YES / NO / AMBIGUOUS / NOT_APPLICABLE`",
            "3. Stacking? `A_ABOVE_B / B_ABOVE_A / AMBIGUOUS / NOT_APPLICABLE`",
            "4. Hidden geometry needed? `REQUIRED / OPTIONAL / NOT_REQUIRED / AMBIGUOUS`",
            "5. Multiple acceptable decompositions? `YES / NO`",
            "6. Fabrication role per Piece? `BASE_FILL / OVERLAY_FILL / STROKE_DETAIL / UNKNOWN`",
            "",
            "All answers and fabrication roles are null. B2-V1 remains paused.",
        ]
    )
    (review_root / "PROJECT_REAL_B2_GT_PACK_V2.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )
    return index
