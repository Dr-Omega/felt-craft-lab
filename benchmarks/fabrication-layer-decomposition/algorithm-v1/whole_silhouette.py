"""Opt-in, hard whole-foreground support rule over already bound vector domains.

No new source colours, contour repair, transparency filling or selection occurs.
The existing layered contract still rejects entirely hidden/source-less pieces;
some colour / disconnected-body / hole partitions are therefore unsupported.
"""
from __future__ import annotations

import copy

from shapely.geometry import mapping
from shapely.ops import unary_union

from layered_completion import _digest, _group, _materialize, _positive, rank_layered_plans, validate_layered_plan
from monochrome_policy import augment_cover_candidates, prepare_saved_baseline, recommend_cover_plan
from practical_plans import search_practical_candidates
from solid_plans import _key, _parts, _sources, _tolerance

RULE = 'whole-silhouette-base/1'


def support_record(observed, plan, requested_color=None):
    """Recompute F and bottom support from actual geometry, not declared roles."""
    validate_layered_plan(observed, plan)
    sources, foreground = _sources(observed)
    palette = {s['colorSlotId'] for s in sources}
    if requested_color is not None and requested_color not in palette:
        raise ValueError('whole base: requested ColorSlot does not exist')
    by_id = {p['id']: p for p in plan['pieces']}
    order = plan['bottomToTop']
    bottom = [by_id[key] for i, key in enumerate(order)
              if not any(_positive(by_id[key]['polygon'], by_id[lower]['polygon']) for lower in order[:i])]
    colors = {p['colorSlotId'] for p in bottom}
    if len(colors) != 1 or (requested_color is not None and colors != {requested_color}):
        raise ValueError('whole base: bottom support is not the selected single ColorSlot')
    support = unary_union([p['polygon'] for p in bottom])
    from layered_contract import _equal
    _equal(support, foreground, _tolerance(foreground), 'whole base support vs independently bound F')
    if sum(p['polygon'].area for p in bottom)-support.area > _tolerance(foreground):
        raise ValueError('whole base: support members overlap')
    # A hole-free connected body is one complete backing, not arbitrarily cut.
    for body in _parts(foreground):
        members = [p for p in bottom if _positive(body, p['polygon'])]
        if not body.interiors and len(members) != 1:
            raise ValueError('whole base: connected hole-free body must have one backing')
    bottom_ids = [p['id'] for p in bottom]
    if order[:len(bottom_ids)] != bottom_ids:
        raise ValueError('whole base: all backing members must precede upper work steps')
    visible = unary_union([p['visiblePolygon'] for p in bottom])
    hidden = unary_union([p['hiddenPolygon'] for p in bottom])
    return {'rule': RULE, 'requestedColorSlotId': requested_color,
            'selectedColorSlotId': next(iter(colors)), 'basePieceIds': bottom_ids,
            'representation': 'SINGLE_BASE' if len(bottom) == 1 else 'BASE_GROUP',
            'targetDerivation': 'UNION_OF_ALL_INDEPENDENTLY_BOUND_SELECTED_SOURCE_DOMAINS',
            'targetDomain': mapping(foreground), 'supportDomain': mapping(support),
            'visibleDomain': mapping(visible), 'inferredHiddenDomain': mapping(hidden),
            'missingAreaCanonical': float(foreground.difference(support).area),
            'extraAreaCanonical': float(support.difference(foreground).area),
            'boundaryHausdorffCanonical': float(support.boundary.hausdorff_distance(foreground.boundary)),
            'hiddenAreaCanonical': float(hidden.area),
            'sourceSemantics': 'VISIBLE_ONLY; OTHER_COLOUR_UNDERLAY_IS_INFERRED_SUPPORT',
            'localHiddenToVisibleLimitApplies': False,
            'exceptionScope': 'BACKING_ONLY_NOT_UPPER_COMPLETION'}


def verify_support_record(observed, plan, record, requested_color=None):
    actual = support_record(observed, plan, requested_color)
    # Normalize tuple/list containers only; no geometric rounding or tolerance.
    import json
    if json.loads(json.dumps(actual)) != json.loads(json.dumps(record)):
        raise ValueError('whole base: persisted support declaration differs from recomputed geometry')
    return actual


def _base_first(plan):
    bases = {p['id'] for p in plan['pieces']
             if any(e['method'] == RULE for e in p['completionEvidence'])}
    order = plan['bottomToTop']
    plan['bottomToTop'] = [k for k in order if k in bases]+[k for k in order if k not in bases]
    plan['id'] = 'layered-'+_digest({'pieces': [p['id'] for p in plan['pieces']], 'order': plan['bottomToTop']})[:20]
    return plan


def _prepare_support_baseline(observed, saved_plan=None, requested_color=None):
    """Bounded existing palette × two existing split axes; hard gate BEFORE rank.

    Keep an already compliant actual backing. Otherwise replace all visible
    occurrences of the chosen colour with support F, and preserve lawful upper
    completion where possible. A second conservative candidate uses the exact
    observed upper domains. No invalid original plan is an allowed fallback.
    """
    sources, foreground = _sources(observed)
    slots = sorted({s['colorSlotId'] for s in sources})
    if requested_color is not None:
        if requested_color not in slots:
            raise ValueError('whole base: requested ColorSlot does not exist')
        slots = [requested_color]
    plans, trials = [], []
    if saved_plan is not None:
        saved = prepare_saved_baseline(sources, saved_plan)['baseline']['plan']
        try:
            record = support_record(sources, saved, requested_color)
        except ValueError as error:
            trials.append({'mode': 'EXISTING_SUPPORT', 'status': 'NOT_COMPLIANT', 'reason': str(error)})
        else:
            saved['wholeSilhouetteBase'] = record
            saved['proposal']['wholeBaseAction'] = 'REUSED_ALREADY_COMPLETE'
            plans.append(saved)
    if not plans:
        for slot in slots:
            members = [s for s in sources if s['colorSlotId'] == slot]
            visible = unary_union([s['polygon'] for s in members])
            base = {'sources': members, 'visible': visible, 'full': foreground,
                    'evidence': [{'method': RULE, 'inferredHiddenGeometry': foreground.difference(visible).area > 0,
                                  'sourceDomainRole': 'OBSERVED_VISIBLE_ONLY'}]}
            upper_modes = [('EXACT_OBSERVED_UPPERS', [_group(s) for s in sources if s['colorSlotId'] != slot])]
            if saved_plan is not None:
                upper = []
                for p in saved_plan['pieces']:
                    if p['colorSlotId'] == slot:
                        continue
                    upper.append({'sources': [s for s in sources if s['componentId'] in p['sourceComponentIds']],
                                  'visible': p['visiblePolygon'], 'full': p['polygon'].difference(visible),
                                  'evidence': copy.deepcopy(p['completionEvidence'])})
                upper_modes.insert(0, ('REUSED_UPPER_COMPLETION_CLIPPED_TO_BASE_VISIBLE', upper))
            for mode, upper in upper_modes:
                for axis in ('x', 'y'):
                    trial = {'colorSlotId': slot, 'axis': axis, 'mode': mode}
                    try:
                        groups = [dict(g, full=part, visible=g['visible'].intersection(part))
                                  for g in [base, *upper] for part in _parts(g['full'])]
                        plan = _base_first(_materialize(groups, sources, axis, RULE))
                        plan['wholeSilhouetteBase'] = support_record(sources, plan, requested_color)
                        rank_layered_plans(sources, [plan])
                        plan['proposal'].update(wholeBaseAction='REPLACED_WITH_COMPLETE_SUPPORT', upperMode=mode)
                    except ValueError as error:
                        trials.append({**trial, 'status': 'REJECTED', 'reason': str(error)})
                        continue
                    trials.append({**trial, 'status': 'VALID', 'planId': plan['id']})
                    if plan['id'] not in {p['id'] for p in plans}:
                        plans.append(plan)
    if not plans:
        import json
        raise ValueError('No legal whole-silhouette backing under the existing solid/visible-source contract: '+json.dumps(trials))
    prepared = prepare_saved_baseline(sources, plans[0])
    prepared['layeredCandidates'] = plans
    prepared['diagnostics']['wholeSilhouetteBase'] = {'rule': RULE, 'trials': trials,
        'paletteCandidateCount': len(slots), 'splitAxes': ['x', 'y'], 'noncompliantFallbackAllowed': False}
    decision = recommend_cover_plan(sources, prepared)
    # Recheck after recommendation (which refreshes score), not a cached PASS.
    for plan in plans:
        verify_support_record(sources, plan, plan['wholeSilhouetteBase'], requested_color)
    decision.update(wholeSilhouetteBaseRule=RULE,
                    baseColorSelection='CALLER_EXISTING_COLORSLOT' if requested_color else 'EXISTING_FINITE_PALETTE_AND_COVER_PRIORITY',
                    reason='HARD_WHOLE_SUPPORT_THEN_EXISTING_MONOCHROME_COVER_RANKING')
    return prepared, decision


def _attach_support(sources, foreground, plan, slot, axis):
    """Replace only bottom-visible material; retain upper occurrences of a colour.

    Whether a same-colour piece belongs upstairs follows real overlap with
    other complete pieces, not colour equality or component/list ordering.
    """
    replace = [p for p in plan['pieces'] if p['colorSlotId'] == slot
               and not any(q['id'] != p['id'] and _positive(q['polygon'], p['visiblePolygon'])
                           for q in plan['pieces'])]
    if not replace:
        raise ValueError('whole base: chosen colour has no lawful bottom-visible source')
    ids = {p['id'] for p in replace}
    visible = unary_union([p['visiblePolygon'] for p in replace])
    base = {'sources': [s for s in sources if s['colorSlotId'] == slot and _positive(s['polygon'], visible)],
            'visible': visible, 'full': foreground,
            'evidence': [{'method': RULE, 'inferredHiddenGeometry': foreground.difference(visible).area > 0,
                          'sourceDomainRole': 'OBSERVED_VISIBLE_ONLY'}]}
    upper = [{'sources': [s for s in sources if s['componentId'] in p['sourceComponentIds']],
              'visible': p['visiblePolygon'], 'full': p['polygon'],
              'evidence': copy.deepcopy(p['completionEvidence'])}
             for p in plan['pieces'] if p['id'] not in ids]
    groups = [dict(g, full=part, visible=g['visible'].intersection(part))
              for g in [base, *upper] for part in _parts(g['full'])]
    lifted = _base_first(_materialize(groups, sources, axis, RULE))
    lifted['proposal'].update(wholeBaseAction='COMPLETE_SUPPORT_WITH_GENERATED_UPPERS',
                             parentCompletionMode=plan['proposal']['mode'], parentPlanId=plan['id'])
    return lifted


def search_whole_candidates(observed, prepared, requested_color=None):
    """Shared three-entry orchestration: legal support fallback → completion → gate.

    The existing six hole/bridge proposals and six pocket proposals are reused.
    No unconstrained plan can enter the final ranking or become the fallback.
    Supplied geometry is independently checked, never a cached PASS.
    """
    sources, foreground = _sources(observed)
    prepared = copy.deepcopy(prepared)
    diagnostics = prepared['diagnostics']['wholeSilhouetteBase']
    diagnostics['orchestrationVersion'] = 'whole-base-completion-integration/1'
    baseline_plans = list(prepared['layeredCandidates'])
    plans = {p['id']: p for p in baseline_plans}
    slots = [requested_color] if requested_color else sorted({s['colorSlotId'] for s in sources})
    try:
        generated = search_practical_candidates(sources, prepared)
    except ValueError as error:
        diagnostics['completionSearch'] = {'status': 'REJECTED', 'reason': str(error),
                                          'fallback': 'VALIDATED_WHOLE_SUPPORT_ONLY'}
    else:
        diagnostics['completionSearch'] = generated['diagnostics']['trials']
        diagnostics['searchCandidatesAttempted'] = generated['diagnostics']['searchCandidatesAttempted']
        for proposal in generated['layeredCandidates']:
            if proposal['id'] in plans:
                continue
            for slot in slots:
                for axis in ('x', 'y'):
                    trial = {'stage': 'COMPLETION_WITH_WHOLE_SUPPORT', 'parentPlanId': proposal['id'],
                             'mode': proposal['proposal']['mode'], 'colorSlotId': slot, 'axis': axis}
                    try:
                        plan = _attach_support(sources, foreground, proposal, slot, axis)
                        plan['wholeSilhouetteBase'] = support_record(sources, plan, requested_color)
                        rank_layered_plans(sources, [plan])
                    except ValueError as error:
                        diagnostics['trials'].append({**trial, 'status': 'REJECTED', 'reason': str(error)})
                    else:
                        diagnostics['trials'].append({**trial, 'status': 'VALID', 'planId': plan['id']})
                        plans.setdefault(plan['id'], plan)
    prepared['layeredCandidates'] = list(plans.values())
    augmented = augment_cover_candidates(sources, prepared)
    diagnostics['pocketSearch'] = augmented['diagnostics']['coverPriority']
    for plan in augmented['layeredCandidates']:
        if plan['id'] in plans:
            continue
        try:
            plan = _base_first(plan)
            plan['wholeSilhouetteBase'] = support_record(sources, plan, requested_color)
            rank_layered_plans(sources, [plan])
        except ValueError as error:
            diagnostics['trials'].append({'stage': 'POCKET_WHOLE_SUPPORT_GATE', 'status': 'REJECTED',
                                          'reason': str(error)})
        else:
            plans.setdefault(plan['id'], plan)
    prepared['layeredCandidates'] = list(plans.values())
    for plan in prepared['layeredCandidates']:
        verify_support_record(sources, plan, plan['wholeSilhouetteBase'], requested_color)
    return prepared


def recommend_whole_plan(observed, prepared, requested_color=None):
    # Supervisor rechecks every actual returned geometry before recommendation,
    # including a worker result, timed-out fallback and caller-supplied checkpoint.
    sources, _ = _sources(observed)
    support_record(sources, prepared['baseline']['plan'], requested_color)
    for plan in prepared['layeredCandidates']:
        verify_support_record(sources, plan, plan['wholeSilhouetteBase'], requested_color)
    decision = recommend_cover_plan(sources, prepared)
    decision.update(wholeSilhouetteBaseRule=RULE, orchestrationVersion='whole-base-completion-integration/1',
                    baseColorSelection='CALLER_EXISTING_COLORSLOT' if requested_color else 'EXISTING_FINITE_PALETTE_AND_COVER_PRIORITY',
                    reason='HARD_WHOLE_SUPPORT_WITH_BOUNDED_COMPLETION_AND_COVER_PRIORITY')
    return decision


def prepare_whole_base(observed, saved_plan=None, requested_color=None):
    """Uninterrupted geometry API; runtime entries use the common supervisor."""
    prepared, _ = _prepare_support_baseline(observed, saved_plan, requested_color)
    prepared = search_whole_candidates(observed, prepared, requested_color)
    return prepared, recommend_whole_plan(observed, prepared, requested_color)
