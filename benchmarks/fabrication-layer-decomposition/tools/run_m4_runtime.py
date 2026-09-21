"""Command-line entry point for the M4 observed-only runtime."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from m4_runtime import M4RuntimeError, load_foreground, run_runtime, validate_output_root


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--image", type=Path, required=True)
    result.add_argument("--foreground-mode", choices=("embedded-alpha", "external-mask"), required=True)
    result.add_argument("--mask", type=Path)
    result.add_argument("--whole-image-foreground", action="store_true")
    result.add_argument("--foreground-source", required=True)
    result.add_argument("--manual-confirmation", choices=("CONFIRMED", "PENDING_REVIEW"), required=True)
    result.add_argument("--profile", choices=("aggressive", "balanced"), default="aggressive")
    result.add_argument("--runtime-id", required=True)
    result.add_argument("--output", type=Path, required=True)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        output = validate_output_root(args.output, [item for item in (args.image, args.mask) if item is not None])
        foreground = load_foreground(
            args.image,
            mode=args.foreground_mode,
            mask_path=args.mask,
            foreground_source=args.foreground_source,
            manual_confirmation=args.manual_confirmation,
            whole_image_foreground=args.whole_image_foreground,
        )
        report = run_runtime(foreground, runtime_id=args.runtime_id, profile=args.profile, output_root=output)
    except (M4RuntimeError, OSError, ValueError) as error:
        print(f"M4_RUNTIME_HARD_FAIL {type(error).__name__}: {error}")
        return 2
    print(json.dumps({"status": report["status"], "runtimeId": report["runtimeId"], "page": str(output / "index.html")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
