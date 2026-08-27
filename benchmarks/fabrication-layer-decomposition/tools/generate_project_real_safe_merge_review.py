"""Build project-real SAFE_MERGE review cards without applying Region Repair."""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "region-core" / "reports"
OUTPUT = REPORTS / "project-real-safe-merge-review"
PROFILES = ("cp-b-balanced_rc-a", "cp-b-aggressive_rc-a")
POLICY_ORDER = ("STRICT", "CONSERVATIVE", "MODERATE")
NEAR_MISS_COUNT = 8
PANEL_SIZE = 300
CARD_WIDTH = PANEL_SIZE * 4

sys.path[:0] = [str(ROOT / "region-core" / "src"), str(ROOT / "candidates" / "color-purification" / "src")]
from color_purification import representative_details  # noqa: E402
from region_core import load_json, write_json  # noqa: E402
from region_repair import _pair_boundary_mask  # noqa: E402


def _all_project_real_edges() -> list[dict]:
    records: list[dict] = []
    for profile in PROFILES:
        evidence = load_json(REPORTS / f"repair-evidence-v2-{profile}.json")
        for fixture, payload in sorted(evidence["cases"].items()):
            if payload["kind"] == "project_real":
                records.extend({"fixture": fixture, "profile": profile, "edge": edge} for edge in payload["edges"])
    return records


def _closest_route(evaluation: dict) -> tuple[str, float]:
    ranked = []
    for route, checks in evaluation["routeChecks"].items():
        ranked.append((sum(bool(value) for value in checks.values()) / len(checks), route))
    score, route = max(ranked, key=lambda item: (item[0], item[1]))
    return route, score


def select_review_candidates(records: list[dict], near_miss_count: int = NEAR_MISS_COUNT) -> list[dict]:
    """Select every policy-level SAFE candidate and high-risk non-SAFE controls."""
    selected: list[dict] = []
    safe_pairs: set[tuple[str, str, int, int]] = set()
    for record in records:
        edge = record["edge"]
        pair_key = (record["fixture"], record["profile"], edge["regionA"], edge["regionB"])
        for policy in POLICY_ORDER:
            evaluation = edge["evaluations"][policy]
            if evaluation["decision"] == "SAFE_MERGE":
                selected.append({**record, "policy": policy, "selectionType": "SAFE_MERGE", "repairRoute": evaluation["triggeredRoutes"][0]})
                safe_pairs.add(pair_key)

    near_misses = []
    for record in records:
        edge = record["edge"]
        pair_key = (record["fixture"], record["profile"], edge["regionA"], edge["regionB"])
        if pair_key in safe_pairs or any(edge["evaluations"][name]["decision"] == "SAFE_MERGE" for name in POLICY_ORDER):
            continue
        evaluation = edge["evaluations"]["MODERATE"]
        if evaluation["decision"] != "UNCERTAIN" or evaluation["vetoes"]:
            continue
        route, route_score = _closest_route(evaluation)
        near_misses.append({**record, "policy": "MODERATE", "selectionType": "NEAR_MISS", "repairRoute": route, "routeScore": route_score})
    near_misses.sort(key=lambda row: (
        -row["routeScore"], row["edge"]["representativeDeltaE"],
        row["edge"]["sourceBoundaryDeltaE"]["p90"], row["edge"]["boundaryPersistence"]["tolerance1px"],
        -row["edge"]["sharedBoundaryCoverage"], row["fixture"], row["profile"],
        row["edge"]["regionA"], row["edge"]["regionB"],
    ))
    return selected + near_misses[:near_miss_count]


def _crop_box(labels: np.ndarray, first: int, second: int, context: int = 96) -> tuple[int, int, int, int]:
    ys, xs = np.where(_pair_boundary_mask(labels, first, second))
    if not len(xs):
        raise ValueError(f"regions {first}/{second} are not adjacent")
    center_x, center_y = int(np.median(xs)), int(np.median(ys))
    return max(0, center_x-context), max(0, center_y-context), min(labels.shape[1], center_x+context), min(labels.shape[0], center_y+context)


def _fit_panel(array: np.ndarray) -> Image.Image:
    image = Image.fromarray(array.astype(np.uint8), "RGBA")
    image.thumbnail((PANEL_SIZE, PANEL_SIZE), Image.Resampling.NEAREST)
    panel = Image.new("RGBA", (PANEL_SIZE, PANEL_SIZE), (238, 238, 238, 255))
    panel.alpha_composite(image, ((PANEL_SIZE-image.width)//2, (PANEL_SIZE-image.height)//2))
    return panel


def _overlay(source: np.ndarray, labels: np.ndarray, first: int, second: int) -> np.ndarray:
    rendered = source.copy()
    active = labels > 0
    rendered[active, :3] = (rendered[active, :3].astype(np.uint16)*45//100).astype(np.uint8)
    mask_a, mask_b = labels == first, labels == second
    rendered[mask_a, :3] = ((source[mask_a, :3].astype(np.uint16)+np.array([255,48,48]))//2).astype(np.uint8)
    rendered[mask_b, :3] = ((source[mask_b, :3].astype(np.uint16)+np.array([48,112,255]))//2).astype(np.uint8)
    boundary = _pair_boundary_mask(labels, first, second)
    rendered[boundary, :3], rendered[boundary, 3] = [255,255,0], 255
    return rendered


def _after_preview(source: np.ndarray, before: np.ndarray, structural: np.ndarray, pixel: np.ndarray, pair: tuple[int, int], config: dict) -> tuple[np.ndarray, list[int]]:
    representative = representative_details(source, np.isin(structural, pair), "RC-A", config)
    result = before.copy()
    result[np.isin(pixel, pair), :3] = np.asarray(representative["representativeRgb"], dtype=np.uint8)
    return result, representative["representativeRgb"]


def _evidence_lines(record: dict, region_a: dict, region_b: dict, merged_rgb: list[int]) -> list[str]:
    edge, evaluation = record["edge"], record["edge"]["evaluations"][record["policy"]]
    return [
        f"fixture={record['fixture']}  profile={record['profile']}  selection={record['selectionType']}",
        f"policy={record['policy']}  route={record['repairRoute']}  regions={edge['regionA']}/{edge['regionB']}",
        f"A RGB={region_a['representativeColorRgb']} Lab={region_a['representativeColorLab']}",
        f"B RGB={region_b['representativeColorRgb']} Lab={region_b['representativeColorLab']}",
        f"hypothetical merged RC-A RGB={merged_rgb}  DeltaE00={edge['representativeDeltaE']:.6f}",
        f"source boundary mean/median/P90={edge['sourceBoundaryDeltaE']}",
        f"persistence exact/1px={edge['boundaryPersistence']}",
        f"coverage={edge['sharedBoundaryCoverage']:.6f}  areaRatio={edge['areaRatio']:.6f}",
        f"vetoes={evaluation['vetoes']}  currentDecision={evaluation['decision']}",
        "MANUAL_DECISION = [ ] CORRECT_MERGE  [ ] WRONG_MERGE  [ ] UNCERTAIN",
        "MANUAL_REASON =",
    ]


def _write_card(record: dict, number: int) -> dict:
    fixture, profile, edge = record["fixture"], record["profile"], record["edge"]
    pair = (int(edge["regionA"]), int(edge["regionB"]))
    case_dir = ROOT / "outputs" / "color-purification" / profile / fixture
    structural = np.load(case_dir / "structural_label_map.npz")["labels"]
    pixel = np.load(case_dir / "pixel_label_map.npz")["labels"]
    with Image.open(ROOT / "fixtures" / "source" / f"{fixture}.png") as image:
        source = np.asarray(image.convert("RGBA"))
    with Image.open(case_dir / "purified.png") as image:
        before = np.asarray(image.convert("RGBA"))
    with gzip.open(case_dir / "regions.json.gz", "rt", encoding="utf-8") as handle:
        regions = {int(row["regionId"]): row for row in json.load(handle)}
    after, merged_rgb = _after_preview(source, before, structural, pixel, pair, load_json(case_dir/"run_config.json")["parameters"])
    x0, y0, x1, y1 = _crop_box(structural, *pair)
    panels = [
        ("A. Original crop", source[y0:y1,x0:x1]),
        ("B. Overlay: A=red B=blue boundary=yellow", _overlay(source, structural, *pair)[y0:y1,x0:x1]),
        ("C. Before Repair", before[y0:y1,x0:x1]),
        ("D. Hypothetical After Merge (preview only)", after[y0:y1,x0:x1]),
    ]
    card = Image.new("RGBA", (CARD_WIDTH, PANEL_SIZE+250), "white")
    draw, font = ImageDraw.Draw(card), ImageFont.load_default()
    for index, (title, array) in enumerate(panels):
        card.alpha_composite(_fit_panel(array), (index*PANEL_SIZE, 24)); draw.text((index*PANEL_SIZE+6, 6), title, fill="black", font=font)
    for line_index, line in enumerate(_evidence_lines(record, regions[pair[0]], regions[pair[1]], merged_rgb)):
        draw.text((12, PANEL_SIZE+12+line_index*20), line, fill="black", font=font)
    stem = f"{number:02d}-{fixture}-{profile}-r{pair[0]}-r{pair[1]}-{record['policy'].lower()}"
    card_path = OUTPUT/"cards"/f"{stem}.png"; card_path.parent.mkdir(parents=True, exist_ok=True); card.convert("RGB").save(card_path)
    evaluation = edge["evaluations"][record["policy"]]
    return {
        "candidateId": stem, "fixture": fixture, "profile": profile, "policy": record["policy"],
        "selectionType": record["selectionType"], "repairRoute": record["repairRoute"],
        "regionA": pair[0], "regionB": pair[1],
        "representativeA": {"rgb": regions[pair[0]]["representativeColorRgb"], "lab": regions[pair[0]]["representativeColorLab"]},
        "representativeB": {"rgb": regions[pair[1]]["representativeColorRgb"], "lab": regions[pair[1]]["representativeColorLab"]},
        "hypotheticalMergedRepresentativeRgb": merged_rgb, "representativeDeltaE00": edge["representativeDeltaE"],
        "sourceBoundaryEvidence": edge["sourceBoundaryDeltaE"], "boundaryPersistence": edge["boundaryPersistence"],
        "sharedBoundaryCoverage": edge["sharedBoundaryCoverage"], "areaRatio": edge["areaRatio"],
        "vetoes": evaluation["vetoes"], "currentDecision": evaluation["decision"],
        "card": f"cards/{card_path.name}", "manualDecision": None, "manualReason": "",
    }


def _write_contact_sheet(cards: list[dict]) -> None:
    thumbs=[]
    for card in cards:
        with Image.open(OUTPUT/card["card"]) as image:
            thumb=image.convert("RGB").resize((600,round(image.height*600/image.width)),Image.Resampling.LANCZOS); thumbs.append(thumb)
    row_height=max(image.height for image in thumbs); sheet=Image.new("RGB",(1200,row_height*((len(thumbs)+1)//2)),"white")
    for index,image in enumerate(thumbs): sheet.paste(image,((index%2)*600,(index//2)*row_height))
    sheet.save(OUTPUT/"PROJECT_REAL_SAFE_MERGE_CONTACT_SHEET.png")


def main() -> int:
    cards=[_write_card(record,index) for index,record in enumerate(select_review_candidates(_all_project_real_edges()),1)]
    safe_count=sum(card["selectionType"]=="SAFE_MERGE" for card in cards); near_count=len(cards)-safe_count
    document={"status":"PENDING_EXTERNAL_GATE_2_REVIEW_V2","repairApply":"NOT_EXECUTED","syntheticCandidatesIncluded":False,"manualDecisionValues":["CORRECT_MERGE","WRONG_MERGE","UNCERTAIN"],"candidateCount":len(cards),"safeMergeCount":safe_count,"nearMissCount":near_count,"candidates":cards}
    write_json(OUTPUT/"PROJECT_REAL_SAFE_MERGE_REVIEW.json",document)
    lines=["# Project-real SAFE_MERGE Manual Review","","Gate 2 V2 remains `PENDING_EXTERNAL_GATE_2_REVIEW_V2`. Repair Apply remains `NOT_EXECUTED`.","","This packet contains project-real evidence only. Hypothetical merge panels are disposable previews and do not modify B1 or Region Core artifacts.","",f"- SAFE_MERGE candidates: `{safe_count}`",f"- High-risk near misses: `{near_count}`","- Contact sheet: [PROJECT_REAL_SAFE_MERGE_CONTACT_SHEET.png](PROJECT_REAL_SAFE_MERGE_CONTACT_SHEET.png)",""]
    for card in cards:
        lines += [f"## {card['candidateId']}","",f"![{card['candidateId']}]({card['card']})","",f"- Selection: `{card['selectionType']}`; policy: `{card['policy']}`; route: `{card['repairRoute']}`",f"- Regions: `{card['regionA']}` / `{card['regionB']}`; decision: `{card['currentDecision']}`; vetoes: `{card['vetoes']}`",f"- ΔE00: `{card['representativeDeltaE00']:.6f}`; boundary: `{card['sourceBoundaryEvidence']}`",f"- Persistence: `{card['boundaryPersistence']}`; coverage: `{card['sharedBoundaryCoverage']:.6f}`; area ratio: `{card['areaRatio']:.6f}`","- MANUAL_DECISION: `[ ] CORRECT_MERGE  [ ] WRONG_MERGE  [ ] UNCERTAIN`","- MANUAL_REASON:",""]
    (OUTPUT/"PROJECT_REAL_SAFE_MERGE_REVIEW.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    _write_contact_sheet(cards)
    print(json.dumps({"status":document["status"],"safeMergeCount":safe_count,"nearMissCount":near_count,"candidateCount":len(cards)},indent=2)); return 0


if __name__ == "__main__": raise SystemExit(main())
