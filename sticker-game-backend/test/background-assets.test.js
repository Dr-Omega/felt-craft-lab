import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_ROOT = resolve(fileURLToPath(new URL(
  "../../assets/generated/material/snapshot_ywn_20260925_latest/",
  import.meta.url,
)));

test("all production backgrounds are valid landscape PNG files", async () => {
  const backgrounds = (await readdir(ASSET_ROOT))
    .filter((file) => /^background_.*\.png$/.test(file) && !file.endsWith("_thumb.png"))
    .map((file) => resolve(ASSET_ROOT, file));

  assert.equal(backgrounds.length, 21, "expected the complete production background collection");
  for (const file of backgrounds) {
    const header = await readFile(file);
    assert.equal(header.subarray(1, 4).toString("ascii"), "PNG", `${file} is not a PNG file`);
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    assert.ok(width >= 1024, `${file} must be at least 1024px wide`);
    const aspectRatio = width / height;
    assert.ok(aspectRatio >= 1.74 && aspectRatio <= 1.79, `${file} has an unexpected aspect ratio`);
  }
});
