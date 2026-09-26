"""Single safe public M4–M7 orchestration API; size-independent audit candidates.

The frozen kernels produce observed domains. M7 makes explicit, independently
checked fabrication decisions from those selected vector domains, not pixels.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import importlib.metadata
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import mapping

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))
from m4_runtime import M4RuntimeError, run_runtime, validate_output_root
from m4_checks import candidate_polygons, render_polygons
from layered_sources import parse_layered
from m1_adapter import artifact, build_input, canonical_bytes, run_shared_validation
from relations import assembly_relations, visual_relations, RelationError
from solid_plans import propose_plans, rank_plans, SolidPlanError
from result_wire import build_result, build_assessment
from rerender import verify_and_render

__all__ = ["run_algorithm"]


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path, value):
    path.write_bytes(canonical_bytes(value))


def _png(path, rgba):
    Image.fromarray(rgba).save(path)


def _recipe(m4, quality_settings=None):
    sources = [*sorted(HERE.glob('*.py')), HERE / 'validate_contract.ts', HERE / 'requirements.txt',
               HERE.parent / 'tools/m4_runtime.py', HERE.parent / 'tools/m4_checks.py', HERE.parent / 'tools/component_binding.py']
    recipe = {'recipe': 'm4-m7-conservative-solid-plan/1',
            'effectiveConfiguration': m4['configuration'],
            'implementationLfUtf8Sha256': {str(p.relative_to(HERE.parent)).replace('\\', '/'):
                 hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest() for p in sources},
            'dependencies': {name: importlib.metadata.version(name) for name in
                ('numpy', 'opencv-python-headless', 'Pillow', 'scikit-image', 'shapely', 'scipy')},
            'manualQuality': 'PENDING_MANUAL_REVIEW', 'manufacturing': 'NOT_EVALUATED'}
    if quality_settings is not None:
        recipe['experimentalQuality'] = quality_settings
    return recipe


def _verify_artifacts(output, result_input, portable):
    locations = {}
    for record in result_input['artifacts']:
        identifier = record['id']
        if identifier == 'layered-source':
            path = Path(portable['sourceArtifact']['path'])
        elif identifier in {'algorithm-recipe.json', 'fabrication-geometry.json', 'relation-evidence.json', 'layer-arrays.npz', 'quality-seam-comparison.json'}:
            path = output / identifier
        else:
            path = output / 'm4' / identifier
        measured = artifact(path, identifier, record['mediaType'])
        if measured != record:
            raise ValueError('Persisted artifact bytes differ from result identity: ' + identifier)
        locations[identifier] = str(path.relative_to(output)).replace('\\', '/')
    # Reconstruct source identities from persisted labels and raw boundaries.
    # Hash agreement alone cannot establish Component-to-domain identity.
    expected_input = build_input(output / 'm4', portable)
    for key, value in expected_input.items():
        if key == 'artifacts':
            if any(record not in result_input['artifacts'] for record in value):
                raise ValueError('Persisted M1 artifacts differ from independently rebound source')
        elif value != result_input.get(key):
            raise ValueError('Persisted M1 source binding differs: ' + key)
    _write(output / 'artifact-locations.json', locations)


def _portable_layers(parsed, output):
    """Persist exact parser snapshot and independently address all mask arrays."""
    source_path = output / ("source-snapshot" + (".svg" if parsed["sourceMediaType"] == "image/svg+xml" else ".psd"))
    source_path.write_bytes(parsed["sourceBytes"])
    arrays = {}

    def portable(value, key="root"):
        if isinstance(value, np.ndarray):
            arrays[key] = value
            return {"arrayArtifactId": "layer-arrays.npz", "arrayKey": key,
                    "shape": list(value.shape), "dtype": str(value.dtype),
                    "sha256": hashlib.sha256(value.tobytes(order="C")).hexdigest()}
        if isinstance(value, dict):
            return {k: portable(v, key + "." + k) for k, v in value.items() if k != "sourceBytes"}
        if isinstance(value, list):
            return [portable(v, key + "." + str(i)) for i, v in enumerate(value)]
        return value

    evidence = portable(parsed)
    np.savez_compressed(output / "layer-arrays.npz", **arrays)
    evidence["arrayArtifact"] = artifact(output / "layer-arrays.npz", media_type="application/x-npz")
    _write(output / "layer-evidence.json", evidence)
    evidence["sourceArtifact"] = {"path": str(source_path), "mediaType": parsed["sourceMediaType"],
                                  "sha256": parsed["sourceSha256"]}
    return evidence


def _geometry_document(plan, observed):
    objects = {p["id"]: mapping(p["polygon"]) for p in plan["pieces"]}
    for i, exposure in enumerate(plan["baseExposures"]):
        objects[f"exposure:{i}"] = mapping(exposure["polygon"])
    for group in plan["splitGroups"]:
        objects["source:" + group["id"]] = mapping(group["sourcePolygon"])
        for seam in group["seams"]:
            objects[seam["id"]] = mapping(seam["polyline"])
    return {"schemaVersion": "m4-m7-geometry/1", "objects": objects, "planId": plan["id"],
            "observedBoundaryProvenance": {o["componentId"]: o["boundaryProvenance"] for o in observed},
            "sourceMapping": {p["id"]: p["sourceComponentIds"] for p in plan["pieces"]},
            "numericPolicy": "Selected P0-04C flattening; no M7 boundary repair, snapping, buffering or alternate pixel contour"}


def _draw_diagnostics(output, plan, observed, color_by_id, rendered, relations):
    shape = rendered["rgba"].shape[:2]
    items = [{**p, "rgb": color_by_id[p["colorSlotId"]]} for p in plan["pieces"]]
    _png(output / "base.png", render_polygons([p for p in items if p["role"] == "BASE"], shape, numbered=True))
    by_component = {o["componentId"]: o for o in observed}
    exposures = [{"id": f"exposure:{i}", "polygon": e["polygon"],
                  "rgb": by_component[e["sourceComponentId"]]["rgb"]}
                 for i, e in enumerate(plan["baseExposures"])]
    _png(output / "base-exposures.png", render_polygons(exposures, shape, numbered=True))
    _png(output / "pieces.png", render_polygons(items, shape, numbered=True))
    seams_image = Image.fromarray(rendered["rgba"])
    draw = ImageDraw.Draw(seams_image)
    for group in plan["splitGroups"]:
        for seam in group["seams"]:
            points = list(seam["polyline"].coords)
            draw.line(points, fill=(255, 0, 255, 255), width=1)
            if points:
                draw.text(points[len(points) // 2], seam["id"], fill="black", stroke_width=1, stroke_fill="white")
    seams_image.save(output / "added-seams.png")
    _png(output / "rerender.png", rendered["rgba"])
    _png(output / "observed.png", rendered["observed_rgba"])
    mismatch = np.any(rendered["rgba"] != rendered["observed_rgba"], axis=2)
    difference = np.zeros((*shape, 4), np.uint8)
    difference[mismatch] = [255, 0, 255, 255]
    _png(output / "rerender-difference.png", difference)
    unresolved_ids = {r[key] for r in relations['records']
                      if r['kind'] == 'VISUAL_OCCLUSION_RELATION' and r['status'] in {'UNRESOLVED', 'NOT_EVALUATED'}
                      for key in ('a', 'b')}
    unresolved = Image.fromarray(rendered['observed_rgba'])
    draw = ImageDraw.Draw(unresolved)
    for obj in observed:
        if obj['regionId'] not in unresolved_ids:
            continue
        for ring in [obj['polygon'].exterior, *obj['polygon'].interiors]:
            draw.line(list(ring.coords), fill=(255, 0, 255, 255), width=1)
        point = obj['polygon'].representative_point()
        draw.text((point.x, point.y), obj['componentId'], fill='black', stroke_width=1, stroke_fill='white')
    unresolved.save(output / 'unresolved-regions.png')


def _page(output, summary):
    images = [("Effective input", "m4/input-foreground.png"), ("Purified (manual quality pending)", "m4/purified.png"),
              ("Actual selected vector observed geometry", "observed.png"), ("Base pieces", "base.png"),
              ("Base exposure domains", "base-exposures.png"), ("Final pieces (IDs)", "pieces.png"),
              ("Added seams including Base", "added-seams.png"), ("Independent final-piece render", "rerender.png"),
              ("Rerender difference (magenta)", "rerender-difference.png"),
              ("Purification RGB change intensity (not a quality grade)", "purification-difference.png"),
              ("Original visual hierarchy unresolved: located Region IDs", "unresolved-regions.png")]
    if 'experimentalQuality' in summary:
        images = [("Actual assembled geometry — same 3× Lanczos for every comparison",'appearance-aa.png'),
                  ("Actual physical seams: exposed magenta / covered cyan",'seams-aa.png'),
                  ("Separate Piece references",'references-aa.png'),
                  ("Actual shared curves, one SVG path per edge",'shared-edges.svg')] + images
        if summary.get('experimentalDesign'):
            images = [("A: original effective foreground (immutable)",'m4/original-effective-foreground.png'),
                      ("A: baseline CP-B / RC-A analysis",'m4/baseline-purified.png')] + images
        if summary.get('seamPlacementComparison'):
            for row in summary['seamPlacementComparison']['comparisons']:
                label=row['anonymousLabel']
                images.extend((label+' anonymous '+suffix,label+'-'+suffix+'.png') for suffix in ('appearance','seams','appearance-detail','seams-detail'))
    cards = "".join(f'<figure><figcaption>{html.escape(title)}</figcaption><img src="{filename}" alt="{html.escape(title)}"></figure>' for title, filename in images)
    doc = '<!doctype html><meta charset="utf-8"><title>M4–M7 algorithm v1</title><style>body{font:14px system-ui;margin:24px;background:#eee;color:#222}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}figure{margin:0;background:white;padding:12px}img{width:100%;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0/16px 16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>'
    doc += '<h1>M4–M7 algorithm initial candidate</h1><p>Human visual quality pending. Manufacturing NOT_EVALUATED. Production export NO.</p>'
    doc += '<p>Stable result: <a href="fabrication-result.json">b2.result/1</a>; <a href="fabrication-input.json">b2.input/1</a>; <a href="structural-assessment.json">StructuralAssessment</a>; <a href="relation-evidence.json">located relation and seam evidence</a>.</p>'
    compact = {k: v for k, v in summary.items() if k != 'relations'}
    compact['relationCounts'] = {status: sum(r['status'] == status for r in summary['relations'])
                                 for status in ('RESOLVED', 'NO_RELATION', 'UNRESOLVED', 'NOT_EVALUATED')}
    doc += f'<section class="grid">{cards}</section><h2>Actual choices, uncertainty and comparisons</h2><pre>{html.escape(json.dumps(compact, ensure_ascii=False, indent=2))}</pre>'
    (output / "index.html").write_text(doc, encoding="utf-8", newline="\n")


def run_algorithm(*, image_path: Path, output_root: Path, foreground_source: str,
                  manual_confirmation: str = "PENDING_REVIEW", profile: str = "aggressive",
                  mode: str = "embedded-alpha", mask_path: Path | None = None,
                  whole_image_foreground: bool = False, selected_layer_ids: list[str] | None = None,
                  quality_mode: str = 'baseline', foreground_cleanup: bool = False,
                  seam_strategy: str = 'baseline', design_palette: list[list[int]] | None = None,
                  palette_provenance: str | None = None) -> dict:
    """Run finite supported input → actual Base/Piece candidates, safely.

    All output protection runs here before *any* write (including failure files).
    Caller input evidence is explicit. There is no background guessing or quality
    approval, and no public unguarded low-level writer.
    """
    image_path = Path(image_path).resolve()
    mask_path = Path(mask_path).resolve() if mask_path is not None else None
    output = validate_output_root(Path(output_root), [p for p in (image_path, mask_path) if p is not None])
    if quality_mode not in {'baseline', 'selection', 'contour', 'combined', 'design-colors', 'design-cleanup'} or seam_strategy not in {'baseline', 'compare', 'visual-proxy'}:
        raise ValueError('invalid experimental quality/seam strategy')
    if type(foreground_cleanup) is not bool or (foreground_cleanup and quality_mode == 'baseline'):
        raise ValueError('foreground cleanup requires an explicit experimental design mode')
    if quality_mode != 'baseline' and image_path.suffix.lower() != '.png':
        raise ValueError('experimental design V1 supports explicit PNG foreground; layered baseline remains available')
    experimental = quality_mode != 'baseline' or seam_strategy != 'baseline'
    quality_settings = ({'version':'application-quality/1','mode':quality_mode,
                         'foregroundCleanup':foreground_cleanup,'seamStrategy':seam_strategy,
                         'humanConfirmation':'PENDING_REVIEW'} if experimental else None)
    design_options = {}
    if quality_mode in {'design-colors', 'design-cleanup'}:
        from design_color_regions import validate_request
        quality_settings['designColorRequest'] = validate_request(design_palette, palette_provenance)
        design_options = {'design_palette':design_palette, 'palette_provenance':palette_provenance}
    elif design_palette is not None or palette_provenance is not None:
        raise ValueError('design palette requires the explicit design-colour path')
    if quality_mode == 'design-colors':
        quality_settings['solidConstructionPolicy'] = 'PARENT_INTERSECTION_FOR_FLOATING_CUT_RESIDUE/1'
    if not foreground_source.strip():
        raise ValueError("foreground_source must locate actual caller/development evidence")
    if manual_confirmation not in {"CONFIRMED", "PENDING_REVIEW"}:
        raise ValueError("invalid manual_confirmation")
    parsed = None
    if image_path.suffix.lower() in {".svg", ".psd"}:
        if mask_path is not None or mode != "embedded-alpha":
            raise ValueError("layered source uses explicit layer selection, not external-mask mode")
        parsed = parse_layered(image_path, selected_layer_ids)
    elif image_path.suffix.lower() != ".png":
        raise ValueError("only single-frame PNG and finite SVG/PSD are supported")
    elif selected_layer_ids is not None:
        raise ValueError("flat input cannot claim selected layers")
    started = time.perf_counter()
    phase_started = started
    stage_seconds = {}
    def phase(name):
        nonlocal phase_started
        now = time.perf_counter()
        stage_seconds[name] = now - phase_started
        phase_started = now
    completed = []
    output.mkdir(parents=True, exist_ok=True)
    try:
        portable = None
        runtime_source = image_path
        if parsed is not None:
            portable = _portable_layers(parsed, output)
            if parsed["status"] != "SUPPORTED" or parsed.get("rgba") is None:
                raise ValueError("layered source cannot be processed: " + parsed["status"] + "; " + str(parsed.get("unsupportedFeatures", parsed.get("issues", []))))
            runtime_source = output / "normalized-layer-foreground.png"
            _png(runtime_source, parsed["rgba"])
            completed.append("M5_LAYER_NORMALIZATION")
        # Constant runtime namespace avoids paths/time in vector/candidate IDs;
        # source and algorithm identities independently bind the exact snapshot.
        m4 = run_runtime(image_path=runtime_source, output_root=output / "m4", mode=mode, mask_path=mask_path,
                         foreground_source=foreground_source, manual_confirmation=manual_confirmation,
                         whole_image_foreground=whole_image_foreground, runtime_id="algorithm-v1", profile=profile,
                         **({'quality_mode':quality_mode,'foreground_cleanup':foreground_cleanup} if quality_mode != 'baseline' else {}),
                         **design_options)
        completed.append("M4_RUNTIME")
        phase('M4_AND_INPUT_NORMALIZATION')
        input_object = build_input(output / "m4", portable)
        if portable is not None:
            input_object['artifacts'].append(portable['arrayArtifact'])
        _write(output / 'algorithm-recipe.json', _recipe(m4, quality_settings))
        input_object['artifacts'].append(artifact(output / 'algorithm-recipe.json'))
        input_checked = run_shared_validation(input=input_object)
        if not input_checked["ok"]:
            raise ValueError("real M1 input validator rejected: " + str(input_checked))
        _write(output / "fabrication-input.json", input_object)
        completed.append("M1_INPUT")
        phase('M1_SHARED_AND_DESIGN_REPLAY')
        labels = np.load(output / "m4/structural_label_map.npz")["labels"]
        observed = candidate_polygons(_read(output / "m4/observed-candidates.json"),
                                      _read(output / "m4/boundary-graph.json"),
                                      _read(output / "m4/vector-result.json"),
                                      m4["configuration"]["effectiveVectorConfig"]["bezier"]["validationFlatnessPx"],
                                      point_touch_cycles=quality_mode == 'design-colors')
        slots = {o["id"]: o["colorSlotId"] for o in input_object["observedRegions"]}
        for obj in observed:
            obj["colorSlotId"] = slots[obj["regionId"]]
        visual = visual_relations(observed, labels, parsed)
        completed.append("M6_VISUAL_EVIDENCE")
        phase('M6_OBSERVED_AND_VISUAL')
        plans = rank_plans(observed, propose_plans(
            observed, reject_invalid_options=quality_mode in {'contour', 'combined', 'design-colors', 'design-cleanup'},
            clip_numeric_parts=quality_mode == 'design-colors'))
        phase('M7_PROPOSE_VALIDATE_SCORE')
        quality_comparison = None
        if seam_strategy != 'baseline':
            from quality_seams import rank_quality_plans, compare_quality_plans
            plans, quality_ranking = rank_quality_plans(observed, plans, enabled=seam_strategy == 'visual-proxy')
            quality_comparison, preview_images = compare_quality_plans(observed, plans, labels.shape, scale=3)
            quality_comparison['ranking'] = quality_ranking
            for filename, preview in preview_images.items():
                if Path(filename).name != filename or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-' for c in filename):
                    raise ValueError('invalid internal comparison image name')
                preview.save(output / (filename + '.png'))
        phase('OPTIONAL_SEAM_COMPARISON_AND_IMAGES')
        comparisons, selected = [], None
        geometry_cache = {}
        # Evaluate relation hard constraints for every geometric alternative,
        # before applying the seam/complexity ordering returned by M7.
        for plan in plans:
            entry = {"id": plan["id"], "baseChoices": plan["baseChoices"], "score": plan["score"],
                     "selectionReasons": plan["selectionReasons"]}
            if seam_strategy == 'visual-proxy':
                entry['experimentalQualityRankingKey'] = next(r['qualityRankingKey'] for r in quality_ranking['candidates'] if r['planId'] == plan['id'])
                entry['selectionReasons'] = ['Hard geometry and relation constraints first; declared experimental visible-seam proxy then complexity. Original score remains diagnostic.']
            try:
                # M6 independently validates the actual geometry before using
                # it. Only exact-geometry scalar operations are reused across
                # alternatives; the final persisted rerender validates afresh.
                relations = assembly_relations(observed, plan, visual, geometry_cache=geometry_cache)
                if relations["blockingUnresolved"]:
                    raise RelationError("blocking unknown final relations: " + str(relations["blockingUnresolved"]))
                entry["status"] = "GEOMETRY_AND_RELATIONS_VALID"
                if selected is None:
                    selected = (plan, relations)
            except (SolidPlanError, RelationError) as error:
                entry.update(status="REJECTED", reason=str(error))
            comparisons.append(entry)
        _write(output / "candidate-comparison.json", comparisons)
        if selected is None:
            raise ValueError("no legal Base/solid plan after finite relation review")
        plan, relations = selected
        if quality_comparison is not None:
            quality_comparison['relationReview'] = {e['id']:{k:e[k] for k in ('status','reason') if k in e} for e in comparisons}
            quality_comparison['selectedRelationValidPlanId'] = plan['id']
            _write(output / 'quality-seam-comparison.json', quality_comparison)
            input_object['artifacts'].append(artifact(output / 'quality-seam-comparison.json'))
            _write(output / 'fabrication-input.json', input_object)
        completed.append("M7_PLAN_AND_M6_REVIEW")
        phase('M6_ALL_CANDIDATE_RELATIONS')
        geometry = _geometry_document(plan, observed)
        if quality_mode != 'baseline':
            geometry['numericPolicy'] = 'Experimental design B selected shared edges; unchanged M7 numerical/conservation checks; no post-split boundary movement'
        _write(output / "fabrication-geometry.json", geometry)
        evidence = {"schemaVersion": "algorithm-v1-located-evidence/1", "planId": plan["id"],
                    "visual": visual, "finalRelations": relations, "geometryChecks": plan["geometryChecks"],
                    "seams": [{k: v for k, v in seam.items() if k != "polyline"}
                              for group in plan["splitGroups"] for seam in group["seams"]],
                    "comparisons": comparisons, "rejectedGeometricCandidates": plan.get("rejectedCandidates", [])}
        _write(output / "relation-evidence.json", evidence)
        result = build_result(input_object, plan, relations,
                              artifact(output / "fabrication-geometry.json"), artifact(output / "relation-evidence.json"), observed=observed)
        # Read back actual serialized objects. No original Piece geometry reaches
        # this independent checker, only observed source domains and wire refs.
        _write(output / "fabrication-result.json", result)
        phase('PERSIST_AND_SHARED_RESULT')
        rendered = verify_and_render(_read(output / "fabrication-result.json"),
                                     _read(output / "fabrication-geometry.json"), observed, labels.shape)
        if rendered['renderBackStatus'] != 'PASS' or rendered['mismatchPixelCount'] != 0:
            raise ValueError('Independent final Piece render failed: ' + str(rendered['mismatchPixelCount']))
        _verify_artifacts(output, result['payload']['input'], portable)
        completed.append("INDEPENDENT_PIECE_RERENDER")
        phase('INDEPENDENT_PIECE_AND_DESIGN_REPLAY')
        color_by_id = {c["id"]: c["rgb"] for c in input_object["colorSlots"]}
        _draw_diagnostics(output, plan, observed, color_by_id, rendered, relations)
        if experimental:
            from quality_seams import render_plan_preview
            for filename, options in [('appearance-aa.png', {}), ('seams-aa.png', {'seams':True}),
                                      ('references-aa.png', {'numbered':True})]:
                render_plan_preview(plan, observed, labels.shape, scale=3, **options).save(output / filename)
            from quality_diagnostics import _write_shared_edge_svg
            _write_shared_edge_svg(output/'shared-edges.svg', _read(output/'m4/vector-result.json'), labels.shape)
            _write(output/'quality-display.json', {
                'sampling':{'scale':3,'filter':'LANCZOS','background':'TRANSPARENT_RGBA'},
                'pieceNumberMap':{str(i):p['id'] for i,p in enumerate(sorted(plan['pieces'],key=lambda p:(p['role']!='BASE',p['id'])),1)},
                'geometrySource':'Actual Base exposures and VISIBLE Pieces, exact ColorSlots; no original-image paste',
                'svgSource':'One actual LINE/CUBIC path per shared edge, no refitting for display',
                'visualAcceptance':'PENDING'})
        phase('DIAGNOSTICS_AND_IMAGES')
        checks = {k: v for k, v in rendered.items() if not isinstance(v, np.ndarray)}
        _write(output / "geometry-checks.json", checks)
        assessment = build_assessment(result, artifact(output / "geometry-checks.json"), checks)
        _write(output / "structural-assessment.json", assessment)
        final_validation = run_shared_validation(result=result, assessment=assessment)
        if not final_validation["ok"]:
            raise ValueError("final shared result/assessment rejected: " + str(final_validation))
        _write(output / "shared-validation.json", final_validation)
        phase('FINAL_SHARED_ASSESSMENT')
        original_path = 'm4/original-effective-foreground.png' if quality_mode != 'baseline' else 'm4/input-foreground.png'
        with Image.open(output / original_path) as image:
            original = np.asarray(image.convert("RGBA"))
        with Image.open(output / "m4/purified.png") as image:
            purified = np.asarray(image.convert("RGBA"))
        intensity = np.max(np.abs(original[..., :3].astype(np.int16) - purified[..., :3].astype(np.int16)), axis=2).astype(np.uint8)
        purification_difference = np.zeros_like(original)
        purification_difference[..., :3] = intensity[..., None]
        purification_difference[..., 3] = np.where(original[..., 3] > 0, 255, 0)
        _png(output / 'purification-difference.png', purification_difference)
        summary = {"schemaVersion": "m4-m7-runtime/1", "status": "IMPLEMENTED_CANDIDATE_PENDING_REVIEW",
                   "sourceKind": input_object["source"]["sourceKind"], "assetVersionId": input_object["assetVersionId"],
                   "resultSha256": result["identity"]["sha256"], "m4AlgorithmIdentity": m4["algorithmIdentity"],
                   "selectedPlanId": plan["id"], "candidateComparison": comparisons,
                   "pieceCount": len(plan["pieces"]), "splitGroupCount": len(plan["splitGroups"]),
                   "seamScore": plan["score"], "relations": relations["records"],
                   "completedStages": completed, "rerenderChecks": checks,
                   "originalToPurified": {"changedRgbPixelCount": int(np.count_nonzero(np.any(original[..., :3] != purified[..., :3], axis=2) & (original[..., 3] > 0))),
                                          "alphaUnchanged": bool(np.array_equal(original[..., 3], purified[..., 3]))},
                   "visualQuality": "PENDING_MANUAL_REVIEW", "falseMerge": "NOT_EVALUATED", "falseSplit": "NOT_EVALUATED",
                   "manufacturingAssessment": "NOT_EVALUATED", "productionExportEligible": False}
        if experimental:
            summary['experimentalQuality'] = quality_settings
            summary['experimentalDesign'] = m4.get('experimentalDesign')
            summary['seamPlacementComparison'] = quality_comparison
            summary['qualityAcceptance'] = {'AtoB':'PENDING_MANUAL_REVIEW','BtoC':checks['renderBackStatus']}
        _page(output, summary)
        phase('DIFFERENCE_AND_PAGE')
        _write(output / "execution.json", {"durationSeconds": time.perf_counter() - started,
                                           'stageSecondsNonOverlapping':stage_seconds,
                                           "inputPath": str(image_path), "outputPath": str(output)})
        summary["artifactSha256"] = {str(p.relative_to(output)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
                                     for p in sorted(output.rglob("*")) if p.is_file()}
        # Completion is never published before plots, checks and page exist.
        _write(output / "report.json", summary)
        return summary
    except Exception as error:
        failure = {"status": "FAILED", "errorType": type(error).__name__, "error": str(error),
                   "completedStages": completed, "downstreamStopped": True,
                   "residualFiles": sorted(str(p.relative_to(output)) for p in output.rglob("*") if p.is_file())}
        try:
            _write(output / "failure.json", failure)
        except OSError as write_error:
            raise M4RuntimeError(f"Failure record could not be written; inspect residual output {output}: {write_error}") from error
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--foreground-source", required=True)
    parser.add_argument("--manual-confirmation", choices=["CONFIRMED", "PENDING_REVIEW"], default="PENDING_REVIEW")
    parser.add_argument("--profile", choices=["aggressive", "balanced"], default="aggressive")
    parser.add_argument("--mask", type=Path)
    parser.add_argument("--whole-image-foreground", action="store_true")
    parser.add_argument("--select-layer", action="append")
    parser.add_argument('--quality-mode', choices=['baseline','selection','contour','combined','design-colors','design-cleanup'], default='baseline')
    parser.add_argument('--design-palette', help='Explicit JSON RGB array, e.g. [[0,0,0],[255,200,0]]; omitted means automatic')
    parser.add_argument('--palette-provenance', help='Required source for an explicit reference palette')
    parser.add_argument('--foreground-cleanup', action='store_true', help='Unconfirmed experimental foreground proposal; never overwrites original alpha')
    parser.add_argument('--seam-strategy', choices=['baseline','compare','visual-proxy'], default='baseline')
    args = parser.parse_args()
    report = run_algorithm(image_path=args.input, output_root=args.output, foreground_source=args.foreground_source,
                           manual_confirmation=args.manual_confirmation, profile=args.profile, mask_path=args.mask,
                           mode="external-mask" if args.mask else "embedded-alpha",
                           whole_image_foreground=args.whole_image_foreground, selected_layer_ids=args.select_layer,
                           quality_mode=args.quality_mode, foreground_cleanup=args.foreground_cleanup,
                           design_palette=json.loads(args.design_palette) if args.design_palette is not None else None,
                           palette_provenance=args.palette_provenance,
                           seam_strategy=args.seam_strategy)
    print(json.dumps({"status": report["status"], "resultSha256": report["resultSha256"]}))


if __name__ == "__main__":
    main()
