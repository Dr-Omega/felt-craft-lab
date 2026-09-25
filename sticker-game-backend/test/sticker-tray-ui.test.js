import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("sticker tray scrolls independently without disabling touch scrolling", async () => {
  const styles = await readFile(resolve(PROJECT_ROOT, "public/styles.css"), "utf8");
  const app = await readFile(resolve(PROJECT_ROOT, "public/app.js"), "utf8");

  assert.match(styles, /\.sticker-panel \{[^}]*height:[^}]*overflow: hidden;/);
  assert.match(styles, /\.sticker-tray \{[^}]*overflow-y: auto;/);
  assert.match(styles, /\.sticker-tray \{[^}]*overscroll-behavior: contain;/);
  assert.match(styles, /\.sticker-tray \{[^}]*touch-action: pan-y;/);
  assert.match(styles, /\.sticker-card \{[^}]*touch-action: pan-y;/);
  assert.match(app, /tray\.scrollTop = 0;/);
});
