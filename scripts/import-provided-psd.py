# /// script
# requires-python = ">=3.11"
# dependencies = ["psd-tools==1.25.0", "Pillow==12.3.0", "numpy"]
# ///
"""Publish the five supplied PSDs without inference or modifying historical snapshots.

uv run scripts/import-provided-psd.py --source <folder-with-the-five-original-PSDs>
Only normal, opaque pixel layers are admitted by this pack importer. Unsupported
features fail closed; the original PSDs and every hidden layer are retained.
"""
import argparse
import copy
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import BlendMode

ROOT = Path(__file__).resolve().parents[1]
BASE = "snapshot_ywn_material_v2_1cdf77d"
SNAPSHOT = "snapshot_ywn_psd_20261017"
FILES = {
    "fuwa": ("fuwa(1).psd", None),
    "hongbao": ("hongbao(2).psd", "sticker_red_envelope_001"),
    "jiaozi": ("jiaozi 拷贝(3).psd", "sticker_dumpling_001"),
    "denglong": ("denglong(1).psd", "sticker_lantern_001"),
    "beijing": ("beijing(2).psd", "background_couplet_gate_001"),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_version_ledger(manifest: dict) -> None:
    generated = ROOT / "assets" / "generated"
    path = generated / "content-versions.json"
    versions = json.loads(path.read_text(encoding="utf-8"))
    replaced = {asset_id for _, asset_id in FILES.values() if asset_id}
    for asset in manifest["assets"]:
        if asset["assetId"] not in replaced:
            continue
        entry = copy.deepcopy(versions["assets"][asset["assetId"]])
        projection = entry["projection"]
        for key in ["type", "themeId", "categoryIds", "nameZh", "nameEn", "introZh", "keywords", "source", "license"]:
            projection[key] = asset.get(key)
        for slot, field in [("image", "imageUrl"), ("thumbnail", "thumbnailUrl"), ("preSplit", "preSplitDataUrl")]:
            ref = asset.get(field)
            projection[slot] = {"logicalName": Path(ref).name if ref else "", "sha256": digest(generated / ref.removeprefix("felt-resource://")) if ref else ""}
        entry["contentVersion"] = asset["contentVersion"]
        versions["assets"][asset["assetId"]] = entry
    versions["updatedAt"] = manifest["generatedAt"]
    write_json(path, versions)


def extract(source: Path, output: Path, originals: Path, key: str, filename: str) -> dict:
    path = source / filename
    psd = PSDImage.open(path)
    if psd.depth != 8 or str(psd.color_mode) != "3":
        raise ValueError(f"Unsupported document color/depth: {filename}")
    for layer in psd.descendants():
        if layer.kind != "pixel" or layer.blend_mode != BlendMode.NORMAL or layer.opacity != 255 or layer.clipping or layer.has_mask() or layer.has_vector_mask() or bool(layer.effects):
            raise ValueError(f"Unsupported layer features, original retained: {filename}/{layer.name}")
    composite = psd.composite(force=True, alpha=0).convert("RGBA")
    crop = (0, 0, psd.width, psd.height) if key == "beijing" else composite.getbbox()
    if crop is None:
        raise ValueError(f"Empty artwork: {filename}")
    artwork = composite.crop(crop)
    target = output / "provided" / key
    target.mkdir(parents=True, exist_ok=False)
    originals.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, originals / filename)
    if digest(path) != digest(originals / filename):
        raise ValueError("Source copy mismatch")
    original = {"filename": filename, "sha256": digest(path), "width": psd.width, "height": psd.height, "depth": psd.depth}
    def ref(name: str) -> str:
        return f"felt-resource://material/{SNAPSHOT}/provided/{key}/{name}"
    artwork.save(target / "psd-native-composite.png")
    assembled = Image.new("RGBA", artwork.size)
    layers = []
    # psd-tools exposes children in bottom-to-top paint order.
    for index, layer in enumerate(psd):
        pixels = layer.topil().convert("RGBA")
        full = Image.new("RGBA", (psd.width, psd.height))
        full.paste(pixels, (layer.left, layer.top))
        normalized = full.crop(crop)
        image_name = f"layer-{index:03d}.png"
        normalized.save(target / image_name)
        color_pixels = np.asarray(pixels)
        rgb = color_pixels[color_pixels[:, :, 3] >= 250, :3]
        colors, counts = np.unique(rgb, axis=0, return_counts=True) if len(rgb) else ([], [])
        dominant = "#" + "".join(f"{v:02X}" for v in colors[int(np.argmax(counts))]) if len(colors) else None
        entry = {"id": f"psd-{index:03d}", "name": layer.name, "paintOrder": index,
                 "kind": layer.kind, "visible": layer.visible, "effectiveVisible": layer.is_visible(),
                 "opacity": layer.opacity, "blendMode": "normal", "sourceBounds": list(layer.bbox),
                 "imageUrl": ref(image_name), "imageSha256": digest(target / image_name),
                 "dominantColor": dominant, "interiorColorCount": len(colors)}
        if layer.is_visible():
            assembled = Image.alpha_composite(assembled, normalized)
            assembly_name = f"assembly-{index:03d}.png"
            assembled.save(target / assembly_name)
            entry["assemblyUrl"] = ref(assembly_name)
        layers.append(entry)
    # Never accept a layer order/alpha interpretation that changes the artwork.
    a, b = np.asarray(assembled), np.asarray(artwork)
    error = np.abs(a.astype(int) - b.astype(int))
    # RGB under alpha=0 is invisible and not artwork. Normal integer-alpha
    # compositing can differ by one 8-bit rounding level at antialiased edges.
    visible = (a[:, :, 3] > 0) | (b[:, :, 3] > 0)
    native_error = max(int(error[:, :, 3].max()), int(error[:, :, :3][visible].max()))
    if native_error > 1:
        raise ValueError(f"PSD layer reconstruction differs from native composite: {filename}; max visible error {native_error}")
    # The runtime composite and cumulative previews use the very same renderer;
    # this prevents false seams/order mismatches on a later layer expansion.
    assembled.save(target / "composite.png")
    thumb = assembled.copy()
    thumb.thumbnail((320, 320), Image.Resampling.LANCZOS)
    thumb.save(target / "thumbnail.png")
    return {"schemaVersion": "provided-psd-layers/1", "key": key, "source": original,
            "width": artwork.width, "height": artwork.height, "sourceCrop": list(crop),
            "imageUrl": ref("composite.png"), "imageSha256": digest(target / "composite.png"),
            "thumbnailUrl": ref("thumbnail.png"), "layers": layers, "reconstructionMaxChannelError": 0,
            "nativeCompositeMaxChannelError": native_error}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    generated = ROOT / "assets" / "generated"
    renderer = ROOT / "src" / "renderer" / "src" / "catalog"
    material = generated / "material" / SNAPSHOT
    originals = ROOT / "assets" / "source" / "provided-psd-20261017"
    destinations = [material, originals, generated / "snapshots" / SNAPSHOT,
                    renderer / "snapshots" / f"{SNAPSHOT}.manifest.json"]
    if any(path.exists() for path in destinations):
        raise ValueError("Pack already exists: refuse to overwrite originals or published assets")
    for filename, _ in FILES.values():
        if not (source / filename).is_file():
            raise ValueError(f"Missing source: {filename}")
    # Build all evidence first. No latest pointer is changed until verification.
    material.mkdir(parents=True)
    packs = {}
    for key, (filename, _) in FILES.items():
        packs[key] = extract(source, material, originals, key, filename)
        write_json(material / "provided" / key / "layers.json", packs[key])
        print(f"{key}: {len(packs[key]['layers'])} original layers, exact reconstruction", flush=True)
    manifest = json.loads((generated / "snapshots" / BASE / "assets.manifest.json").read_text(encoding="utf-8"))
    replacements = {asset_id: key for key, (_, asset_id) in FILES.items() if asset_id}
    for asset in manifest["assets"]:
        for field in ["imageUrl", "thumbnailUrl"]:
            ref = asset.get(field)
            if ref:
                old = generated / ref.removeprefix("felt-resource://")
                new_ref = ref.replace(f"/{BASE}/", f"/{SNAPSHOT}/")
                destination = generated / new_ref.removeprefix("felt-resource://")
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(old, destination)
                asset[field] = new_ref
        if asset["assetId"] in replacements:
            key = replacements[asset["assetId"]]
            pack = packs[key]
            # Keep canonical filenames for existing learning-level identities.
            for field, name in [("imageUrl", "composite.png"), ("thumbnailUrl", "thumbnail.png")]:
                shutil.copyfile(material / "provided" / key / name, generated / asset[field].removeprefix("felt-resource://"))
            pack["imageUrl"] = asset["imageUrl"]
            if asset["type"] == "sticker":
                asset["preSplitDataUrl"] = f"felt-resource://material/{SNAPSHOT}/provided/{key}/layers.json"
            asset["contentVersion"] += 1
            asset["source"] = "用户提供 PSD，UI 素材重绘，原始图层保留"
            write_json(material / "provided" / key / "layers.json", pack)
    manifest["assetSnapshotId"] = SNAPSHOT
    manifest["generatedAt"] = "2026-10-17T00:00:00Z"
    manifest["sourcePack"] = f"User-provided PSD pack 2026-10-17; base {BASE}; original hashes and layers: assets/generated/provided-psd-20261017.json"
    manifest["snapshotContext"] = {"snapshots": {SNAPSHOT: [{"assetId": a["assetId"], "type": a["type"]} for a in manifest["assets"]]}}
    write_json(generated / "provided-psd-20261017.json", {"schemaVersion": 1, "snapshotId": SNAPSHOT, "assets": packs})
    update_version_ledger(manifest)
    for destination in [generated / "snapshots" / SNAPSHOT / "assets.manifest.json", renderer / "snapshots" / f"{SNAPSHOT}.manifest.json",
                        generated / "assets.manifest.json", renderer / "assets.manifest.json"]:
        write_json(destination, manifest)
    registry = json.loads((generated / "snapshot-registry.json").read_text(encoding="utf-8"))
    registry["snapshots"][SNAPSHOT] = {"manifest": f"assets/generated/snapshots/{SNAPSHOT}/assets.manifest.json", "generatedAt": manifest["generatedAt"]}
    registry["latestSnapshotId"] = SNAPSHOT
    for destination in [generated / "snapshot-registry.json", renderer / "snapshot-registry.json"]:
        write_json(destination, registry)
    print(f"Published {SNAPSHOT}: four replacements; Fuwa preset preserved separately")


if __name__ == "__main__":
    main()
