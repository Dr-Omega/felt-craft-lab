"""Private continuation of the guarded M4–M7 entry for the opt-in contract.

No second public writer: algorithm_runtime.run_algorithm owns normalization,
output isolation, upstream processing and failure records.
"""
import hashlib
import html
import json
import time

import numpy as np
from PIL import Image

from m1_adapter import canonical_bytes, artifact
from m4_checks import candidate_polygons
from layered_completion import propose_layered_plans, rank_layered_plans
from layered_contract import build_layered_result, verify_layered_result, run_shared_layered_validation
from layered_display import assembly_images, exploded_svg, projected_image, reference_overlays


def _read(path):
    return json.loads(path.read_text('utf-8'))


def _write(path, value):
    path.write_bytes(canonical_bytes(value))


def _finish_layered(*, output, input_object, observed, m4, labels, portable,
                    quality_settings, started, stage_seconds, phase, completed,
                    image_path, verify_artifacts, practical_prepared=None,
                    practical_recommendation=None):
    if practical_prepared is None:
        plans = rank_layered_plans(observed, propose_layered_plans(observed))
        selected_index = 0
    else:
        plans = practical_prepared['layeredCandidates']
        selected_index = practical_recommendation['recommendedIndex']
    if not plans:
        raise ValueError('no legally completed layered fabrication candidate')
    plan = plans[selected_index]
    phase('LAYERED_M7_PROPOSE_VALIDATE_SCORE')
    comparison = [{'id': p['id'], 'score': p['score'], 'status':'GEOMETRY_AND_ORDER_VALID',
                   'geometryChecks':p['geometryChecks'], 'proposal':p['proposal'],
                   'rankingKey':p['rankingKey']} for p in plans]
    _write(output/'candidate-comparison.json', comparison)
    _write(output/'completion-proposal-search.json',plan.get('proposalSearch',[]))
    fabrication_policy = quality_settings.get('fabricationPolicy') if quality_settings else None
    policy_record = None
    if fabrication_policy is not None:
        from monochrome_policy import POLICY, cover_metrics
        if fabrication_policy != POLICY:
            raise ValueError('unknown fabrication policy')
        policy_record = cover_metrics(observed, plan)
        _write(output/'monochrome-policy.json', policy_record)
        input_object['artifacts'].append(artifact(output/'monochrome-policy.json'))
    result = build_layered_result(input_object, plan, observed)
    shared = run_shared_layered_validation(result)
    if not shared['ok']:
        raise ValueError('versioned layered shared contract rejected: ' + str(shared))
    _write(output/'fabrication-result.json', result)
    _write(output/'shared-validation.json', shared)
    completed.append('M7_VERSIONED_LAYERED_RESULT')
    phase('LAYERED_WIRE_AND_SHARED_CHECK')

    # Reopen actual source artifacts and rebind Component domains. No generated
    # observed list or generator PASS reaches the independent result verifier.
    persisted = _read(output/'fabrication-result.json')
    persisted_input = persisted['payload']['input']
    verify_artifacts(output, persisted_input, portable)
    reread_report = _read(output/'m4/report.json')
    bound_recipe = _read(output/'algorithm-recipe.json')
    if bound_recipe['effectiveConfiguration'] != reread_report['configuration']:
        raise ValueError('persisted runtime configuration differs from hash-bound recipe')
    if bound_recipe['experimentalQuality'] != quality_settings:
        raise ValueError('persisted quality strategy differs from hash-bound recipe')
    with np.load(output/'m4/structural_label_map.npz') as arrays:
        reread_labels = arrays['labels'].copy()
    fresh = candidate_polygons(_read(output/'m4/observed-candidates.json'),
        _read(output/'m4/boundary-graph.json'), _read(output/'m4/vector-result.json'),
        bound_recipe['effectiveConfiguration']['effectiveVectorConfig']['bezier']['validationFlatnessPx'],
        point_touch_cycles=bound_recipe['experimentalQuality']['mode'] in {'design-colors','layered-selection','practical-auto'})
    slots = {record['id']:record['colorSlotId'] for record in persisted_input['observedRegions']}
    for item in fresh:
        item['colorSlotId'] = slots[item['regionId']]
    verification = verify_layered_result(persisted, fresh, reread_labels.shape)
    if verification['mismatchPixelCount'] != 0:
        raise ValueError('persisted full-piece assembly differs from selected design')
    checks = {key:value for key,value in verification.items() if key != 'plan' and not isinstance(value,np.ndarray)}
    _write(output/'geometry-checks.json',checks)
    Image.fromarray(verification['rgba']).save(output/'rerender.png')
    Image.fromarray(verification['expectedRgba']).save(output/'observed.png')
    completed.append('INDEPENDENT_PERSISTED_FULL_PIECE_ASSEMBLY')
    phase('INDEPENDENT_LAYERED_PIECE_AND_DESIGN_REPLAY')

    display_plan = verification['plan']
    if fabrication_policy is not None:
        from monochrome_policy import verify_cover_record
        reread_policy = _read(output/'monochrome-policy.json')
        verify_cover_record(fresh, display_plan, reread_policy)
    if verification['metrics'] != plan['score']:
        raise ValueError('independently recomputed layered metrics differ from generation')
    palette = {item['id']:item['rgb'] for item in persisted_input['colorSlots']}
    # These images are generated from the same full geometries/order checked
    # above. Source-photo overlays and invisible geometry omissions are absent.
    images, levels = assembly_images(display_plan,palette,reread_labels.shape)
    if fabrication_policy is not None:
        from layered_display import monochrome_images
        images = monochrome_images(display_plan,palette,reread_labels.shape,reread_policy)
    for name, image in images.items():
        image.save(output/name)
    (output/'complete-pieces.svg').write_text(exploded_svg(display_plan,palette),encoding='utf-8')
    projected_image(display_plan,palette,reread_labels.shape,hidden=True).save(output/'hidden-domains.png')
    projected_image(display_plan,palette,reread_labels.shape).save(output/'visible-domains.png')
    seams, numbered, number_map = reference_overlays(display_plan, verification['rgba'])
    seams.save(output/'physical-seams.png')
    numbered.save(output/'piece-references.png')
    _write(output/'assembly-display.json',{'pieceDepth':levels,'bottomToTop':display_plan['bottomToTop'],
        'pieceNumberMap':number_map, 'cutSeamLegend':{'MAGENTA':'EXPOSED_SAME_COLOR_CUT','CYAN':'COVERED_SAME_COLOR_CUT'},
        'geometrySource':'CHECKED_FULL_PIECE_GEOMETRY','hiddenLegend':'MAGENTA_INFERRED_FABRICATION_NOT_SOURCE',
        'images':list(images), 'userVisualAcceptance':'PENDING',
        **({'monochromeFabrication':reread_policy} if fabrication_policy is not None else {})})
    phase('LAYERED_ACTUAL_GEOMETRY_DIAGNOSTICS')
    summary = {'schemaVersion':'m4-m7-layered-runtime/1',
        'status':'IMPLEMENTED_CANDIDATE_PENDING_REVIEW',
        'contract':'fabrication.layered-result/1', 'legacyB2ResultPassClaimed':False,
        'resultSha256':persisted['identity']['sha256'], 'selectedPlanId':plan['id'],
        'pieceCount':len(plan['pieces']), 'candidateComparison':comparison,
        'seamScore':plan['score'], 'layeredMetrics':plan['score'],
        'completedStages':completed,'rerenderChecks':checks,
        'm4AlgorithmIdentity':m4['algorithmIdentity'],
        'experimentalQuality':quality_settings,'experimentalDesign':m4.get('experimentalDesign'),
        'qualityAcceptance':{'AtoB':'PENDING_MANUAL_REVIEW','BtoC':'PASS'},
        'visualQuality':'PENDING_MANUAL_REVIEW','manufacturingAssessment':'NOT_EVALUATED',
        'productionExportEligible':False}
    if practical_recommendation is not None:
        summary['practicalAutomaticSelection'] = practical_recommendation
        summary['boundedSearch'] = practical_prepared['diagnostics']
    if fabrication_policy is not None:
        summary['monochromeFabrication'] = reread_policy
    cards = [('Actual selected design','observed.png'),('Actual completed assembly','rerender.png'),
             ('Full pieces, magenta = hidden inferred material','complete-pieces.svg'),
             ('Union of hidden domains (not missing pixels)','hidden-domains.png'),
             ('Actual physical cuts, not ordinary pattern boundaries','physical-seams.png'),
             ('Piece numbers refer to actual visible sources','piece-references.png')]
    cards.extend((name.removesuffix('.png'),name) for name in images)
    page = '<!doctype html><meta charset="utf-8"><title>Layered completion candidate</title>'
    page += '<style>body{font:15px system-ui;background:#eee;padding:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{background:white;padding:8px;margin:0}img{width:100%;background:repeating-conic-gradient(#ddd 0 25%,white 0 50%) 0/16px 16px}pre{white-space:pre-wrap}</style>'
    page += '<h1>Actual full-piece layered construction — review candidate</h1><p>A→B visual review pending. B→C exact assembly is not manufacturing approval.</p><div class="grid">'
    page += ''.join(f'<figure><figcaption>{html.escape(title)}</figcaption><img src="{name}"></figure>' for title,name in cards)
    page += '</div><pre>' + html.escape(json.dumps(summary,ensure_ascii=False,indent=2)) + '</pre>'
    (output/'index.html').write_text(page,encoding='utf-8')
    phase('LAYERED_PAGE')
    _write(output/'execution.json',{'durationSeconds':time.perf_counter()-started,
        'stageSecondsNonOverlapping':stage_seconds,'inputPath':str(image_path),'outputPath':str(output)})
    summary['artifactSha256']={str(path.relative_to(output)).replace('\\','/'):hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(output.rglob('*')) if path.is_file()}
    _write(output/'report.json',summary)
    return summary
