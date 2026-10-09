import { randomUUID } from "node:crypto";

import { chooseCelebration } from "./celebrations.js";
import { getLevel, toPublicLevel } from "./levels.js";

export class GameError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "GameError";
    this.status = status;
    this.code = code;
  }
}

export class GameService {
  constructor({ createId = randomUUID, random = Math.random } = {}) {
    this.sessions = new Map();
    this.createId = createId;
    this.random = random;
  }

  createSession(levelId) {
    const level = requireLevel(levelId);
    const now = new Date().toISOString();
    const session = {
      playSessionId: this.createId(),
      levelId,
      completedStickerIds: new Set(),
      allFinished: false,
      celebration: null,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.playSessionId, session);
    return this.toPublicSession(session, level);
  }

  getSession(playSessionId) {
    const session = this.sessions.get(playSessionId);
    if (!session) {
      throw new GameError(404, "SESSION_NOT_FOUND", "游戏实例不存在或已失效");
    }

    return this.toPublicSession(session, requireLevel(session.levelId));
  }

  deleteSession(playSessionId) {
    this.sessions.delete(playSessionId);
  }

  placeSticker(playSessionId, input) {
    const session = this.sessions.get(playSessionId);
    if (!session) {
      throw new GameError(404, "SESSION_NOT_FOUND", "游戏实例不存在或已失效");
    }

    const level = requireLevel(session.levelId);
    const { stickerId, x, y } = validatePlacement(input);
    const sticker = level.stickers.find((item) => item.stickerId === stickerId);
    if (!sticker) {
      throw new GameError(404, "STICKER_NOT_FOUND", "贴纸不属于当前关卡");
    }

    if (session.completedStickerIds.has(stickerId)) {
      return placementResult({
        session,
        stickerId,
        success: true,
        alreadyCompleted: true,
        isCompleted: true,
      });
    }

    if (!contains(level.canvasBounds, x, y)) {
      return placementResult({
        session,
        stickerId,
        success: false,
        outOfBound: true,
      });
    }

    if (!contains(expand(sticker.targetArea, sticker.tolerance), x, y)) {
      return placementResult({ session, stickerId, success: false });
    }

    session.completedStickerIds.add(stickerId);
    session.updatedAt = new Date().toISOString();

    const justFinished =
      !session.allFinished &&
      level.stickers.every((item) =>
        session.completedStickerIds.has(item.stickerId),
      );

    if (justFinished) {
      session.allFinished = true;
      session.celebration = chooseCelebration(this.random);
    }

    return placementResult({
      session,
      stickerId,
      success: true,
      isCompleted: true,
      justFinished,
    });
  }

  toPublicSession(session, level) {
    return {
      playSessionId: session.playSessionId,
      level: toPublicLevel(level, session.completedStickerIds),
      allFinished: session.allFinished,
      celebration: session.celebration,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}

function requireLevel(levelId) {
  const level = getLevel(levelId);
  if (!level) {
    throw new GameError(404, "LEVEL_NOT_FOUND", "关卡不存在");
  }
  return level;
}

function validatePlacement(input) {
  if (!input || typeof input !== "object") {
    throw new GameError(400, "INVALID_REQUEST", "请求体必须是 JSON 对象");
  }

  const stickerId = input.stickerId;
  const x = input.x;
  const y = input.y;
  if (typeof stickerId !== "string" || stickerId.trim() === "") {
    throw new GameError(400, "INVALID_STICKER_ID", "stickerId 不能为空");
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new GameError(400, "INVALID_COORDINATES", "x 和 y 必须是有限数字");
  }

  return { stickerId, x, y };
}

function contains(bounds, x, y) {
  return (
    x >= bounds.minX &&
    x <= bounds.maxX &&
    y >= bounds.minY &&
    y <= bounds.maxY
  );
}

function expand(area, tolerance) {
  return {
    minX: area.minX - tolerance,
    minY: area.minY - tolerance,
    maxX: area.maxX + tolerance,
    maxY: area.maxY + tolerance,
  };
}

function placementResult({
  session,
  stickerId,
  success,
  outOfBound = false,
  alreadyCompleted = false,
  isCompleted = false,
  justFinished = false,
}) {
  return {
    playSessionId: session.playSessionId,
    levelId: session.levelId,
    stickerId,
    success,
    outOfBound,
    alreadyCompleted,
    isCompleted,
    allFinished: session.allFinished,
    justFinished,
    celebration: session.celebration,
  };
}
