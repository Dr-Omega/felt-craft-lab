"""Build review-only B2 GT candidates without writing semantic ground truth."""

from __future__ import annotations

from collections import defaultdict, deque
import colorsys
from copy import deepcopy
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from b2_contract import CASE_IDS, PRIMARY_PROFILE, load_json, write_json


HIGH_VALUE_CASES = ("FLD-002", "FLD-003", "FLD-004", "FLD-006", "FLD-008")
QUESTIONS = {
    "samePhysicalPiece": ["YES", "NO", "AMBIGUOUS"],
    "hiddenContinuousArea": ["YES", "NO", "AMBIGUOUS"],
    "stacking": ["A_ABOVE_B", "B_ABOVE_A", "AMBIGUOUS"],
    "hiddenGeometryNeeded": ["REQUIRED", "OPTIONAL", "NOT_REQUIRED", "AMBIGUOUS"],
    "multipleAcceptableDecompositions": ["YES", "NO"],
}


def _component_map(labels: np.ndarray, regions: list[dict[str, Any]]) -> tuple[np.ndarray, dict[str, dict[str, Any]]]:
    result = np.zeros(labels.shape, dtype=np.int32)
    records: dict[str, dict[str, Any]] = {}
    serial = 0
    height, width = labels.shape
    for region in sorted(regions, key=lambda value: int(value["regionId"])):
        region_id = int(region["regionId"])
        seen = np.zeros(labels.shape, dtype=bool)
        derived: list[dict[str, Any]] = []
        for y, x in zip(*np.where(labels == region_id), strict=True):
            if seen[y, x]:
                continue
            queue = deque([(int(y), int(x))]); seen[y, x] = True; pixels: list[tuple[int, int]] = []
            while queue:
                cy, cx = queue.popleft(); pixels.append((cy, cx))
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < height and 0 <= nx < width and labels[ny, nx] == region_id and not seen[ny, nx]:
                        seen[ny, nx] = True; queue.append((ny, nx))
            ys, xs = zip(*pixels, strict=True)
            derived.append({"area": len(pixels), "bbox": [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1], "pixels": pixels})
        frozen = region["components"]
        if [(row["area"], row["bbox"]) for row in derived] != [(row["area"], row["bbox"]) for row in frozen]:
            raise ValueError(f"Region {region_id} component derivation differs from Frozen contract")
        for ordinal, component in enumerate(derived, start=1):
            serial += 1
            component_id = f"R{region_id:05d}-C{ordinal:03d}"
            for y, x in component.pop("pixels"):
                result[y, x] = serial
            records[component_id] = {**component, "serial": serial, "regionId": region_id}
    return result, records


def _color(identifier: int) -> tuple[int, int, int]:
    hue = (identifier * 0.61803398875) % 1.0
    return tuple(int(round(channel * 255)) for channel in colorsys.hsv_to_rgb(hue, 0.68, 0.95))


def _overlay(source: np.ndarray, label_map: np.ndarray, labels: list[tuple[int, str, list[int], int]], title: str) -> Image.Image:
    rgb = source[..., :3].astype(np.float32)
    tint = np.zeros_like(rgb)
    for value in np.unique(label_map[label_map > 0]):
        tint[label_map == value] = _color(int(value))
    active = label_map > 0
    rgb[active] = rgb[active] * 0.42 + tint[active] * 0.58
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    for _, text, bbox, area in sorted(labels, key=lambda row: -row[3])[:32]:
        if area < 16:
            continue
        x, y, width, height = bbox
        position = (x + width // 2, y + height // 2)
        draw.text(position, text, font=font, fill="white", stroke_width=2, stroke_fill="black", anchor="mm")
    draw.rectangle((0, 0, image.width, 24), fill=(0, 0, 0))
    draw.text((8, 7), title, font=font, fill="white")
    return image


def _candidate_records(contract: dict[str, Any], pieces: list[dict[str, Any]], component_records: dict[str, dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    by_region: dict[int, list[dict[str, Any]]] = defaultdict(list)
    pieces_by_component = {piece["sourceComponentIds"][0]: piece for piece in pieces}
    for component_id, record in component_records.items():
        by_region[record["regionId"]].append({"componentId": component_id, **record})
    candidates: list[dict[str, Any]] = []
    for region_id, components in sorted(by_region.items()):
        substantial = sorted(components, key=lambda row: (-row["area"], row["componentId"]))
        if len(substantial) >= 2 and substantial[1]["area"] >= 16:
            selected = substantial[: min(3, len(substantial))]
            candidates.append({
                "candidateType": "SAME_REGION_COMPONENT_GROUP",
                "pieceIds": [pieces_by_component[row["componentId"]]["pieceId"] for row in selected],
                "sourceComponentIds": [row["componentId"] for row in selected],
                "sourceRegionIds": [region_id],
                "selectionEvidence": {"fact": "multiple substantial 4-connected components share one Frozen Region ID", "componentAreas": [row["area"] for row in selected]},
            })
    largest_piece: dict[int, dict[str, Any]] = {}
    for region_id, components in by_region.items():
        chosen = max(components, key=lambda row: (row["area"], row["componentId"]))
        largest_piece[region_id] = pieces_by_component[chosen["componentId"]]
    adjacency = sorted(contract["adjacency"], key=lambda row: (-row["uniqueSharedEdgeCount"], row["regionA"], row["regionB"]))
    for edge in adjacency:
        a, b = int(edge["regionA"]), int(edge["regionB"])
        if a not in largest_piece or b not in largest_piece:
            continue
        candidates.append({
            "candidateType": "ADJACENT_STACKING_REVIEW",
            "pieceIds": [largest_piece[a]["pieceId"], largest_piece[b]["pieceId"]],
            "sourceComponentIds": [largest_piece[a]["sourceComponentIds"][0], largest_piece[b]["sourceComponentIds"][0]],
            "sourceRegionIds": [a, b],
            "selectionEvidence": {"fact": "Frozen Regions share a 4-connected boundary", "uniqueSharedEdgeCount": edge["uniqueSharedEdgeCount"], "sharedBoundaryCoverage": edge["sharedBoundaryCoverage"]},
        })
    selected: list[dict[str, Any]] = []
    seen: set[tuple[str, ...]] = set()
    for candidate in candidates:
        key = tuple(sorted(candidate["pieceIds"]))
        if key in seen:
            continue
        seen.add(key); selected.append(candidate)
        if len(selected) == limit:
            break
    for index, candidate in enumerate(selected, start=1):
        candidate["candidateId"] = f"{contract['fixtureId']}-CAND-{index:02d}"
        candidate["reviewAnswers"] = {question: None for question in QUESTIONS}
        candidate["manualReason"] = None
    return selected


def _candidate_panel(source: np.ndarray, component_map: np.ndarray, candidates: list[dict[str, Any]], records: dict[str, dict[str, Any]], title: str) -> Image.Image:
    image = Image.fromarray(source[..., :3], "RGB").copy()
    draw = ImageDraw.Draw(image, "RGBA"); font = ImageFont.load_default()
    for index, candidate in enumerate(candidates, start=1):
        color = (*_color(index), 190)
        for component_id in candidate["sourceComponentIds"]:
            record = records[component_id]
            mask = component_map == record["serial"]
            ys, xs = np.where(mask)
            if len(xs):
                draw.rectangle((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())), outline=color, width=3)
        bbox_rows = [records[component_id]["bbox"] for component_id in candidate["sourceComponentIds"]]
        x = min(row[0] for row in bbox_rows); y = min(row[1] for row in bbox_rows)
        draw.text((x, y), f"C{index}", font=font, fill="white", stroke_width=2, stroke_fill="black")
    draw.rectangle((0, 0, image.width, 24), fill=(0, 0, 0, 230))
    draw.text((8, 7), title, font=font, fill="white")
    return image


def _candidate_card(source: np.ndarray, component_map: np.ndarray, candidate: dict[str, Any], records: dict[str, dict[str, Any]], output: Path) -> None:
    boxes = [records[component_id]["bbox"] for component_id in candidate["sourceComponentIds"]]
    x0 = max(0, min(row[0] for row in boxes) - 48); y0 = max(0, min(row[1] for row in boxes) - 48)
    x1 = min(source.shape[1], max(row[0] + row[2] for row in boxes) + 48); y1 = min(source.shape[0], max(row[1] + row[3] for row in boxes) + 48)
    original = Image.fromarray(source[y0:y1, x0:x1, :3], "RGB")
    highlighted = original.copy(); draw = ImageDraw.Draw(highlighted, "RGBA")
    for index, component_id in enumerate(candidate["sourceComponentIds"], start=1):
        record = records[component_id]; mask = component_map[y0:y1, x0:x1] == record["serial"]
        overlay = Image.new("RGBA", highlighted.size, (0, 0, 0, 0)); pixels = np.zeros((highlighted.height, highlighted.width, 4), dtype=np.uint8)
        pixels[mask] = (*_color(index), 120); overlay = Image.fromarray(pixels, "RGBA")
        highlighted = Image.alpha_composite(highlighted.convert("RGBA"), overlay).convert("RGB"); draw = ImageDraw.Draw(highlighted, "RGBA")
        bx, by, width, height = record["bbox"]
        draw.rectangle((bx - x0, by - y0, bx + width - x0, by + height - y0), outline=(*_color(index), 255), width=3)
        draw.text((bx - x0, by - y0), component_id, fill="white", stroke_width=2, stroke_fill="black", font=ImageFont.load_default())
    info_height = 112
    card = Image.new("RGB", (original.width * 2, original.height + info_height), "white")
    card.paste(original, (0, 0)); card.paste(highlighted, (original.width, 0)); card_draw = ImageDraw.Draw(card)
    lines = [candidate["candidateId"] + "  " + candidate["candidateType"], "Pieces: " + ", ".join(candidate["pieceIds"]), "MANUAL: same piece? [YES/NO/AMBIGUOUS]  hidden? [YES/NO/AMBIGUOUS]", "stacking? [A_ABOVE_B/B_ABOVE_A/AMBIGUOUS]  completion? [REQUIRED/OPTIONAL/NOT_REQUIRED/AMBIGUOUS]", "multiple acceptable decompositions? [YES/NO]   reason: ____________________"]
    for index, line in enumerate(lines):
        card_draw.text((8, original.height + 8 + index * 20), line, fill="black", font=ImageFont.load_default())
    output.parent.mkdir(parents=True, exist_ok=True); card.save(output, format="PNG")


def _sheet(panels: list[Image.Image], output: Path) -> None:
    width, height = panels[0].size
    sheet = Image.new("RGB", (width * 3, height * 2), "white")
    for index, panel in enumerate(panels):
        sheet.paste(panel, ((index % 3) * width, (index // 3) * height))
    output.parent.mkdir(parents=True, exist_ok=True); sheet.save(output, format="PNG")


def build_review_pack(repository_root: Path, benchmark_root: Path) -> dict[str, Any]:
    b2_root = benchmark_root / "fabrication-decomposition"
    review_root = b2_root / "reports" / "project-real-b2-gt-review"
    review_root.mkdir(parents=True, exist_ok=True)
    index: dict[str, Any] = {"status": "PROJECT_REAL_B2_GT_PACK_READY_FOR_EXTERNAL_REVIEW", "gtState": "PENDING_EXTERNAL_REVIEW", "questions": QUESTIONS, "cases": []}
    for fixture_id in HIGH_VALUE_CASES:
        result = load_json(b2_root / "outputs" / "v0" / fixture_id / "result.json")
        contract_path = benchmark_root / "region-core" / "outputs" / "frozen" / PRIMARY_PROFILE / fixture_id / "region-core.json"
        contract = load_json(contract_path)
        structural_path = repository_root / contract["artifacts"]["structuralLabelMap"]["path"]
        with np.load(structural_path, allow_pickle=False) as archive:
            structural = np.asarray(archive["labels"], dtype=np.int32)
        source_path = repository_root / contract["artifacts"]["source"]["path"]
        source = np.asarray(Image.open(source_path).convert("RGBA"), dtype=np.uint8)
        component_map, records = _component_map(structural, contract["regions"])
        candidates = _candidate_records(contract, result["pieces"], records)
        for candidate in candidates:
            card_path = review_root / "cards" / f"{candidate['candidateId']}.png"
            _candidate_card(source, component_map, candidate, records, card_path)
            candidate["reviewCard"] = card_path.relative_to(repository_root).as_posix()
        region_labels = [(int(row["regionId"]), f"R{int(row['regionId'])}", row["bbox"], int(row["area"])) for row in contract["regions"]]
        component_labels = [(record["serial"], key, record["bbox"], record["area"]) for key, record in records.items()]
        original = Image.fromarray(source[..., :3], "RGB")
        pieces_panel = _overlay(source, component_map, [(value, f"FP-{key}", bbox, area) for value, key, bbox, area in component_labels], "D  B2-V0 Pieces")
        suggested = _candidate_panel(source, component_map, candidates, records, "E  Suggested candidates (review-only)")
        stacking = _candidate_panel(source, component_map, [row for row in candidates if row["candidateType"] == "ADJACENT_STACKING_REVIEW"], records, "F  Occlusion/stacking candidates")
        draw = ImageDraw.Draw(original); draw.rectangle((0, 0, original.width, 24), fill="black"); draw.text((8, 7), "A  Original", fill="white", font=ImageFont.load_default())
        sheet_path = review_root / f"{fixture_id}_REVIEW.png"
        _sheet([original, _overlay(source, structural, region_labels, "B  Frozen Appearance/Region IDs"), _overlay(source, component_map, component_labels, "C  Frozen 4-connected Components"), pieces_panel, suggested, stacking], sheet_path)
        review = {"caseId": fixture_id, "status": "PENDING_EXTERNAL_REVIEW", "source": source_path.relative_to(repository_root).as_posix(), "contactSheet": sheet_path.relative_to(repository_root).as_posix(), "candidateCount": len(candidates), "candidates": candidates}
        write_json(review_root / f"{fixture_id}.review.json", review)
        draft = {"schemaVersion": "1.0.0-review-draft", "caseId": fixture_id, "reviewStatus": "PENDING_EXTERNAL_REVIEW", "physicalPieces": [], "overlapRelations": [], "hiddenCompletion": [], "mustNotMerge": [], "mustNotInferZones": [], "reviewMetadata": {"reviewer": None, "reviewedAt": None, "notes": None}}
        write_json(review_root / f"{fixture_id}.gt-draft.json", draft)
        index["cases"].append({"caseId": fixture_id, "candidateCount": len(candidates), "contactSheet": review["contactSheet"], "reviewFile": (review_root / f"{fixture_id}.review.json").relative_to(repository_root).as_posix(), "gtDraft": (review_root / f"{fixture_id}.gt-draft.json").relative_to(repository_root).as_posix()})
    index["postReviewDistribution"] = {
        "status": "PENDING_EXTERNAL_REVIEW",
        "totalV0PieceCount": 1180,
        "multipleComponentsToOnePhysicalPieceCount": None,
        "multipleComponentsToOnePhysicalPieceRatio": None,
        "hiddenContourReconstructionRequiredCount": None,
        "hiddenContourReconstructionRequiredRatio": None,
        "stackingOnlyNoHiddenCompletionCount": None,
        "ambiguousCount": None,
        "mustNotMergeCount": None,
        "nextV1PrimaryProblem": None,
    }
    write_json(review_root / "PROJECT_REAL_B2_GT_PACK.json", index)
    write_json(review_root / "POST_REVIEW_DISTRIBUTION.json", index["postReviewDistribution"])
    lines = ["# Project-real B2 GT Review Pack", "", "Status: `PROJECT_REAL_B2_GT_PACK_READY_FOR_EXTERNAL_REVIEW`", "", "All candidates are review-only. No candidate is Ground Truth, CONFIRMED, merged, stacked, or completed by this tool.", "", "| Fixture | Candidates | Review sheet | Review JSON | GT draft |", "|---|---:|---|---|---|"]
    for row in index["cases"]:
        lines.append(f"| {row['caseId']} | {row['candidateCount']} | [{row['caseId']} sheet]({Path(row['contactSheet']).name}) | [{row['caseId']} review]({Path(row['reviewFile']).name}) | [{row['caseId']} draft]({Path(row['gtDraft']).name}) |")
    lines.extend(["", "## Reviewer questions", "", "Each candidate has a card under `cards/`.", "", "1. Do the observed components belong to one physical Fabrication Piece? `YES / NO / AMBIGUOUS`", "2. If yes, is there a hidden continuous area between them? `YES / NO / AMBIGUOUS`", "3. If occluded, which piece is above? `A_ABOVE_B / B_ABOVE_A / AMBIGUOUS`", "4. Is hidden geometry required for fabrication? `REQUIRED / OPTIONAL / NOT_REQUIRED / AMBIGUOUS`", "5. Are multiple decompositions equally acceptable? `YES / NO`", "", "Post-review distribution fields remain null in `POST_REVIEW_DISTRIBUTION.json`. Do not start B2-V1 until these answers are reviewed and the distribution is measured."])
    (review_root / "PROJECT_REAL_B2_GT_PACK.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return index
