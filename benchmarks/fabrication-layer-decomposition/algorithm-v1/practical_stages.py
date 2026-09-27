"""Small, in-memory development stages; never a persisted acceptance shortcut.

Only pure CP-B/RC-A arrays and selection results are reused. Completion and
ranking always invoke their real validators. Final runtime acceptance does not
consume this session or any ``verified`` flag. No files are written here.
"""
from __future__ import annotations

from collections import OrderedDict
import copy
import hashlib
import importlib.metadata
from pathlib import Path
import platform
import time

import numpy as np

from m1_adapter import canonical_bytes
import m4_runtime as kernel

HERE = Path(__file__).resolve().parent
STATUS = "PREVIEW_NOT_ACCEPTANCE"
_DEPENDENCIES = ("numpy", "opencv-python-headless", "Pillow", "scikit-image", "shapely", "scipy")


def _digest(value):
    """Bind shapes, dtypes and all result metadata, not just rendered pixels."""
    def normalize(item):
        if isinstance(item, np.ndarray):
            if item.dtype.hasobject:
                raise ValueError("object arrays are not valid staged inputs")
            return {"arrayShape": list(item.shape), "arrayDtype": item.dtype.str,
                    "arraySha256": hashlib.sha256(item.tobytes(order="C")).hexdigest()}
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, (list, tuple)):
            return [normalize(child) for child in item]
        return item
    return hashlib.sha256(canonical_bytes(normalize(value))).hexdigest()


def _implementation_identity(stage):
    sources = [Path(__file__), Path(kernel.__file__),
               *sorted((kernel.COLOR_ROOT / "src").glob("*.py"))]
    if stage == "selection":
        # Selection calls palette, topology and option helpers. A hash of only
        # rebuild_regions' defining file would miss those semantic changes.
        sources.extend(sorted(HERE.glob("*.py")))
    return {
        "sourceLfUtf8Sha256": {
            path.relative_to(HERE.parent).as_posix(): hashlib.sha256(
                path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
            for path in sorted(set(sources))},
        "dependencies": {name: importlib.metadata.version(name) for name in _DEPENDENCIES},
        "python": platform.python_version(),
        "stage": stage,
        "version": "practical-development-stages/1",
    }


def _rgba_snapshot(rgba):
    if not isinstance(rgba, np.ndarray) or rgba.dtype != np.uint8 or rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError("staged foreground must be uint8 H×W×4 RGBA")
    if not rgba.shape[0] or not rgba.shape[1]:
        raise ValueError("staged foreground cannot have an empty frame")
    original = rgba.copy()
    normalized = original.copy()
    normalized[normalized[..., 3] == 0, :3] = 0
    return original, normalized


# Import execution dependencies before recording their on-disk implementation.
# A new session in this same process must NOT bless changed files while Python
# still holds their old functions in sys.modules. No automatic reload is used.
import practical_selection as _selection_module
import layered_completion as _completion_module
_IMPORT_IMPLEMENTATIONS = {stage: _implementation_identity(stage) for stage in ("baseline", "selection")}


class PreviewStages:
    """Bounded per-process development reuse, with copy-out and tamper checks.

    ``rgba`` is an explicit caller-prepared foreground. Foreground cleanup is a
    separate choice: pass its derived image to selection, not its old labels.
    Editing selection sources leaves baseline preparation reusable, but selection
    refuses a stale session. Start a new Python process after editing modules;
    changing a file does not reload already imported Python code. Configuration
    and input changes safely produce distinct pure-computation cache entries.
    """

    def __init__(self):
        self._baseline = OrderedDict()
        self._selection = OrderedDict()
        self._events = []
        self._calls = {"cpB": 0, "rcA": 0, "selection": 0, "completion": 0, "ranking": 0}

    def _implementation(self, stage):
        current = _implementation_identity(stage)
        if current != _IMPORT_IMPLEMENTATIONS[stage]:
            raise ValueError("staged implementation/dependency changed; start a fresh development worker process: " + stage)
        return current

    def _reuse(self, entries, key, compute, stage):
        started = time.perf_counter()
        self._implementation(stage)
        hit = key in entries
        if hit:
            payload, checksum = entries[key]
            if _digest(payload) != checksum:
                raise ValueError("staged result content changed: " + stage)
            entries.move_to_end(key)
        else:
            payload = compute()
            self._implementation(stage)
            checksum = _digest(payload)
            entries[key] = (copy.deepcopy(payload), checksum)
            while len(entries) > 4:
                entries.popitem(last=False)
        result = copy.deepcopy(payload)
        if _digest(result) != checksum:
            raise ValueError("staged result copy differs: " + stage)
        self._implementation(stage)
        self._events.append({"stage": stage, "cacheHit": hit, "key": key,
                             "seconds": time.perf_counter() - started})
        return result

    def prepare_foreground(self, rgba, color_config):
        original, normalized = _rgba_snapshot(rgba)
        config = copy.deepcopy(color_config)
        identity = {"rgbaSha256": _digest(normalized), "colorConfiguration": config,
                    "implementation": self._implementation("baseline")}
        key = _digest(identity)

        def compute():
            self._calls["cpB"] += 1
            proposal = kernel.get_candidate("CP-B").propose(normalized.copy(), config)
            self._calls["rcA"] += 1
            purified, metadata = kernel.apply_representatives(normalized,
                proposal.structural_label_map, "RC-A", config, proposal.pixel_label_map)
            return {"rgba": normalized, "structural": proposal.structural_label_map,
                    "pixels": proposal.pixel_label_map, "purified": purified,
                    "metadata": metadata}

        result = self._reuse(self._baseline, key, compute, "baseline")
        result.update(status=STATUS, identity=identity, key=key,
                      originalRgba=original, originalRgbaSha256=_digest(original))
        return result

    def selection(self, rgba, color_config, request):
        implementation = self._implementation("selection")
        baseline = self.prepare_foreground(rgba, color_config)
        config, request = copy.deepcopy(color_config), copy.deepcopy(request)
        identity = {"baselineKey": baseline["key"], "colorConfiguration": config,
                    "request": request, "implementation": implementation}
        key = _digest(identity)

        def compute():
            self._calls["selection"] += 1
            labels, pixels, report = _selection_module.rebuild_regions(baseline["rgba"].copy(),
                baseline["structural"].copy(), baseline["pixels"].copy(), config, request)
            return {"structural": labels, "pixels": pixels, "report": report}

        result = self._reuse(self._selection, key, compute, "selection")
        result.update(status=STATUS, identity=identity, key=key,
                      originalRgbaSha256=baseline["originalRgbaSha256"],
                      effectiveRgbaSha256=_digest(baseline["rgba"]))
        return result

    def complete(self, observed):
        self._implementation("selection")
        started = time.perf_counter()
        self._calls["completion"] += 1
        plans = _completion_module.propose_layered_plans(copy.deepcopy(observed))
        self._implementation("selection")
        self._events.append({"stage": "completion", "cacheHit": False,
                             "seconds": time.perf_counter() - started})
        return {"status": STATUS, "plans": plans}

    def rank(self, observed, plans):
        self._implementation("selection")
        started = time.perf_counter()
        self._calls["ranking"] += 1
        ranked = _completion_module.rank_layered_plans(copy.deepcopy(observed), copy.deepcopy(plans))
        self._implementation("selection")
        self._events.append({"stage": "ranking", "cacheHit": False,
                             "seconds": time.perf_counter() - started})
        return {"status": STATUS, "plans": ranked}

    def measurements(self):
        """Timings are diagnostic only and never part of stable stage identity."""
        return {"status": STATUS, "calls": self._calls.copy(), "events": copy.deepcopy(self._events)}
