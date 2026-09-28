"""Opt-in single-colour work steps and bounded, supported pocket completion.

Work steps are not physical material layers. All decisions below consume real
validated full/visible domains, never a saved score or an approval flag.
"""
from __future__ import annotations

import copy
from dataclasses import asdict
from itertools import combinations
import math

from shapely.geometry import Polygon
from shapely.ops import unary_union

from layered_completion import _digest, _materialize, _positive, validate_layered_plan, rank_layered_plans
from practical_plans import _fragment_risk, _source_identity, recommend_practical_plan, PracticalPlanBudget
from solid_plans import _sources

POLICY = 'monochrome-supported-cover/1'
MAX_POCKET_PROPOSALS = 6


def prepare_saved_baseline(observed, saved_plan):
    """Revalidate and reuse a persisted construction, not its old score or PASS."""
    sources, _ = _sources(observed)
    plan = copy.deepcopy(saved_plan)
    # Wire permits an empty GeometryCollection; the unchanged legacy scorer
    # expects an empty Polygon with a boundary. Both have the exact empty domain.
    for piece in plan['pieces']:
        if piece['hiddenPolygon'].is_empty:
            piece['hiddenPolygon'] = Polygon()
    rank_layered_plans(sources, [plan])
    plan['id'] = 'layered-' + _digest({'pieces': [p['id'] for p in plan['pieces']],
                                     'order': plan['bottomToTop']})[:20]
    plan['proposal'] = {'mode': 'REUSED_PERSISTED_LAYERED_BASELINE', 'splitAxis': 'x'}
    budget = PracticalPlanBudget()
    return {'baseline': {'contract': 'fabrication.layered-result/1', 'plan': plan},
            'legacyFallback': None, 'layeredCandidates': [plan],
            'diagnostics': {'schemaVersion': 'practical-plan-search/1', 'budget': asdict(budget),
                'wallTimeEnforcement': 'SUPERVISING_RUNTIME_REQUIRED',
                'searchDeadlineSeconds': budget.total_seconds-budget.final_validation_reserve_seconds,
                'baselineValidatedBeforeSearch': True, 'sourceIdentity': _source_identity(sources),
                'baselineContract': 'fabrication.layered-result/1', 'baselinePlanId': plan['id'],
                'searchCandidatesAttempted': 0, 'finalIndependentValidation': 'REQUIRED',
                'trials': [{'stage': 'PERSISTED_BASELINE_GEOMETRY_REVALIDATED',
                            'status': 'VALID', 'planId': plan['id']}]}}


def _schedule(plan):
    pieces = {p['id']: p for p in plan['pieces']}
    order = plan['bottomToTop']
    parents, depths = {}, {}
    # Rebuild dependencies from FULL geometry, including hidden-hidden overlap.
    for i, key in enumerate(order):
        parents[key] = {lower for lower in order[:i]
                        if _positive(pieces[lower]['polygon'], pieces[key]['polygon'])}
        depths[key] = 1 + max((depths[p] for p in parents[key]), default=0)
    done, steps = set(), []
    while len(done) != len(order):
        ready = [k for k in order if k not in done and parents[k] <= done]
        if not ready:
            raise ValueError('no legal monochrome step: cyclic or missing dependency')
        color = pieces[ready[0]]['colorSlotId']
        batch = [k for k in ready if pieces[k]['colorSlotId'] == color]
        if any(_positive(pieces[a]['polygon'], pieces[b]['polygon'])
               for a, b in combinations(batch, 2)):
            raise ValueError('complete pieces overlap within a work step')
        steps.append({'step': len(steps)+1, 'colorSlotId': color,
                      'rgb': list(pieces[batch[0]]['rgb']), 'pieceIds': batch,
                      'pieceNumbers': [order.index(k)+1 for k in batch]})
        done.update(batch)
    # Positive-area domains covered by at least k full pieces. A DAG's longest
    # chain need NOT intersect at one location, so do not call it material depth.
    at_least = []
    for key in order:
        full = pieces[key]['polygon']
        old = list(at_least)
        for i in range(len(old), 0, -1):
            overlap = old[i-1].intersection(full)
            if overlap.area <= 0:
                continue
            if i == len(at_least):
                at_least.append(overlap)
            else:
                at_least[i] = at_least[i].union(overlap)
        if at_least:
            at_least[0] = at_least[0].union(full)
        else:
            at_least.append(full)
    return {'policy': POLICY, 'steps': steps, 'monochromeWorkLayerCount': len(steps),
            'actualGeometricOverlapDepth': len(at_least),
            'occlusionDependencyDepth': max(depths.values()), 'pieceDependencyDepth': depths,
            'workStepSplittingAddsMaterial': False,
            'depthDefinition': 'MAX_POSITIVE_AREA_FULL_PIECE_COVERAGE_COUNT'}


def monochrome_schedule(observed, plan):
    validate_layered_plan(observed, plan)
    return _schedule(plan)


def verify_monochrome_schedule(observed, plan, declared):
    actual = monochrome_schedule(observed, plan)
    if actual != declared:
        raise ValueError('monochrome work steps / actual depth differ from full geometry')
    return actual


def _butt_metric(plan):
    records = []
    for a, b in combinations(plan['pieces'], 2):
        if a['colorSlotId'] == b['colorSlotId']:
            continue
        # A visible colour interface is an alignment-sensitive butt join only
        # where BOTH complete pieces end there. A cover boundary is different.
        line = (a['visiblePolygon'].boundary.intersection(b['visiblePolygon'].boundary)
                .intersection(a['polygon'].boundary).intersection(b['polygon'].boundary))
        if line.length > 0:
            records.append({'pieceIds': sorted([a['id'], b['id']]),
                            'lengthCanonical': float(line.length)})
    return {'differentColorButtJoinLengthCanonical': sum(r['lengthCanonical'] for r in records),
            'differentColorButtJoinRecords': records,
            'interpretation': 'EXPERIMENTAL_ALIGNMENT_BURDEN_NOT_HUMAN_QUALITY'}


def cover_metrics(observed, plan):
    validate_layered_plan(observed, plan)
    return {**_butt_metric(plan), **_schedule(plan)}


def verify_cover_record(observed, plan, record):
    measured = cover_metrics(observed, plan)
    if record != measured:
        raise ValueError('persisted fabrication policy differs from independent full-piece geometry')
    return measured


def augment_cover_candidates(observed, prepared):
    """Reuse supplied legal candidates; add at most six local pocket closures.

    An observed neighbour can cover a concave pocket only if over half its
    perimeter already touches the proposed lower piece, completing it SHORTENS
    the lower outline, and added hidden material is no larger than its visible
    support. No hull, buffer, transparency filling, fine bridge, or new base.
    At most one such completion is added to each reused candidate in this pass.
    """
    sources, foreground = _sources(observed)
    result = copy.deepcopy(prepared)
    recommend_practical_plan(sources, result)  # all inputs independently checked
    plans = result['layeredCandidates']
    initial = list(plans)
    trials, attempted = [], 0
    ids = {p['id'] for p in plans}
    for plan in initial:
        for lower, cover in sorted(((a, b) for a in plan['pieces'] for b in plan['pieces']
                                    if a['id'] != b['id']), key=lambda p: (p[0]['id'], p[1]['id'])):
            if attempted >= MAX_POCKET_PROPOSALS:
                break
            full, other = lower['polygon'], cover['visiblePolygon']
            if lower['colorSlotId'] == cover['colorSlotId'] or _positive(full, other):
                continue
            contact = full.boundary.intersection(other.boundary).length
            if contact <= other.length/2:
                continue
            completed = full.union(other)
            if (not isinstance(completed, Polygon) or completed.interiors
                    or not completed.is_valid or completed.length >= full.length
                    or completed.difference(foreground).area > 0
                    or completed.difference(lower['visiblePolygon']).area > lower['visiblePolygon'].area):
                continue
            attempted += 1
            record = {'parentPlanId': plan['id'], 'lowerPieceId': lower['id'],
                      'coverPieceId': cover['id'], 'contactLengthCanonical': float(contact),
                      'coverPerimeterCanonical': float(other.length),
                      'lowerPerimeterBefore': float(full.length),
                      'lowerPerimeterAfter': float(completed.length)}
            groups = []
            for piece in plan['pieces']:
                evidence = copy.deepcopy(piece['completionEvidence'])
                if piece['id'] == lower['id']:
                    evidence.append({'method': 'supported-concave-pocket-cover/1',
                                     'inferredHiddenGeometry': True, **record})
                groups.append({'sources': [s for s in sources if s['componentId'] in piece['sourceComponentIds']],
                               'visible': piece['visiblePolygon'],
                               'full': completed if piece['id'] == lower['id'] else piece['polygon'],
                               'evidence': evidence})
            try:
                new = _materialize(groups, sources, 'x', POLICY)
                rank_layered_plans(sources, [new])
                if len(new['pieces']) != len(plan['pieces']):
                    raise ValueError('pocket closure changes piece count')
                if _schedule(new)['actualGeometricOverlapDepth'] > _schedule(plan)['actualGeometricOverlapDepth']+1:
                    raise ValueError('pocket closure adds excessive material depth')
                if _butt_metric(new)['differentColorButtJoinLengthCanonical'] >= _butt_metric(plan)['differentColorButtJoinLengthCanonical']:
                    raise ValueError('pocket closure does not reduce actual butt-join burden')
            except ValueError as error:
                trials.append({**record, 'status': 'REJECTED', 'reason': str(error)})
                continue
            trials.append({**record, 'status': 'VALID', 'planId': new['id']})
            if new['id'] not in ids:
                plans.append(new)
                ids.add(new['id'])
    result['diagnostics']['coverPriority'] = {'policy': POLICY, 'proposalLimit': MAX_POCKET_PROPOSALS,
                                            'attempted': attempted, 'trials': trials}
    return result


def recommend_cover_plan(observed, prepared):
    """Hard geometry/appearance gates, fragment risk, alignment, then burden."""
    sources, foreground = _sources(observed)
    decision = recommend_practical_plan(sources, prepared)
    # Do not relabel an unconverted legacy contract as layered completion.
    if prepared['baseline']['contract'] != 'fabrication.layered-result/1':
        decision.update(policy=POLICY, reason='LEGACY_CONTRACT_RETAINED_NO_MONOCHROME_COMPLETION_CLAIM')
        return decision
    basis = []
    for item, plan in zip(decision['candidates'], prepared['layeredCandidates']):
        metrics = cover_metrics(sources, plan)
        score = item['actualMetrics']
        key = [_fragment_risk(plan)['riskTier'],
               (item['comparisonVisibleSeamUnionLengthCanonical']+
                metrics['differentColorButtJoinLengthCanonical'])/math.sqrt(foreground.area),
               score['pieceCount'], item['fragmentRisk']['riskPieceCount'],
               metrics['actualGeometricOverlapDepth'], score['hiddenAreaToForegroundRatio'],
               metrics['monochromeWorkLayerCount'], score['vertexCount']]
        basis.append({**item, 'coverMetrics': metrics, 'decisionKey': key})
    selected = min(basis, key=lambda b: (b['decisionKey'], b['planId']))
    decision.update(policy=POLICY, candidates=basis,
                    priority=['exact visible domain/color/source (hard gate)', 'fragment risk tier',
                              'exposed same-color cuts PLUS actual different-color butt joins',
                              'piece count', 'risk count', 'actual material depth', 'hidden area',
                              'monochrome work steps', 'vertex count'],
                    recommendedIndex=selected['candidateIndex'], recommendedPlanId=selected['planId'],
                    reason='VALIDATED_COVER_ALIGNMENT_PRIORITY_NOT_MINIMUM_LAYER_COUNT',
                    newCompletionBenefitClaimed=False)
    return decision
