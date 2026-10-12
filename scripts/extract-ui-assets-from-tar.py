# -*- coding: utf-8 -*-
"""Extract export-v2 / explode-v2 PNGs using size keys (avoids broken CJK paths on Windows)."""
from __future__ import annotations

import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TAR = REPO.parent / "repo.tar.gz"

EXPORT_V2_BY_SIZE: dict[int, str] = {
    310486: "big-background.png",
    122184: "projection-frame.png",
    623569: "frame-border.png",
    20838: "btn-export.png",
    23738: "btn-finish.png",
    38628: "export-modal.png",
    18976: "btn-modal-specific.png",
    19228: "btn-modal-optional.png",
    16681: "modal-text-field.png",
    21719: "btn-back.png",
}

EXPLODE_V2_BY_SIZE: dict[int, str] = {
    310486: "big-background.png",
    123124: "frame-background.png",
    623569: "frame-border.png",
    20129: "btn-check.png",
    20950: "btn-cross.png",
    21530: "btn-next.png",
    21719: "btn-back.png",
}


def extract_subtree(sub: str, mapping: dict[int, str]) -> int:
    out_dir = REPO / "assets" / "ui" / sub
    out_dir.mkdir(parents=True, exist_ok=True)
    written: set[str] = set()
    count = 0
    with tarfile.open(TAR, "r:gz") as tf:
        for member in tf.getmembers():
            if not member.isfile():
                continue
            if f"/assets/ui/{sub}/" not in member.name or not member.name.endswith(".png"):
                continue
            alias = mapping.get(member.size)
            if not alias or alias in written:
                continue
            src = tf.extractfile(member)
            if not src:
                continue
            (out_dir / alias).write_bytes(src.read())
            written.add(alias)
            count += 1
    return count


def main() -> int:
    if not TAR.is_file():
        print(f"Missing tarball: {TAR}", file=sys.stderr)
        return 1
    e = extract_subtree("export-v2", EXPORT_V2_BY_SIZE)
    x = extract_subtree("explode-v2", EXPLODE_V2_BY_SIZE)
    print(f"export-v2: {e} files, explode-v2: {x} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
