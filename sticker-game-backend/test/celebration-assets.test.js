import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CELEBRATIONS } from "../src/celebrations.js";

const CELEBRATION_ROOT = resolve(fileURLToPath(new URL("../celebrations/", import.meta.url)));

test("all configured celebration videos are committed with the game", async () => {
  const files = (await readdir(CELEBRATION_ROOT)).filter((file) => file.endsWith(".mp4")).sort();
  const configuredFiles = CELEBRATIONS
    .map((item) => item.assetUrl.replace("/celebrations/", ""))
    .sort();

  assert.deepEqual(files, configuredFiles);
  assert.equal(files.length, 6);
  await Promise.all(files.map((file) => access(resolve(CELEBRATION_ROOT, file))));
});
