"""Real runtime artifacts -> size-independent M1 input; no fabricated pieces."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'tools'))


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def artifact(path: Path, artifact_id: str | None = None, media_type: str | None = None) -> dict:
    data = path.read_bytes()
    return {"id": artifact_id or path.name, "sha256": hashlib.sha256(data).hexdigest(),
            "identityMode": "EXACT_BYTES", "byteLength": len(data),
            "mediaType": media_type or {".png": "image/png", ".npz": "application/x-npz"}.get(path.suffix.lower(), "application/json")}


def _write_artifact(root: Path, name: str, value: Any) -> dict:
    data = canonical_bytes(value)
    target = root / name
    if target.exists() and target.read_bytes() != data:
        raise ValueError(f"Existing M1 artifact differs: {name}")
    if not target.exists():
        target.write_bytes(data)
    return artifact(target)


def build_input(runtime_dir: Path, layered_evidence: dict | None = None) -> dict:
    """Normalize real M4 records, retain exact palette and selected vector geometry.

    Caller owns runtime directory isolation. Existing differing M1 artifacts are
    rejected rather than overwritten. Source identity excludes runtime names,
    absolute paths, durations and timestamps.
    """
    return _build_input(runtime_dir, layered_evidence, replay_quality=True)


def _assemble_generated_input(runtime_dir: Path, layered_evidence: dict | None = None) -> dict:
    """Private in-process assembly after M4 generation; NOT acceptance.

    Component domains are still recomputed below. The guarded practical runtime
    must call public build_input on persisted artifacts before publishing any
    completed result. There is no caller-supplied verified flag or PASS cache.
    """
    report = json.loads((runtime_dir / 'report.json').read_text('utf-8'))
    if report.get('experimentalDesign', {}).get('mode') != 'practical-auto':
        raise ValueError('fresh generation assembly is restricted to practical auto')
    return _build_input(runtime_dir, layered_evidence, replay_quality=False)


def _build_input(runtime_dir, layered_evidence, *, replay_quality):
    root = runtime_dir.resolve()
    from component_binding import verify_persisted_binding
    binding = verify_persisted_binding(root)
    regions = json.loads((root / "regions.json").read_text("utf-8"))
    graph = json.loads((root / "boundary-graph.json").read_text("utf-8"))
    vector = json.loads((root / "vector-result.json").read_text("utf-8"))
    report = json.loads((root / "report.json").read_text("utf-8"))
    source_path = root / "source-snapshot.png"
    source = artifact(source_path)
    if source["sha256"] != report["input"]["sourceImage"]["sha256"]:
        raise ValueError("Source snapshot differs from runtime source provenance")
    with Image.open(source_path) as image:
        source["mediaType"] = Image.MIME.get(image.format, "application/octet-stream")
        source_size = image.size
    with Image.open(root / "input-foreground.png") as image:
        width, height = image.size
    with Image.open(root / "purified.png") as image:
        if image.size != (width, height):
            raise ValueError("Purified and foreground image dimensions differ")
    if source_size != (width, height):
        raise ValueError("Source snapshot and analysis canvas dimensions differ")
    if (graph["width"], graph["height"]) != (width, height):
        raise ValueError("Boundary graph frame differs from analysis raster")
    graph_regions = {int(item["regionId"]): item for item in graph["regions"]}
    if set(graph_regions) != {int(item["regionId"]) for item in regions}:
        raise ValueError("Runtime and boundary graph region references differ")
    vector_edges = {edge["edgeId"]: edge for edge in vector["geometry"]}
    objects, palette, observed = {}, {}, []
    for region in sorted(regions, key=lambda item: int(item["regionId"])):
        region_id = f"R{int(region['regionId']):05d}"
        rgb = region["representativeColorRgb"]
        if len(rgb) != 3 or any(type(channel) is not int or not 0 <= channel <= 255 for channel in rgb):
            raise ValueError("Representative palette is not exact 8-bit RGB")
        color_id = "RGB-" + "".join(f"{channel:02X}" for channel in rgb)
        entry = palette.setdefault(color_id, {"id": color_id, "rgb": rgb, "method": "RC-A", "sourceRegionIds": []})
        entry["sourceRegionIds"].append(region_id)
        components = graph_regions[int(region["regionId"])]["components"]
        component_ids = [item["componentId"] for item in region["components"]]
        graph_ids = [item['componentId'] for item in components]
        if len(set(component_ids)) != len(component_ids) or set(component_ids) != set(graph_ids):
            raise ValueError("Runtime and graph component references differ")
        component_ids = graph_ids
        refs = sorted({ref["edgeId"] for component in components
                       for ring in [component["outerRing"], *component.get("innerRings", [])]
                       for ref in ring["edgeReferences"]})
        if any(edge_id not in vector_edges for edge_id in refs):
            raise ValueError("Region references a missing selected vector edge")
        objects[region_id] = {"regionId": region_id, "components": components,
                              "selectedEdges": [vector_edges[key] for key in refs]}
        observed.append({"id": region_id, "componentIds": component_ids, "colorSlotId": color_id,
                         "geometry": {"artifactId": "m1-geometry.json", "objectId": region_id, "frameId": "canonical"}})
    provenance = {"sourceSha256": source["sha256"], 'componentBinding': binding, "dimensions": [width, height],
                  "normalization": "Explicit foreground preserves source raster dimensions and top-left pixel-cell coordinates",
                  "vectorCoordinates": "Selected P0-04C segments already use source-pixel boundaries; canonical unit equals one source pixel",
                  "foregroundMode": report["input"]["foregroundMode"],
                  "foregroundInterpretation": report["input"]["foregroundInterpretation"],
                  "manualConfirmation": report["input"]["manualConfirmation"]}
    native_bounds = [0, 0, width, height]
    native_sampling = "PIXEL_CELL_BOUNDARY"
    source_transform = [1, 0, 0, 1, 0, 0]
    original_identity = None
    design = report.get('experimentalDesign')
    if design is not None:
        from quality_binding import verify_quality_design
        if replay_quality:
            verify_quality_design(root)
        provenance['experimentalDesign'] = design
        provenance['normalization'] = 'Original A snapshot retained; actual experimental B labels, exact palette and selected shared edges independently versioned; NOT frozen or human-accepted evidence'
    if layered_evidence is not None:
        original = layered_evidence["sourceArtifact"]
        original_identity = artifact(Path(original["path"]), "layered-source", original["mediaType"])
        if original_identity["sha256"] != original["sha256"]:
            raise ValueError("Layered source identity mismatch")
        source_frame = layered_evidence["sourceFrame"]
        native_bounds = source_frame["bounds"]
        native_sampling = source_frame["sampleConvention"]
        source_transform = source_frame["matrixToAnalysis"]
        if len(source_transform) != 6 or len(native_bounds) != 4:
            raise ValueError("Layered source frame must supply native bounds and affine transform")
        a, b, c, d, e, f = source_transform
        x, y, w, h = native_bounds
        mapped = [a*x+e, d*y+f, a*(x+w)+e, d*(y+h)+f]
        if (not all(math.isfinite(value) for value in [*source_transform, *native_bounds])
                or b != 0 or c != 0 or a <= 0 or d <= 0 or w <= 0 or h <= 0
                or mapped[0] < -1e-8 or mapped[1] < -1e-8
                or mapped[2] > width+1e-8 or mapped[3] > height+1e-8):
            raise ValueError("Layered native frame does not map to actual normalized raster")
        provenance["layeredSourceSha256"] = original_identity["sha256"]
        provenance["sourceToAnalysis"] = source_transform
        provenance["nativeBounds"] = native_bounds
        provenance["mappedNativeBoundsInAnalysis"] = mapped
        provenance["normalization"] = "M5 parser native canvas/viewBox is mapped to its actual normalized foreground raster; no inferred layers or scaling"
    identities = [source, *[artifact(root / name) for name in
                  ("input-foreground.png", "purified.png", "regions.json", "boundary-graph.json", "vector-result.json",
                   'component-binding.json', 'structural_label_map.npz', 'observed-candidates.json')]]
    if design is not None:
        identities.extend(artifact(root / name, media_type='application/x-npz' if name.endswith('.npz') else None)
                          for name in ('experimental-design.json', 'baseline-analysis.npz', 'baseline-regions.json',
                                       'original-effective-foreground.png', 'baseline-purified.png',
                                       'pixel_label_map.npz'))
    if (root / "external-mask-snapshot.png").exists():
        mask_artifact = artifact(root / "external-mask-snapshot.png")
        if mask_artifact["sha256"] != report["input"]["externalMask"]["sha256"]:
            raise ValueError("Mask snapshot differs from runtime provenance")
        identities.append(mask_artifact)
        provenance["maskSha256"] = mask_artifact["sha256"]
    identities.extend([
        _write_artifact(root, "m1-palette.json", {"entries": palette}),
        _write_artifact(root, "m1-geometry.json", {"objects": objects, "selectedVectorRoute": vector["route"]}),
        _write_artifact(root, "m1-coordinates.json", provenance),
    ])
    source_descriptor = {"mediaType": source["mediaType"], "sourceKind": "FLAT", "artifactId": source["id"],
                         "normalizedLayerEvidenceId": None,
                         "adapter": {"id": "m4-explicit-foreground", "version": "1", "status": "SUPPORTED"}}
    if design is not None:
        source_descriptor['adapter'] = {'id': 'm4-experimental-application-design', 'version': '1', 'status': 'SUPPORTED'}
    if layered_evidence is not None:
        # Layered source records must use portable evidence, not a local locator.
        portable = {key: value for key, value in layered_evidence.items() if key != "sourceArtifact"}
        portable["sourceArtifact"] = original_identity
        identities.extend([original_identity, _write_artifact(root, "m1-layer-evidence.json", portable)])
        source_descriptor = {"mediaType": original_identity["mediaType"], "sourceKind": "LAYERED",
                             "artifactId": "layered-source", "normalizedLayerEvidenceId": "m1-layer-evidence.json",
                             "adapter": {"id": "m5-layered-evidence", "version": "1", "status": layered_evidence["status"]}}
    frames = []
    for frame_id, space, unit, sampling, source_id in (
        ("source", "source-native", "native-unit", "PIXEL_CELL_BOUNDARY", source["id"]),
        ("analysis", "analysis-raster", "px", "PIXEL_CELL_BOUNDARY", "input-foreground.png"),
        ("p004c", "p0-04c", "px", "CONTINUOUS", "vector-result.json"),
        ("canonical", "fabrication-canonical", "canonical-unit", "CONTINUOUS", "m1-geometry.json"),
    ):
        frames.append({"id": frame_id, "space": space, "unit": unit, "bounds": [0, 0, width, height],
                       "xDirection": "RIGHT", "yDirection": "DOWN", "sampleConvention": sampling, "sourceArtifactId": source_id})
    frames[0].update({"bounds": native_bounds, "sampleConvention": native_sampling,
                      "sourceArtifactId": source_descriptor["artifactId"]})
    return {"schemaVersion": "b2.input/1", "assetVersionId": "sha256:" + (design['sha256'] if design else (original_identity or source)["sha256"]),
            "artifacts": identities, "source": source_descriptor,
            "coordinates": {"frames": frames, "transforms": [
                {"id": f"{a}-to-{b}", "fromFrameId": a, "toFrameId": b, "matrix": source_transform if a == "source" else [1, 0, 0, 1, 0, 0],
                 "evidenceArtifactIds": ["m1-coordinates.json"]}
                for a, b in (("source", "analysis"), ("analysis", "p004c"), ("p004c", "canonical"))],
                "sourceFrameId": "source", "analysisFrameId": "analysis", "p004cFrameId": "p004c", "canonicalFrameId": "canonical"},
            "frozenRegionArtifactId": "regions.json", "frozenVectorArtifactId": "vector-result.json",
            "colorSlots": [{"id": key, "purificationArtifactId": "m1-palette.json", "paletteEntryId": key,
                            "rgb": value["rgb"], "skinFamily": None} for key, value in sorted(palette.items())],
            "observedRegions": observed}


def run_shared_validation(input: dict | None = None, result: dict | None = None,
                          assessment: dict | None = None, sign_result: bool = False) -> dict:
    """Compile and invoke repository TypeScript validators, never a Python clone.

    TYPESCRIPT_TSC may locate a preinstalled TypeScript compiler. Dependencies
    are never installed implicitly. Emitted JS lives only in a temporary cache.
    """
    if input is None and result is None:
        raise ValueError("Shared validation requires actual input or result")
    candidates = [Path(os.environ["TYPESCRIPT_TSC"])] if "TYPESCRIPT_TSC" in os.environ else []
    candidates.extend(base / "node_modules/typescript/lib/tsc.js" for base in
                      (ROOT, ROOT.parent, ROOT.parent / "felt-craft-lab"))
    tsc = next((path for path in candidates if path.is_file()), None)
    node = shutil.which("node")
    if tsc is None or node is None:
        raise RuntimeError("Real shared validation requires Node and TypeScript; set TYPESCRIPT_TSC to installed tsc.js")
    sources = [HERE / "validate_contract.ts", *sorted((ROOT / "src/shared/contracts").glob("*.ts"))]
    cache_key = hashlib.sha256(str(ROOT).encode() + b"".join(path.read_bytes() for path in sources)).hexdigest()
    cache = Path(tempfile.gettempdir()) / "felt-craft-m1-validator" / cache_key
    bridge = cache / "benchmarks/fabrication-layer-decomposition/algorithm-v1/validate_contract.js"
    if not bridge.exists():
        compilation = subprocess.run([node, str(tsc), str(HERE / "validate_contract.ts"),
            "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--strict",
            "--skipLibCheck", "--noEmitOnError", "--rootDir", str(ROOT), "--outDir", str(cache)], capture_output=True, text=True)
        if compilation.returncode:
            raise RuntimeError("Shared validator compilation failed: " + compilation.stdout + compilation.stderr)
    request = {key: value for key, value in {"input": input, "result": result, "assessment": assessment,
                                           "sign_result": sign_result}.items() if value is not None}
    response = subprocess.run([node, str(bridge)], input=json.dumps(request, allow_nan=False),
                              capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(response.stdout)
