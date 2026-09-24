import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listLevels } from "../src/levels.js";

const ASSET_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("catalog exposes 21 valid levels grouped into 15 themes", async () => {
  const levels = listLevels();
  assert.equal(levels.length, 21);
  assert.equal(new Set(levels.map((level) => level.levelId)).size, levels.length);
  assert.equal(new Set(levels.map((level) => level.themeId)).size, 15);

  for (const level of levels) {
    assert.ok(level.themeId);
    assert.ok(level.themeName);
    assert.ok(level.stickers.length >= 2);
    await access(assetPath(level.backgroundAssetUrl));

    for (const sticker of level.stickers) {
      await access(assetPath(sticker.stickerAssetUrl));
      assert.ok(sticker.targetArea.minX >= level.canvasBounds.minX);
      assert.ok(sticker.targetArea.minY >= level.canvasBounds.minY);
      assert.ok(sticker.targetArea.maxX <= level.canvasBounds.maxX);
      assert.ok(sticker.targetArea.maxY <= level.canvasBounds.maxY);
      assert.ok(sticker.placeholder.x >= level.canvasBounds.minX);
      assert.ok(sticker.placeholder.y >= level.canvasBounds.minY);
      assert.ok(sticker.placeholder.x + sticker.placeholder.width <= level.canvasBounds.maxX);
      assert.ok(sticker.placeholder.y + sticker.placeholder.height <= level.canvasBounds.maxY);
    }
  }
});

function assetPath(assetUrl) {
  return resolve(ASSET_ROOT, assetUrl.replace(/^\/assets\//, ""));
}
