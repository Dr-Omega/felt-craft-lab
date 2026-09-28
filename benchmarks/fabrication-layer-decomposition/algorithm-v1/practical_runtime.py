"""Private budgeted continuation of the existing guarded public runtime.

No API accepts a caller's PASS. Search is disposable; its same-design validated
baseline stays in the parent and is persisted before the worker starts.
"""
from __future__ import annotations

import multiprocessing
import os
from pathlib import Path
import time
import traceback

from shapely.geometry import mapping
from shapely.geometry.base import BaseGeometry

from m1_adapter import canonical_bytes
from practical_plans import (PracticalPlanError, prepare_practical_baseline,
                             recommend_practical_plan, search_practical_candidates)


def _portable(value):
    if isinstance(value, BaseGeometry):
        return {'geometryType': 'GEOJSON', 'value': mapping(value)}
    if isinstance(value, dict):
        return {key: _portable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_portable(item) for item in value]
    return value


def _search_worker(channel, observed, baseline, stderr_path, fabrication_policy=None, base_color_slot=None):
    # Redirection belongs only to our disposable child, never a user's process.
    with open(stderr_path, 'a', encoding='utf-8') as errors:
        os.dup2(errors.fileno(), 2)
        import practical_plans
        progress = Path(stderr_path).with_name('practical-search-events.jsonl')
        def save_event(record):
            with progress.open('ab') as stream:
                stream.write(canonical_bytes(record))
                stream.flush()
        practical_plans._diagnostic_sink = save_event
        try:
            if fabrication_policy == 'whole-silhouette-base/1':
                from whole_silhouette import search_whole_candidates
                result = search_whole_candidates(observed, baseline, base_color_slot)
            else:
                result = search_practical_candidates(observed, baseline)
            if fabrication_policy is not None and fabrication_policy != 'whole-silhouette-base/1':
                from monochrome_policy import augment_cover_candidates
                result = augment_cover_candidates(observed, result)
            channel.send({'status': 'RETURNED', 'value': result})
        except BaseException as error:
            trace = traceback.format_exc()
            errors.write(trace)
            errors.flush()
            channel.send({'status': 'FAILED', 'errorType': type(error).__name__,
                          'error': str(error), 'traceback': trace,
                          'diagnostics': getattr(error, 'diagnostics', None)})
        finally:
            channel.close()


def _prepare_and_search(observed, output, started, fabrication_policy=None, saved_plan=None, base_color_slot=None):
    recommend = recommend_practical_plan
    if fabrication_policy is not None:
        from monochrome_policy import POLICY, recommend_cover_plan
        if fabrication_policy not in {POLICY, 'whole-silhouette-base/1'}:
            raise ValueError('unknown fabrication policy')
        recommend = recommend_cover_plan
        if fabrication_policy == 'whole-silhouette-base/1':
            from whole_silhouette import recommend_whole_plan
            recommend = lambda observed, prepared: recommend_whole_plan(observed, prepared, base_color_slot)
    try:
        if fabrication_policy == 'whole-silhouette-base/1':
            from whole_silhouette import _prepare_support_baseline
            baseline, _ = _prepare_support_baseline(observed, saved_plan, base_color_slot)
        elif saved_plan is None:
            baseline = prepare_practical_baseline(observed)
        else:
            if fabrication_policy is None:
                raise ValueError('saved continuation requires explicit fabrication policy')
            from monochrome_policy import prepare_saved_baseline
            baseline = prepare_saved_baseline(observed, saved_plan)
    except ValueError as error:
        (output/'practical-search.json').write_bytes(canonical_bytes(getattr(error, 'diagnostics',
            {'status': 'NO_LEGAL_BASELINE', 'reason': str(error), 'traceback': traceback.format_exc()})))
        raise
    # Full real baseline geometries and source declarations, not merely its ID.
    (output/'practical-baseline.json').write_bytes(canonical_bytes(_portable(baseline)))
    deadline = started + baseline['diagnostics']['searchDeadlineSeconds']
    remaining = deadline-time.perf_counter()
    selected = baseline
    attempt = {'remainingSearchSeconds': max(0.0, remaining),
               'deadlineBasis': 'WHOLE_RUN_START_PLUS_420_SECONDS',
               'finalValidationReserveSeconds': 180}
    if remaining <= 0:
        attempt['status'] = 'SKIPPED_NO_SEARCH_BUDGET_BASELINE_RETAINED'
    else:
        parent = child = worker = None
        worker_started = False
        child_closed = False
        try:
            context = multiprocessing.get_context('spawn')
            parent, child = context.Pipe(duplex=False)
            worker = context.Process(target=_search_worker,
                args=(child, observed, baseline, str(output/'practical-search.stderr.log'), fabrication_policy, base_color_slot))
            worker.start()
            worker_started = True
            child.close()
            child_closed = True
            if parent.poll(max(0.0, deadline-time.perf_counter())):
                try:
                    answer = parent.recv()
                except EOFError:
                    answer = {'status': 'FAILED', 'errorType': 'WorkerClosedWithoutResult',
                              'error': 'search worker closed its pipe; inspect persisted stderr'}
                attempt.update({k: v for k, v in answer.items() if k != 'value'})
                if answer['status'] == 'RETURNED':
                    selected = answer['value']
            else:
                attempt['status'] = 'SEARCH_TIMEOUT_BASELINE_RETAINED'
        except Exception as error:
            selected = baseline
            attempt.update(status='SEARCH_FAILURE_BASELINE_RETAINED',
                           errorType=type(error).__name__, error=str(error),
                           traceback=traceback.format_exc())
        finally:
            if child is not None and not child_closed:
                child.close()
            if parent is not None:
                parent.close()
            if worker_started:
                if worker.is_alive():
                    worker.terminate()
                worker.join(timeout=5)
                if worker.is_alive():
                    worker.kill()
                    worker.join(timeout=5)
                attempt['workerExitCode'] = worker.exitcode
                if worker.is_alive():
                    attempt['status'] = 'OWNED_WORKER_CLEANUP_FAILED'
                    (output/'practical-search.json').write_bytes(canonical_bytes(attempt))
                    raise RuntimeError('owned search worker did not exit; manual process cleanup required')
    # Real validation and metrics recomputation: a worker's old PASS/score is
    # never sufficient. This also checks fallback after timeout/crash.
    try:
        selected['diagnostics']['supervisor'] = attempt
        recommendation = recommend(observed, selected)
    except Exception as error:
        if selected is baseline:
            raise
        attempt.update(status='INVALID_SEARCH_RESULT_BASELINE_RETAINED',
                       errorType=type(error).__name__, error=str(error),
                       traceback=traceback.format_exc())
        selected = baseline
        selected['diagnostics']['supervisor'] = attempt
        recommendation = recommend(observed, selected)
    (output/'practical-search.json').write_bytes(canonical_bytes(selected['diagnostics']))
    (output/'practical-selection.json').write_bytes(canonical_bytes(recommendation))
    return selected, recommendation
