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

Windows 本地完整启动（含网关、桌面及算法路径检查）：先按 [本地配置说明](docs/LOCAL_TEST_SETUP.md) 完成首次安装，再双击根目录 `Start-Felt-Craft.cmd`。更新代码不要覆盖自己的 `backend/.env`、`.env.local` 和持久数据；密钥、Python 环境与模型不随 GitHub 分发。

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

## 首次登录引导

新账号首次登录后自动开始聚光引导，点击“下一步”浏览大厅、当前创作工具、分享、学习、小熊家和个人作品；不打开旧版创作库或维护工具，不生成体验草稿。可随时跳过，完成或跳过后按账号保存状态；个人中心“账号”页可重看。已有账号升级时默认不弹出。后端暂时离线时保留本机该账号的完成标记，下次登录重试同步。

## 同色裁片图纸

已保存作品 → 图层展开 → 下一步 → 准备图纸排版 → 导出。仅使用与素材来源一致的现成分层数据；缺失分层时提示，不自动启动或重试拆分算法。PSD 原有图层的接入待素材提供后单独验证。

导出为 A4 多页 PDF，同色裁片集中排版、放不下续页。成品尺寸作用于全部前景素材组成的整体，各裁片保持同一比例；具体宽高按等比例外框适配。编号标注元素及拼贴步。

当前只保留排版，不改变输入轮廓：不自动合并底板、吸收小色块、删除细条或填孔。近期拆分运行策略与手工简化实验尚未获得认可，已独立保留，不属于本次正式集成内容。后续需单独评审后才能重新接入；不得随 PDF 排版一起提交。

画布底色和场景背景不作为裁片。单块超过 A4 可打印区域时需减小成品尺寸，不自动单独缩小。打印选“实际大小 / 100%”，关闭“适合页面”，先用尺核对每页 50 mm 校准线。现有几何验证状态与实物制作验证状态分别保留。
