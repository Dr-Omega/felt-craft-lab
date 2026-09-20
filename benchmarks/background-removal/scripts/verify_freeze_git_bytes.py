"""Release gate: verify the formal freeze against bytes stored in a Git ref."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any


FREEZE_PATH = "benchmarks/background-removal/acceptance-freeze.json"
HEX_DIGITS = set("0123456789abcdef")


def git_blob(repo: Path, ref: str, path: str) -> bytes:
    return subprocess.check_output(
        ["git", "-C", str(repo), "show", f"{ref}:{path}"], stderr=subprocess.PIPE
    )


def validate_target_path(repo: Path, target: object) -> str:
    if not isinstance(target, str) or not target:
        raise ValueError("freeze target path is invalid")
    if "\\" in target:
        raise ValueError("freeze target path must use Git-style separators")
    posix = PurePosixPath(target)
    windows = PureWindowsPath(target)
    if posix.is_absolute() or windows.is_absolute():
        raise ValueError("freeze target path must be relative")
    candidate = (repo / Path(*posix.parts)).resolve()
    try:
        candidate.relative_to(repo.resolve())
    except ValueError as exc:
        raise ValueError("freeze target path escapes repository") from exc
    if candidate == (repo / FREEZE_PATH).resolve():
        raise ValueError("freeze must not hash itself")
    return target


def validate_expected_hash(expected: object) -> str:
    if not isinstance(expected, str) or len(expected) != 64:
        raise ValueError("freeze expected SHA-256 is invalid")
    normalized = expected.lower()
    if any(character not in HEX_DIGITS for character in normalized):
        raise ValueError("freeze expected SHA-256 is invalid")
    return normalized


def read_freeze(repo: Path, ref: str) -> dict[str, Any]:
    try:
        freeze = json.loads(git_blob(repo, ref, FREEZE_PATH).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        raise ValueError("cannot read acceptance freeze from Git ref") from exc
    files = freeze.get("files") if isinstance(freeze, dict) else None
    if not isinstance(files, dict) or not files:
        raise ValueError("freeze files map is missing or invalid")
    return freeze


def verify(repo: Path, ref: str) -> bool:
    freeze = read_freeze(repo, ref)
    passed = True
    for target, expected_value in freeze["files"].items():
        expected = str(expected_value)
        try:
            target = validate_target_path(repo, target)
            expected = validate_expected_hash(expected_value)
            actual = hashlib.sha256(git_blob(repo, ref, target)).hexdigest()
            result = "PASS" if actual == expected else "FAIL"
        except (ValueError, subprocess.CalledProcessError) as exc:
            actual = f"ERROR: {exc}"
            result = "FAIL"
        print(f"{target}: expected={expected} actual={actual} {result}")
        passed = passed and result == "PASS"
    return passed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--ref", default="HEAD", help="commit-ish whose raw blobs are verified")
    args = parser.parse_args()
    try:
        return 0 if verify(args.repo.resolve(), args.ref) else 1
    except ValueError as exc:
        print(f"acceptance-freeze: expected=valid actual=ERROR: {exc} FAIL")
        return 1


if __name__ == "__main__":
    sys.exit(main())
