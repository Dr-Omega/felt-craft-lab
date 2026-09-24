import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("all production backgrounds are valid 1024px landscape PNG files", async () => {
  const categories = await readdir(ASSET_ROOT, { withFileTypes: true });
  const backgrounds = [];

  for (const category of categories) {
    if (!category.isDirectory() || category.name.startsWith("_") || category.name === "test_only") continue;
    const directory = resolve(ASSET_ROOT, category.name, "backgrounds");
    let files;
    try {
      files = await readdir(directory);
    } catch {
      continue;
    }
    backgrounds.push(...files.filter((file) => file.endsWith(".png")).map((file) => resolve(directory, file)));
  }

  assert.ok(backgrounds.length >= 22, "expected the complete production background collection");
  for (const file of backgrounds) {
    const header = await readFile(file);
    assert.equal(header.subarray(1, 4).toString("ascii"), "PNG", `${file} is not a PNG file`);
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    assert.equal(width, 1024, `${file} must be 1024px wide`);
    assert.ok(height >= 580 && height <= 586, `${file} has an unexpected aspect ratio`);
  }
});
