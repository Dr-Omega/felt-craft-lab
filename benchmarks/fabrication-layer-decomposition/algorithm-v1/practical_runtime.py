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


def _search_worker(channel, observed, baseline, stderr_path):
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
            channel.send({'status': 'RETURNED', 'value': search_practical_candidates(observed, baseline)})
        except BaseException as error:
            trace = traceback.format_exc()
            errors.write(trace)
            errors.flush()
            channel.send({'status': 'FAILED', 'errorType': type(error).__name__,
                          'error': str(error), 'traceback': trace,
                          'diagnostics': getattr(error, 'diagnostics', None)})
        finally:
            channel.close()


def _prepare_and_search(observed, output, started):
    try:
        baseline = prepare_practical_baseline(observed)
    except PracticalPlanError as error:
        (output/'practical-search.json').write_bytes(canonical_bytes(error.diagnostics))
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
                args=(child, observed, baseline, str(output/'practical-search.stderr.log')))
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
        recommendation = recommend_practical_plan(observed, selected)
    except Exception as error:
        if selected is baseline:
            raise
        attempt.update(status='INVALID_SEARCH_RESULT_BASELINE_RETAINED',
                       errorType=type(error).__name__, error=str(error),
                       traceback=traceback.format_exc())
        selected = baseline
        selected['diagnostics']['supervisor'] = attempt
        recommendation = recommend_practical_plan(observed, selected)
    (output/'practical-search.json').write_bytes(canonical_bytes(selected['diagnostics']))
    (output/'practical-selection.json').write_bytes(canonical_bytes(recommendation))
    return selected, recommendation
