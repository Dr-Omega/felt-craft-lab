# felt-craft-lab

不织布儿童美育创作工具（Electron + Vue3 + TypeScript 基线，含组长 AI 服务线）。

## 分支

- 当前工作分支：`feature/material-ai-services`
- 合并目标：`integration/material-library`（Draft PR，勿直接进 `main`）

## 技术栈

- Electron + electron-vite + Vue 3 + TypeScript
- Vitest + electron-builder
- 组长 AI 网关：Flask（`backend/`）

## 包管理器

唯一包管理器：**npm**（Node.js >= 22.12.0）。请只使用 `package-lock.json`。

## 目录映射

```text
src/main/          Electron 主进程与 felt-resource 协议
src/preload/       contextBridge
src/renderer/      Vue3 Renderer
src/shared/        共享契约与 ResourceRef 解析（Contracts 由 XR 维护）
backend/           AI 安全代理：ASR / QA / TTS（组长）
frontend/services/ AudioService / AnimationService（组长交付，供 SXY 调用）
assets/generated/  material / audio 等本地资源（固定语音 → audio/）
docs/              架构与 AI 对接文档
tests/             契约与资源解析测试
```

资源引用协议：`felt-resource:`（见 `docs/architecture/resource-resolver.md`）。  
固定介绍语音正式地址形如：`felt-resource://audio/<file>.mp3`（不再以 `/fixed-audio/...` 作为 Electron 正式对接地址）。

SXY 对接说明：**`docs/ai-services/SXY对接指南.md`**

## 常用命令（完整工程）

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

## AI 后端（组长）本地启动

```bat
cd backend
双击 启动第1步.bat
```

- 健康检查：http://127.0.0.1:8788/api/health  
- 浏览器演示（仅联调辅助）：`/demo/audio`、`/demo/animation`、`/demo/fixed-audio`  
- 密钥：复制 `backend/.env.example` → `backend/.env`（勿提交 `.env`）

## 固定语音

- 批量工具：`backend/批量固定语音第9步.bat`
- 输出目录：`assets/generated/audio/`
- 索引：`assets/generated/audio/audio-index.json`（`url` 为 `felt-resource://audio/...`）
