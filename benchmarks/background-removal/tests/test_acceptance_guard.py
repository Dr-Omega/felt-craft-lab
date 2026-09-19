from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from benchmark_lib import load_config  # noqa: E402
from run_benchmark import load_cases  # noqa: E402


class AcceptanceDatasetGuardTests(unittest.TestCase):
    def test_full_acceptance_run_fails_closed_before_fifteen_complete_cases_exist(self) -> None:
        args = SimpleNamespace(case=None, all_cases=True)
        with self.assertRaisesRegex(ValueError, "requires 15 approved project-real reviewed cases"):
            load_cases(args, load_config())


if __name__ == "__main__":
    unittest.main()
