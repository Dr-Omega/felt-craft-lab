import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { GameError, GameService } from "./game-service.js";
import { getLevel, listLevels, toPublicLevel } from "./levels.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const PROJECT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ASSET_DIR = process.env.ASSET_DIR
  ? resolve(process.env.ASSET_DIR)
  : resolve(PROJECT_DIR, "../assets/generated");
const CELEBRATION_DIR =
  process.env.CELEBRATION_DIR
    ? resolve(process.env.CELEBRATION_DIR)
    : resolve(PROJECT_DIR, "celebrations");
const gameService = new GameService();

const server = createServer(async (request, response) => {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host ?? HOST}`);
    const path = decodeURIComponent(url.pathname);

    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && path === "/api/levels") {
      sendJson(response, 200, {
        levels: listLevels().map((level) => toPublicLevel(level)),
      });
      return;
    }

    const levelMatch = path.match(/^\/api\/levels\/([^/]+)$/);
    if (request.method === "GET" && levelMatch) {
      const level = getLevel(levelMatch[1]);
      if (!level) {
        throw new GameError(404, "LEVEL_NOT_FOUND", "关卡不存在");
      }
      sendJson(response, 200, { level: toPublicLevel(level) });
      return;
    }

    if (request.method === "POST" && path === "/api/sessions") {
      const body = await readJson(request);
      sendJson(response, 201, gameService.createSession(body.levelId));
      return;
    }

    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionMatch) {
      sendJson(response, 200, gameService.getSession(sessionMatch[1]));
      return;
    }

    const placementMatch = path.match(
      /^\/api\/sessions\/([^/]+)\/placements$/,
    );
    if (request.method === "POST" && placementMatch) {
      const body = await readJson(request);
      sendJson(
        response,
        200,
        gameService.placeSticker(placementMatch[1], body),
      );
      return;
    }

    if (
      ["GET", "HEAD"].includes(request.method) &&
      path.startsWith("/assets/")
    ) {
      serveFile(response, ASSET_DIR, path.slice("/assets/".length));
      return;
    }

    if (
      ["GET", "HEAD"].includes(request.method) &&
      path.startsWith("/celebrations/")
    ) {
      serveFile(
        response,
        CELEBRATION_DIR,
        path.slice("/celebrations/".length),
      );
      return;
    }

    throw new GameError(404, "ROUTE_NOT_FOUND", "接口不存在");
  } catch (error) {
    handleError(response, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Sticker game backend: http://${HOST}:${PORT}`);
});

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) {
      throw new GameError(413, "PAYLOAD_TOO_LARGE", "请求体过大");
    }
  }

  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new GameError(400, "INVALID_JSON", "请求体不是有效 JSON");
  }
}

function serveFile(response, baseDirectory, relativePath) {
  const base = resolve(baseDirectory);
  const filePath = resolve(base, relativePath);
  if (filePath !== base && !filePath.startsWith(`${base}${sep}`)) {
    throw new GameError(403, "INVALID_ASSET_PATH", "资源路径不合法");
  }

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw new GameError(404, "ASSET_NOT_FOUND", "资源不存在");
  }
  if (!stats.isFile()) {
    throw new GameError(404, "ASSET_NOT_FOUND", "资源不存在");
  }

  const contentType =
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".mp4": "video/mp4",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".html": "text/html; charset=utf-8",
    }[extname(filePath).toLowerCase()] ?? "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stats.size,
    "Cache-Control": "no-cache",
  });
  if (response.req?.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function handleError(response, error) {
  if (error instanceof GameError) {
    sendJson(response, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }

  console.error(error);
  sendJson(response, 500, {
    error: { code: "INTERNAL_ERROR", message: "服务器内部错误" },
  });
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
