from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
BENCHMARK_ROOT = ROOT / "benchmarks" / "background-removal"
FREEZE_PATH = BENCHMARK_ROOT / "acceptance-freeze.json"
VERIFIER = BENCHMARK_ROOT / "scripts" / "verify_freeze_git_bytes.py"
sys.path.insert(0, str(BENCHMARK_ROOT / "scripts"))

import benchmark_lib


class R31FreezeByteIntegrityTests(unittest.TestCase):
    def run_verifier(self, repo: Path = ROOT) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VERIFIER), "--repo", str(repo), "--ref", "HEAD"],
            text=True,
            capture_output=True,
            check=False,
        )

    def make_fixture_repo(self, target: str, expected: str) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        repo = Path(temporary.name)
        (repo / "benchmarks" / "background-removal").mkdir(parents=True)
        (repo / "targets").mkdir()
        (repo / "targets" / "one.json").write_bytes(b'{"fixture": true}\n')
        freeze = {
            "schemaVersion": "background-removal.acceptance-freeze/1",
            "files": {target: expected},
        }
        (repo / FREEZE_PATH).write_text(json.dumps(freeze), encoding="utf-8")
        for command in (
            ["git", "init", "-q"],
            ["git", "config", "user.email", "r31-test@example.invalid"],
            ["git", "config", "user.name", "R31 test"],
            ["git", "add", "."],
            ["git", "commit", "-qm", "fixture"],
        ):
            subprocess.run(command, cwd=repo, check=True)
        return repo

    def test_current_commit_targets_match_raw_git_blobs(self) -> None:
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS", result.stdout)

    def test_freeze_is_non_self_referential(self) -> None:
        fixture = self.make_fixture_repo("benchmarks/background-removal/acceptance-freeze.json", "0" * 64)
        result = self.run_verifier(fixture)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not hash itself", result.stdout)

    def test_wrong_expected_hash_fails(self) -> None:
        fixture = self.make_fixture_repo("targets/one.json", "0" * 64)
        result = self.run_verifier(fixture)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAIL", result.stdout)

    def test_missing_target_fails(self) -> None:
        fixture = self.make_fixture_repo("targets/missing.json", "0" * 64)
        result = self.run_verifier(fixture)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAIL", result.stdout)

    def test_path_escape_fails(self) -> None:
        fixture = self.make_fixture_repo("../escape.json", "0" * 64)
        result = self.run_verifier(fixture)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("escapes repository", result.stdout)

    def test_absolute_path_fails(self) -> None:
        fixture = self.make_fixture_repo("C:/outside.json", "0" * 64)
        result = self.run_verifier(fixture)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be relative", result.stdout)

    def test_attributes_pin_target_worktree_eol_to_lf(self) -> None:
        targets = [
            "benchmarks/background-removal/benchmark-config.json",
            "benchmarks/background-removal/scripts/benchmark_lib.py",
            "backend/services/image_postprocess.py",
        ]
        result = subprocess.run(
            ["git", "check-attr", "eol", "--", *targets],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual([line.rsplit(": ", 1)[-1] for line in result.stdout.splitlines()], ["lf"] * len(targets))

    def test_runtime_tamper_still_fails_closed(self) -> None:
        benchmark_lib.validate_acceptance_freeze()
        target = BENCHMARK_ROOT / "acceptance-dataset.json"
        original = target.read_bytes()
        try:
            target.write_bytes(original + b" ")
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                benchmark_lib.validate_acceptance_freeze()
        finally:
            target.write_bytes(original)


if __name__ == "__main__":
    unittest.main()
