"""Stable serialization and artifact hashing for P0-04C evidence."""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonicalize(value: Any) -> Any:
    if isinstance(value, float):
        rounded = round(value, 8)
        return 0.0 if rounded == -0.0 else rounded
    if isinstance(value, dict):
        return {key: canonicalize(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [canonicalize(item) for item in value]
    return value


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(canonicalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json_bytes(value))


def write_json_gz(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # mtime=0 makes gzip artifacts byte-identical across runs.
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as handle:
            handle.write(canonical_json_bytes(value))


def result_artifact_hashes(directory: Path) -> dict[str, str]:
    return {path.name: sha256(path) for path in sorted(directory.iterdir()) if path.is_file()}
