# felt-craft-lab

不织布儿童美育创作工具（Electron + Vue3 + TypeScript 基线，含组长 AI 服务线）。

## 技术栈

- Electron + electron-vite + Vue 3 + TypeScript
- Vitest + electron-builder
- AI Gateway：Flask（`backend/`，开发本机 / 正式远端；不打进 Electron 安装包）

## 包管理器

唯一包管理器：**npm**（Node.js >= 22.12.0）。请只使用 `package-lock.json`。

## 目录映射

```text
src/main/          Electron 主进程、felt-resource、AI Gateway 代理
src/preload/       contextBridge（含 electronAPI.ai.*）
src/renderer/      Vue3 Renderer（经 Preload 调 AI，不直连 Flask）
src/shared/        共享契约与 ResourceRef 解析（Contracts 由 XR 维护）
backend/           AI 安全代理：ASR / QA / TTS（远端 Gateway / 本地开发）
src/renderer/src/services/  正式 AudioService / AnimationService / ai.client
frontend/                  Flask 浏览器 demo（非正式打包入口）
assets/generated/  正式打包资源（material / audio 固件）
assets/demo/       联调示例（不进入 electron-builder extraResources）
docs/              架构与 AI 对接文档
tests/             契约与资源解析测试
```

资源引用协议：`felt-resource:`（见 `docs/architecture/resource-resolver.md`）。  
固定介绍语音：`felt-resource://audio/<file>.mp3`  
动态 TTS（Main 落盘）：`felt-resource://audio/dynamic/<hash>.mp3`

SXY 对接说明：**`docs/ai-services/SXY对接指南.md`**  
分支 / PR 状态请看对应 Pull Request 或 `docs/ai-services/`，勿在本 README 写死当前分支。

## 常用命令（完整工程）

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

## AI Gateway（开发）

```bat
cd backend
双击 启动第1步.bat
```

- 健康检查：http://127.0.0.1:8788/api/health  
- Electron Main 默认转发到上述地址；正式环境设置 `AI_GATEWAY_BASE_URL` 指向远端 Gateway  
- Renderer 只调用 `window.electronAPI.ai.*`（保持 `webSecurity: true`，无 CORS 直连）  
- 密钥：复制 `backend/.env.example` → `backend/.env`（勿提交 `.env`）  
- 本仓库 **不** 把 Python/Flask 打进 Windows 安装包；正式验收验证 Main 可连接配置的远端 Gateway

## 固定语音

- 批量工具：`backend/批量固定语音第9步.bat`
- 验收后输出：`assets/generated/audio/` + `audio-index.json`
- 未验收示例：`assets/demo/audio/`（不打包）
