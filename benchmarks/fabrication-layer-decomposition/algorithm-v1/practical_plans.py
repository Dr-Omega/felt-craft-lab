"""Same-design verified fallback before bounded, opt-in completion proposals.

This is geometry search, not an acceptance result or a new fabrication contract.
The caller still serializes and independently verifies the selected construction.
Operation limits are deterministic. They do not pretend to preempt a GEOS call;
the supervising runtime must enforce its wall-time/final-verification reservation.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import copy
import math
import time
import traceback

from shapely.ops import unary_union

from layered_completion import (
    LayeredPlanError, _digest, _filled_groups, _group, _joined_groups,
    _materialize, _positive, rank_layered_plans, validate_layered_plan,
)
from solid_plans import _key, _sources, propose_plans, validate_plan

# Private child-local progress sink; never an input to validation or identity.
_diagnostic_sink = None


@dataclass(frozen=True)
class PracticalPlanBudget:
    """One fixed budget for all images; no sample-specific extensions."""

    max_search_candidates: int = 6
    total_seconds: int = 600
    final_validation_reserve_seconds: int = 180

    def __post_init__(self):
        if (type(self.max_search_candidates) is not int
                or not 0 <= self.max_search_candidates <= 6):
            raise ValueError('max_search_candidates must be an integer in [0, 6]')
        if (type(self.total_seconds) is not int
                or type(self.final_validation_reserve_seconds) is not int
                or not 0 < self.final_validation_reserve_seconds < self.total_seconds):
            raise ValueError('final validation must have a positive reserved time budget')


class PracticalPlanError(LayeredPlanError):
    def __init__(self, message, diagnostics):
        super().__init__(message)
        self.diagnostics = diagnostics


def _source_identity(sources):
    return _digest([{
        'componentId': s['componentId'], 'regionId': s['regionId'],
        'colorSlotId': s['colorSlotId'], 'rgb': list(s['rgb']),
        'polygon': _key(s['polygon']), 'boundaryProvenance': s['boundaryProvenance'],
    } for s in sources])


def _convert_legacy(sources, legacy):
    # Revalidate the original contract. No caller-provided score or PASS is used.
    validate_plan(sources, legacy)
    groups = []
    for piece in legacy['pieces']:
        matching = [s for s in sources if s['colorSlotId'] == piece['colorSlotId']
                    and _positive(piece['polygon'], s['polygon'])]
        visible = unary_union([s['polygon'] for s in matching]).intersection(piece['polygon'])
        if visible.area <= 0:
            raise LayeredPlanError('legacy conversion contains a wholly hidden piece')
        groups.append({'sources': matching, 'visible': visible, 'full': piece['polygon'],
            'evidence': [{'method': 'LEGACY_BASE_SUPPORT_REUSED',
                          'legacyPlanId': legacy['id'],
                          'inferredHiddenGeometry': piece['polygon'].difference(visible).area > 0}]})
    return _materialize(groups, sources, 'x', 'LEGACY_BASE_SUPPORT_REUSED')


def _attempt(diagnostics, stage, mode, operation, axis=None):
    started = time.perf_counter()
    record = {'stage': stage, 'mode': mode}
    if axis is not None:
        record['splitAxis'] = axis
    if _diagnostic_sink is not None:
        _diagnostic_sink({**record, 'status': 'STARTED'})
    try:
        value = operation()
    except Exception as error:
        stderr = getattr(error, 'stderr', None)
        if isinstance(stderr, bytes):
            stderr = stderr.decode('utf-8', errors='replace')
        record.update(status='REJECTED', exceptionType=type(error).__name__,
                      reason=str(error), traceback=traceback.format_exc(), stderr=stderr)
        diagnostics['trials'].append(record)
        return None
    finally:
        record['durationSeconds'] = time.perf_counter()-started
        if record.get('status') == 'REJECTED' and _diagnostic_sink is not None:
            _diagnostic_sink(record)
    record['status'] = 'VALID'
    if isinstance(value, dict) and 'id' in value:
        record['planId'] = value['id']
    diagnostics['trials'].append(record)
    if _diagnostic_sink is not None:
        _diagnostic_sink(record)
    return value


def prepare_practical_baseline(observed, *, budget=None):
    """Establish a reusable actual same-design baseline, without improvement search.

    ``baseline`` explicitly names its contract. A legal legacy fallback remains
    available when conversion or every new candidate fails. It must be delivered
    using its original contract if no lawful layered conversion exists.
    ``layeredCandidates`` contain freshly recomputed existing metrics, NOT a
    practical policy decision. Selection policy belongs to the unified runtime.
    No verified flag, precomputed plan score, or another design's fallback enters.
    """
    budget = PracticalPlanBudget() if budget is None else budget
    if not isinstance(budget, PracticalPlanBudget):
        raise TypeError('budget must be PracticalPlanBudget')
    diagnostics = {
        'schemaVersion': 'practical-plan-search/1', 'budget': asdict(budget),
        'wallTimeEnforcement': 'SUPERVISING_RUNTIME_REQUIRED',
        'searchDeadlineSeconds': budget.total_seconds-budget.final_validation_reserve_seconds,
        'baselineValidatedBeforeSearch': False, 'trials': [],
        'searchCandidatesAttempted': 0, 'finalIndependentValidation': 'REQUIRED',
    }

    def attempt(stage, mode, operation, axis=None):
        return _attempt(diagnostics, stage, mode, operation, axis)

    try:
        sources, foreground = _sources(observed)
        diagnostics['sourceIdentity'] = _source_identity(sources)
    except Exception as error:
        diagnostics['trials'].append({'stage': 'SOURCE_VALIDATION', 'status': 'REJECTED',
            'exceptionType': type(error).__name__, 'reason': str(error),
            'traceback': traceback.format_exc(), 'stderr': getattr(error, 'stderr', None)})
        raise PracticalPlanError('invalid observed design; no legal fallback', diagnostics) from error

    def old_baseline():
        choices = propose_plans(sources, reject_invalid_options=True, clip_numeric_parts=True)
        if not choices:
            raise LayeredPlanError('legacy search returned no candidate')
        for plan in choices:
            checked = attempt('BASELINE_ACTUAL_VALIDATION', 'LEGACY_SAME_DESIGN',
                              lambda plan=plan: (validate_plan(sources, plan), plan)[1])
            if checked is not None:
                return checked
        raise LayeredPlanError('all proposed legacy baselines failed actual validation')

    legacy = attempt('BASELINE_GENERATE_AND_VALIDATE', 'LEGACY_SAME_DESIGN', old_baseline)
    plans = {}
    baseline = None

    def register(plan):
        # Ranking performs the complete geometry/source/order check and replaces
        # stale caller scores. Final persistent readback remains mandatory later.
        checked = rank_layered_plans(sources, [plan])[0]
        plans.setdefault(checked['id'], checked)
        return checked

    if legacy is not None:
        baseline = {'contract': 'LEGACY_SOLID_PLAN', 'plan': legacy}
        converted = attempt('BASELINE_CONVERT_AND_VALIDATE', 'LEGACY_BASE_SUPPORT_REUSED',
                            lambda: register(_convert_legacy(sources, legacy)))
        if converted is not None:
            baseline = {'contract': 'fabrication.layered-result/1', 'plan': converted}
    else:
        # Numeric split failures in one representation are not proof that the
        # image is unsupported. Try the existing domain-preserving partition.
        for axis in ('x', 'y'):
            candidate = attempt('BASELINE_GENERATE_AND_VALIDATE', 'observed-solid-partition',
                lambda axis=axis: register(_materialize([_group(s) for s in sources],
                    sources, axis, 'observed-solid-partition')), axis)
            if candidate is not None:
                baseline = {'contract': 'fabrication.layered-result/1', 'plan': candidate}
                break
    if baseline is None:
        raise PracticalPlanError('no verified same-design fallback; search not started', diagnostics)

    diagnostics['baselineValidatedBeforeSearch'] = True
    diagnostics['baselineContract'] = baseline['contract']
    diagnostics['baselinePlanId'] = baseline['plan']['id']
    if legacy is not None:
        diagnostics['legacyRejectedCandidates'] = legacy.get('rejectedCandidates', [])
    return {'baseline': baseline, 'legacyFallback': legacy,
            'layeredCandidates': list(plans.values()), 'diagnostics': diagnostics}


def _search_validated(sources, foreground, prepared, budget):
    diagnostics = prepared['diagnostics']
    baseline = prepared['baseline']
    plans = {p['id']: p for p in prepared['layeredCandidates']}

    def attempt(stage, mode, operation, axis=None):
        return _attempt(diagnostics, stage, mode, operation, axis)

    def register(plan):
        checked = rank_layered_plans(sources, [plan])[0]
        plans.setdefault(checked['id'], checked)
        return checked

    filled = None
    modes = ('supported-hole-completion', 'supported-hole-and-bridge-completion',
             'supported-bridge-without-hole-completion')
    for mode in modes:
        if diagnostics['searchCandidatesAttempted'] >= budget.max_search_candidates:
            break

        def make_groups():
            nonlocal filled
            if mode != 'supported-bridge-without-hole-completion' and filled is None:
                filled = _filled_groups(sources, foreground)
            if mode == 'supported-hole-completion':
                return filled, None
            starting = (filled if mode == 'supported-hole-and-bridge-completion'
                        else [_group(s) for s in sources])
            return _joined_groups(starting, foreground)

        grouping = attempt('SEARCH_GROUP_CONSTRUCTION', mode, make_groups)
        for axis in ('x', 'y'):
            if diagnostics['searchCandidatesAttempted'] >= budget.max_search_candidates:
                break
            diagnostics['searchCandidatesAttempted'] += 1
            if grouping is None:
                diagnostics['trials'].append({'stage': 'SEARCH_MATERIALIZE_VALIDATE',
                    'mode': mode, 'splitAxis': axis, 'status': 'SKIPPED',
                    'reason': 'group construction rejected; see preceding diagnostic'})
                continue
            groups, detail = grouping
            attempt('SEARCH_MATERIALIZE_VALIDATE', mode,
                lambda axis=axis: register(_materialize(groups, sources, axis, mode, detail)), axis)

    diagnostics['searchStopReason'] = ('DISABLED_BY_FIXED_BUDGET' if budget.max_search_candidates == 0
        else 'FIXED_CANDIDATE_BUDGET_EXHAUSTED' if budget.max_search_candidates < 6
        else 'FINITE_PROPOSAL_SET_EXHAUSTED')
    diagnostics['uniqueLayeredCandidateCount'] = len(plans)
    diagnostics['fallbackReason'] = ('NO_LAYERED_CONVERSION_OR_CANDIDATE' if not plans
        else 'NO_DISTINCT_VALID_SEARCH_CANDIDATE' if set(plans) == {baseline['plan']['id']}
        else None)
    return {'baseline': baseline, 'legacyFallback': prepared['legacyFallback'],
            'layeredCandidates': list(plans.values()), 'diagnostics': diagnostics}


def search_practical_candidates(observed, prepared):
    """Resume from a checkpoint; revalidate geometry rather than checkpoint PASS.

    The caller may preserve ``prepared`` outside the search worker, then impose
    a wall deadline on that worker while retaining a legal finalization input.
    No wire serialization is implied: the versioned result builder/verifier
    remain responsible for persisted geometry and independent final readback.
    """
    sources, foreground = _sources(observed)
    prepared = copy.deepcopy(prepared)
    diagnostics = prepared['diagnostics']
    if diagnostics.get('sourceIdentity') != _source_identity(sources):
        raise PracticalPlanError('baseline checkpoint belongs to another observed design', diagnostics)
    if diagnostics.get('searchCandidatesAttempted') != 0:
        raise PracticalPlanError('checkpoint already searched; do not silently reset budget', diagnostics)
    budget = PracticalPlanBudget(**diagnostics['budget'])
    validate_practical_fallback(sources, prepared['baseline'])
    if prepared['legacyFallback'] is not None:
        validate_plan(sources, prepared['legacyFallback'])
    # All supplied candidates are checked, not only a declared best one.
    checked = rank_layered_plans(sources, prepared['layeredCandidates']) if prepared['layeredCandidates'] else []
    if (prepared['baseline']['contract'] == 'fabrication.layered-result/1'
            and prepared['baseline']['plan']['id'] not in {p['id'] for p in checked}):
        raise PracticalPlanError('layered fallback omitted from candidate checkpoint', diagnostics)
    prepared['layeredCandidates'] = checked
    return _search_validated(sources, foreground, prepared, budget)


def propose_practical_plans(observed, *, budget=None):
    """Convenient uninterrupted call; use the two stages for supervised search."""
    prepared = prepare_practical_baseline(observed, budget=budget)
    sources, foreground = _sources(observed)
    fixed_budget = PracticalPlanBudget(**prepared['diagnostics']['budget'])
    return _search_validated(sources, foreground, prepared, fixed_budget)


def validate_practical_fallback(observed, baseline):
    """Public reuse boundary; fresh actual-domain verification, never cached PASS."""
    contract = baseline.get('contract')
    if contract == 'fabrication.layered-result/1':
        return validate_layered_plan(observed, baseline['plan'])
    if contract == 'LEGACY_SOLID_PLAN':
        return validate_plan(observed, baseline['plan'])
    raise PracticalPlanError('unknown fallback contract', {'contract': contract})


def _fragment_risk(plan):
    """Measured physical-piece risks, not an instruction to remove small details."""
    micro, strips = [], []
    for piece in plan['pieces']:
        polygon = piece['polygon']
        if polygon.area <= 4:
            micro.append(piece['id'])
        rectangle = polygon.minimum_rotated_rectangle
        points = list(rectangle.exterior.coords)
        lengths = [math.dist(points[i], points[i+1]) for i in range(4)]
        short, long = min(lengths), max(lengths)
        width_proxy = 2*polygon.area/polygon.length
        if short > 0 and long/short >= 8 and width_proxy <= 1.5:
            strips.append(piece['id'])
    total = len(set(micro) | set(strips))
    tier = 0 if total == 0 else 1 if total <= 4 else 2 if total <= 32 else 3
    return {'riskTier': tier, 'microPieceIdsAreaLe4': sorted(micro),
            'longNarrowPieceIds': sorted(strips), 'riskPieceCount': total,
            'microPieceCountAreaLe4': len(micro), 'longNarrowPieceCount': len(strips)}


def recommend_practical_plan(observed, search_result):
    """Explain a recommendation for one fixed design; retain every candidate.

    Across designs, source-detail retention must be evaluated by the caller. Here
    exact source/color/coverage/order validation makes visible design preservation
    a hard gate, not a favorable score that can compensate for missing pattern.
    Risk tiers deliberately avoid trading an appreciable new cut for a handful
    of removed specks. A large measured fragmentation reduction can precede seam
    minimization, so this is not an unconditional zero-seam or minimum-piece rule.
    """
    sources, foreground = _sources(observed)
    result = copy.deepcopy(search_result)
    baseline = result['baseline']
    validate_practical_fallback(sources, baseline)
    candidates = result['layeredCandidates']
    ids = [plan['id'] for plan in candidates]
    if len(ids) != len(set(ids)):
        raise PracticalPlanError('duplicate candidate IDs are ambiguous', {})
    if candidates:
        # Scores and PASS records supplied by callers never bypass actual gates.
        rank_layered_plans(sources, candidates)
    basis = []
    for index, plan in enumerate(candidates):
        risk = _fragment_risk(plan)
        score = plan['score']
        key = [risk['riskTier'], score['normalizedVisibleSeamLength'],
               score['pieceCount'], risk['riskPieceCount'], score['layerDepth'],
               score['hiddenAreaToForegroundRatio'], score['vertexCount']]
        basis.append({'candidateIndex': index, 'planId': plan['id'],
                      'fixedDesignPreservation': 'ACTUAL_VISIBLE_DOMAIN_COLOR_SOURCE_VALIDATED',
                      'fragmentRisk': risk, 'actualMetrics': score, 'decisionKey': key,
                      'isDeclaredBaseline': plan['id'] == baseline['plan']['id']})
    decision = {
        'schemaVersion': 'practical-same-design-decision/1',
        'policy': 'experimental-fragment-tier-then-exposed-cut-then-burden/1',
        'proxyStatus': 'EXPERIMENTAL_NOT_HUMAN_ACCEPTANCE',
        'sourceIdentity': _source_identity(sources),
        'foregroundAreaCanonical': float(foreground.area),
        'riskDefinition': {'countBands': [0, 4, 32], 'microAreaMaximum': 4,
            'longNarrowMinimumRotatedRectangleAspectRatio': 8,
            'longNarrowMaximumWidthProxy2AreaOverPerimeter': 1.5,
            'classificationIsNotDeletionPermission': True,
            'intentionalSmallDetailsMayAlsoBeFlagged': True},
        'priority': ['exact visible design preserved (hard gate)', 'fragment risk tier',
            'actual exposed same-color cut length / sqrt(foreground area)',
            'piece count', 'risk piece count', 'actual overlap layer depth',
            'hidden material ratio', 'vertex count'],
        'candidates': basis, 'candidateCountPreserved': len(candidates),
        'baselineContract': baseline['contract'], 'baselinePlanId': baseline['plan']['id'],
        'recommendedIndex': None, 'recommendedContract': baseline['contract'],
        'recommendedPlanId': baseline['plan']['id'],
        'newCompletionBenefitClaimed': False,
    }
    if baseline['contract'] != 'fabrication.layered-result/1':
        # Conversion was not proven. Do not invent comparable layered metrics for
        # the original contract or silently exchange the validated fallback.
        decision['reason'] = 'RETAIN_VALID_LEGACY_FALLBACK_NO_COMPARABLE_LAYERED_BASELINE'
        return decision
    if baseline['plan']['id'] not in ids:
        raise PracticalPlanError('legal baseline omitted from recommendation candidates', {})
    selected = min(basis, key=lambda item: (item['decisionKey'], item['planId']))
    decision.update(recommendedIndex=selected['candidateIndex'],
                    recommendedContract='fabrication.layered-result/1',
                    recommendedPlanId=selected['planId'],
                    reason=('BASELINE_RETAINED_NO_BETTER_LEXICOGRAPHIC_CANDIDATE'
                            if selected['isDeclaredBaseline'] else
                            'VALID_SAME_DESIGN_CANDIDATE_IMPROVES_RECORDED_PRIORITY'))
    return decision
