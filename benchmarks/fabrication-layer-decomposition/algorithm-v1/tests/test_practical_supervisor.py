"""Supervisor fault injection only; actual geometry gates have separate tests.

No child is started here. Mocking plan construction/selection isolates parent
process ownership, fallback durability and worker failure handling, not geometry
correctness. These tests must not be cited as real-process deadline measurements.
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from shapely.geometry import box

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),
               str(Path(__file__).resolve().parents[2] / 'tools')]
import practical_runtime as runtime
from practical_plans import PracticalPlanError


class PracticalSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.plan = {'id': 'actual-same-design-baseline',
                     'pieces': [{'id': 'piece', 'polygon': box(0, 0, 2, 2)}]}
        self.baseline = {
            'baseline': {'contract': 'fabrication.layered-result/1', 'plan': self.plan},
            'legacyFallback': None, 'layeredCandidates': [self.plan],
            'diagnostics': {'searchDeadlineSeconds': 420, 'sourceIdentity': 'test-identity',
                            'trials': []},
        }
        self.recommendation = {'recommendedIndex': 0,
                               'recommendedContract': 'fabrication.layered-result/1',
                               'recommendedPlanId': self.plan['id']}
        self.parent, self.child, self.worker, self.context = Mock(), Mock(), Mock(), Mock()
        self.context.Pipe.return_value = (self.parent, self.child)
        self.context.Process.return_value = self.worker
        self.worker.is_alive.return_value = False
        self.worker.exitcode = 0
        self.parent.poll.return_value = False
        for target, replacement in (
            ('prepare_practical_baseline', Mock(return_value=self.baseline)),
            ('recommend_practical_plan', Mock(return_value=self.recommendation)),
            ('multiprocessing.get_context', Mock(return_value=self.context)),
            ('time.perf_counter', Mock(return_value=1000.0)),
        ):
            patcher = patch('practical_runtime.'+target, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    def assert_baseline_returned(self, result):
        selected, recommendation = result
        self.assertEqual(selected['baseline']['plan']['id'], self.plan['id'])
        self.assertEqual(recommendation, self.recommendation)
        runtime.recommend_practical_plan.assert_called_once()
        persisted = json.loads((self.output/'practical-baseline.json').read_text('utf-8'))
        geometry = persisted['baseline']['plan']['pieces'][0]['polygon']
        self.assertEqual(geometry['geometryType'], 'GEOJSON')
        self.assertEqual(geometry['value']['type'], 'Polygon')
        self.assertTrue((self.output/'practical-search.json').is_file())
        self.assertTrue((self.output/'practical-selection.json').is_file())

    def test_expired_whole_run_budget_skips_worker_and_revalidates_saved_baseline(self):
        result = runtime._prepare_and_search([], self.output, started=0)
        self.assert_baseline_returned(result)
        self.context.Process.assert_not_called()
        self.assertEqual(result[0]['diagnostics']['supervisor']['status'],
                         'SKIPPED_NO_SEARCH_BUDGET_BASELINE_RETAINED')

    def test_timeout_terminates_only_owned_worker_and_baseline_is_saved_before_start(self):
        def check_saved():
            self.assertTrue((self.output/'practical-baseline.json').is_file())
        self.worker.start.side_effect = check_saved
        self.worker.is_alive.side_effect = [True, False, False]
        result = runtime._prepare_and_search([], self.output, started=1000)
        self.assert_baseline_returned(result)
        self.worker.terminate.assert_called_once()
        self.worker.join.assert_called()
        self.parent.close.assert_called_once()
        self.child.close.assert_called_once()
        self.assertEqual(result[0]['diagnostics']['supervisor']['status'],
                         'SEARCH_TIMEOUT_BASELINE_RETAINED')

    def test_eof_child_crash_retains_actual_baseline(self):
        self.parent.poll.return_value = True
        self.parent.recv.side_effect = EOFError('worker exited')
        self.worker.exitcode = 7
        result = runtime._prepare_and_search([], self.output, started=1000)
        self.assert_baseline_returned(result)
        self.assertEqual(result[0]['diagnostics']['supervisor']['errorType'],
                         'WorkerClosedWithoutResult')
        self.assertEqual(result[0]['diagnostics']['supervisor']['workerExitCode'], 7)

    def test_worker_all_rejected_diagnostics_are_persisted_without_losing_baseline(self):
        self.parent.poll.return_value = True
        details = {'trials': [{'stage': 'SEARCH_MATERIALIZE_VALIDATE', 'status': 'REJECTED',
                              'reason': 'invalid same-design proposal', 'stderr': 'GEOS detail'}]}
        self.parent.recv.return_value = {'status': 'FAILED', 'errorType': 'PracticalPlanError',
                                        'error': 'all rejected', 'diagnostics': details,
                                        'traceback': 'test worker traceback'}
        result = runtime._prepare_and_search([], self.output, started=1000)
        self.assert_baseline_returned(result)
        saved = json.loads((self.output/'practical-search.json').read_text('utf-8'))
        self.assertEqual(saved['supervisor']['diagnostics'], details)

    def test_spawn_resource_failure_must_not_discard_saved_legal_baseline(self):
        self.worker.start.side_effect = OSError('unable to allocate worker')
        result = runtime._prepare_and_search([], self.output, started=1000)
        self.assert_baseline_returned(result)
        self.parent.close.assert_called_once()
        self.child.close.assert_called_once()
        self.assertEqual(result[0]['diagnostics']['supervisor']['errorType'], 'OSError')

    def test_broken_result_transport_must_not_discard_saved_legal_baseline(self):
        self.parent.poll.return_value = True
        self.parent.recv.side_effect = OSError('result pipe broke during transfer')
        result = runtime._prepare_and_search([], self.output, started=1000)
        self.assert_baseline_returned(result)
        self.assertEqual(result[0]['diagnostics']['supervisor']['errorType'], 'OSError')

    def test_no_legal_baseline_persists_all_rejection_details_and_never_spawns(self):
        details = {'trials': [{'stage': 'BASELINE_ACTUAL_VALIDATION', 'status': 'REJECTED',
                              'reason': 'wrong source'}]}
        runtime.prepare_practical_baseline.side_effect = PracticalPlanError('no legal fallback', details)
        with self.assertRaises(PracticalPlanError):
            runtime._prepare_and_search([], self.output, started=1000)
        self.assertEqual(json.loads((self.output/'practical-search.json').read_text('utf-8')), details)
        self.assertFalse((self.output/'practical-baseline.json').exists())
        self.context.Process.assert_not_called()

    def test_invalid_worker_candidate_is_rejected_then_baseline_revalidated(self):
        self.parent.poll.return_value = True
        self.parent.recv.return_value = {'status': 'RETURNED', 'value': {
            'diagnostics': {}, 'layeredCandidates': [{'bad': 'candidate'}]}}
        runtime.recommend_practical_plan.side_effect = [ValueError('wrong source'), self.recommendation]
        selected, recommendation = runtime._prepare_and_search([], self.output, started=1000)
        self.assertIs(selected, self.baseline)
        self.assertEqual(recommendation, self.recommendation)
        self.assertEqual(runtime.recommend_practical_plan.call_count, 2)
        self.assertEqual(selected['diagnostics']['supervisor']['status'],
                         'INVALID_SEARCH_RESULT_BASELINE_RETAINED')

    def test_unstoppable_owned_worker_is_explicit_failure_not_a_fake_completion(self):
        self.worker.is_alive.return_value = True
        self.worker.exitcode = None
        with self.assertRaisesRegex(RuntimeError, 'manual process cleanup'):
            runtime._prepare_and_search([], self.output, started=1000)
        self.worker.kill.assert_called_once()
        runtime.recommend_practical_plan.assert_not_called()
        self.assertEqual(json.loads((self.output/'practical-search.json').read_text('utf-8'))['status'],
                         'OWNED_WORKER_CLEANUP_FAILED')


if __name__ == '__main__':
    unittest.main()
