"""Rebuild read-only development examples; never load GT or mutate frozen data."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from algorithm_runtime import run_algorithm
from generate_layered_examples import write_examples
from m1_adapter import canonical_bytes
from m4_runtime import validate_output_root

BENCHMARK = Path(__file__).resolve().parents[1]


def run_examples(output, *, include_real=True):
    originals = [BENCHMARK / "fixtures/source" / name for name in ("FLD-001.png", "FLD-002.png", "FLD-003.png")]
    output = validate_output_root(Path(output), originals)
    output.mkdir(parents=True, exist_ok=True)
    development = output / "development-inputs"
    write_examples(development)
    ring = np.zeros((64, 64, 4), np.uint8)
    ring[4:60, 4:60] = [220, 35, 35, 255]
    ring[20:44, 20:44] = [25, 60, 220, 255]
    ring[28:36, 28:36] = 0
    Image.fromarray(ring).save(development / "development-color-ring.png")
    tradeoff = np.zeros((64, 64, 4), np.uint8)
    tradeoff[4:60, 4:60] = [220, 35, 35, 255]
    tradeoff[8:56, 8:56] = [25, 60, 220, 255]
    Image.fromarray(tradeoff).save(development / 'development-base-tradeoff.png')
    diagonal = np.zeros((32, 32, 4), np.uint8)
    diagonal[4:14, 4:14] = [220, 35, 35, 255]
    diagonal[14:24, 14:24] = [220, 35, 35, 255]
    diagonal[3, 4:14] = [225, 40, 40, 100]
    diagonal[0, 31] = [31, 19, 170, 12]
    Image.fromarray(diagonal).save(development / "development-diagonal-fringe.png")
    cases = [("development-ring", development / "development-color-ring.png", "DEVELOPMENT_SYNTHETIC", None, False),
             ("development-base-tradeoff", development / "development-base-tradeoff.png", "DEVELOPMENT_SYNTHETIC_SMALL_RED_RING_LARGE_BLUE_INTERIOR", None, False),
             ("development-diagonal-fringe", development / "development-diagonal-fringe.png", "DEVELOPMENT_SYNTHETIC", None, False),
             ("development-svg", development / "development-overlap.svg", "DEVELOPMENT_SYNTHETIC_LEGAL_SVG", ["*"], False),
             ("development-psd", development / "development-overlap.psd", "DEVELOPMENT_SYNTHETIC_LEGAL_PSD", ["*"], False),
             ("development-unsupported-psd", development / "development-unsupported-blend.psd", "DEVELOPMENT_SYNTHETIC_UNSUPPORTED_BLEND", ["*"], True)]
    if include_real:
        cases.extend((name, source, "PROJECT_REAL_READ_ONLY_DEVELOPMENT_REUSE", None, False)
                     for name, source in zip(("project-crescent", "project-envelope", "project-mooncake"), originals))
    results = []
    for name, source, provenance, selection, expected_failure in cases:
        started = time.perf_counter()
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        print("START " + name, flush=True)
        record = {"id": name, "sourcePath": str(source), "sourceSha256": before, "provenance": provenance,
                  "profile": "aggressive", "humanQuality": "PENDING_MANUAL_REVIEW",
                  "expectedUnsupportedFailure": expected_failure, "outputPath": str(output / name)}
        try:
            report = run_algorithm(image_path=source, output_root=output / name, foreground_source=provenance,
                                   selected_layer_ids=selection)
            record.update(status="COMPLETE", resultSha256=report["resultSha256"], pieceCount=report["pieceCount"],
                          splitGroupCount=report["splitGroupCount"], seamScore=report["seamScore"],
                          rerenderChecks=report["rerenderChecks"], originalToPurified=report["originalToPurified"],
                          selectedPlanId=report["selectedPlanId"])
        except Exception as error:
            # A broken parser/write/validator must not masquerade as the
            # deliberately unsupported blend-mode case.
            diagnosed_unsupported = (expected_failure and isinstance(error, ValueError)
                                     and str(error).startswith("layered source cannot be processed:"))
            record.update(status="EXPECTED_UNSUPPORTED" if diagnosed_unsupported else "FAILED",
                          errorType=type(error).__name__, error=str(error))
        if expected_failure and record['status'] == 'COMPLETE':
            record.update(status='FAILED', error='Unsupported blend unexpectedly accepted')
        after = hashlib.sha256(source.read_bytes()).hexdigest()
        if after != before:
            raise RuntimeError("Read-only source changed during run: " + str(source))
        record["sourceUnchanged"] = True
        record["durationSeconds"] = time.perf_counter() - started
        results.append(record)
        (output / "examples.json").write_bytes(canonical_bytes(results))
        print(json.dumps(record, ensure_ascii=False), flush=True)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--synthetic-only", action="store_true")
    args = parser.parse_args()
    result = run_examples(args.output, include_real=not args.synthetic_only)
    raise SystemExit(1 if any(r["status"] == "FAILED" for r in result) else 0)
