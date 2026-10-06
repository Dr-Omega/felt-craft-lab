import assert from "node:assert/strict";
import test from "node:test";

import { GameError, GameService } from "../src/game-service.js";

function createService() {
  return new GameService({ createId: () => "session-001", random: () => 0 });
}

test("creates a fresh session with all stickers incomplete", () => {
  const session = createService().createSession("mid-autumn-lake-001");

  assert.equal(session.playSessionId, "session-001");
  assert.equal(session.allFinished, false);
  assert.equal(session.celebration, null);
  assert.ok(session.level.stickers.every((sticker) => !sticker.isCompleted));
});

test("does not change state for an out-of-bound placement", () => {
  const service = createService();
  service.createSession("mid-autumn-lake-001");

  const result = service.placeSticker("session-001", {
    stickerId: "sticker_moon_001",
    x: -1,
    y: 100,
  });

  assert.equal(result.success, false);
  assert.equal(result.outOfBound, true);
  assert.equal(result.isCompleted, false);
});

test("accepts target tolerance and makes completed placement idempotent", () => {
  const service = createService();
  service.createSession("mid-autumn-lake-001");

  const first = service.placeSticker("session-001", {
    stickerId: "sticker_moon_001",
    x: 161,
    y: 86,
  });
  const repeated = service.placeSticker("session-001", {
    stickerId: "sticker_moon_001",
    x: 900,
    y: 500,
  });

  assert.equal(first.success, true);
  assert.equal(first.alreadyCompleted, false);
  assert.equal(repeated.success, true);
  assert.equal(repeated.alreadyCompleted, true);
  assert.equal(repeated.isCompleted, true);
});

test("chooses and persists one celebration when the final sticker lands", () => {
  const service = createService();
  service.createSession("mid-autumn-lake-001");

  service.placeSticker("session-001", {
    stickerId: "sticker_moon_001",
    x: 240,
    y: 170,
  });
  service.placeSticker("session-001", {
    stickerId: "sticker_rabbit_001",
    x: 428,
    y: 205,
  });
  const finished = service.placeSticker("session-001", {
    stickerId: "sticker_mooncake_001",
    x: 615,
    y: 455,
  });
  const repeated = service.placeSticker("session-001", {
    stickerId: "sticker_mooncake_001",
    x: 0,
    y: 0,
  });

  assert.equal(finished.allFinished, true);
  assert.equal(finished.justFinished, true);
  assert.equal(finished.celebration.assetId, "amazing_animation");
  assert.equal(repeated.allFinished, true);
  assert.equal(repeated.justFinished, false);
  assert.deepEqual(repeated.celebration, finished.celebration);
});

test("rejects non-finite coordinates and unknown stickers", () => {
  const service = createService();
  service.createSession("mid-autumn-lake-001");

  assert.throws(
    () =>
      service.placeSticker("session-001", {
        stickerId: "sticker_moon_001",
        x: Number.NaN,
        y: 100,
      }),
    (error) =>
      error instanceof GameError && error.code === "INVALID_COORDINATES",
  );

  assert.throws(
    () =>
      service.placeSticker("session-001", {
        stickerId: "unknown",
        x: 100,
        y: 100,
      }),
    (error) => error instanceof GameError && error.code === "STICKER_NOT_FOUND",
  );
});
