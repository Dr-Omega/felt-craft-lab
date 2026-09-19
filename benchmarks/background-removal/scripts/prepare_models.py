"""Explicit, non-timed model preparation step for the benchmark-only cache."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

from benchmark_lib import BENCHMARK_ROOT, create_adapter, load_config, load_manifest, model_artifact_record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", default=["all"], help="model IDs or all")
    args = parser.parse_args()
    config = load_config()
    manifest = load_manifest()
    selected = config["modelOrder"] if args.models == ["all"] else args.models
    unknown = [model_id for model_id in selected if model_id not in manifest]
    if unknown:
        raise ValueError(f"unknown models: {', '.join(unknown)}")

    prepared: dict[str, dict[str, object]] = {}
    for model_id in selected:
        if model_id == "current-rule":
            prepared[model_id] = {"status": "NOT_APPLICABLE", "artifact": model_artifact_record(model_id, manifest[model_id])}
            continue
        adapter = create_adapter(model_id, allow_model_download=True)
        try:
            adapter.initialize()
            prepared[model_id] = {"status": "PREPARED", "artifact": model_artifact_record(model_id, manifest[model_id])}
        except Exception as exc:  # noqa: BLE001
            prepared[model_id] = {"status": "UNVERIFIED", "reason": f"{type(exc).__name__}: {exc}", "artifact": model_artifact_record(model_id, manifest[model_id])}

    output = {"generatedAt": datetime.now(UTC).isoformat(), "timedBenchmark": False, "models": prepared}
    results_dir = BENCHMARK_ROOT / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / "model-preparation.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
