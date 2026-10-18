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

## 彩色裁片图纸

已保存作品 → 图层展开 → 下一步 → 准备图纸排版 → 导出。用户提供的春节 PSD 直接从各个原始单色层的透明边界读取裁剪轮廓，无需拆分算法；普通图片仅使用与来源一致的现成轮廓，缺失时提示，不自动启动或重试拆分。

导出为彩色色块 A4 多页 PDF，不同颜色共用纸张，按元素及内部制作层序依次排版，同一层的离散裁片保留相对位置并作为一组排列；优先利用已有页面空位，放不下再续页。图层组之间保留 6 mm 操作间距并为编号预留位置，预览与 PDF 都保留对应层的实色、镂空及裁剪边界。默认成品长边 18 cm，可在导出时修改；尺寸作用于全部前景素材组成的整体，各裁片保持同一比例，不独立拉大。图纸仅保留色块与“元素层序-内部制作层序”两级编号，均自下往上；同一制作层只标一次编号。实际背景参与第一层计数，但不作为前景裁片导出；UI 白纸不计层序。

导出页采用透明底的横屏图层预览，按元素及制作层序从左往右排列，所有图层使用共同的显示比例；同层离散裁片保留相对位置，每层只标一次编号。屏幕预览不显示 A4 白纸矩形，实际 PDF 仍使用上述 A4 物理排版。

当前只保留排版，不改变输入轮廓：不自动合并底板、吸收小色块、删除细条或填孔。近期拆分运行策略与手工简化实验尚未获得认可，已独立保留，不属于本次正式集成内容。后续需单独评审后才能重新接入；不得随 PDF 排版一起提交。

画布底色和场景背景不作为裁片。单块超过 A4 排版区域时需减小成品尺寸，不自动单独缩小。打印选“实际大小 / 100%”，关闭“适合页面”；PDF 不添加标题、色号、页码、说明或校准线。现有几何验证状态与实物制作验证状态分别保留。

## 用户提供的春节 PSD 素材

春节「春联大门」引导教学按用户提供的 1686×960 参考图设置三个目标：灯笼左上、红包右侧、饺子左下，位置和尺寸等比缩放。放对并听完讲解后自动推进，三项完成后解锁主题并统一表扬；福娃不参与教学任务，自由创作画布不预放素材。

2026-10-17 的背景、灯笼、饺子、红包已作为新素材快照接入，历史快照与旧作品不覆盖。前景 PSD 可按原始层换色、保存重开并导出彩色裁片 PDF；爆炸图按完整元素与背景展示画布上下顺序，不拆开元素内部颜色层。不覆盖源图、不重新分割或简化图形。五份原始 PSD、全部 24 层（含红包隐藏背景）、层序、坐标及来源哈希保留。

双击 `Start-Felt-Craft-Demo.cmd` 启动演示版：图片生成任意描述固定使用福娃并保留 8 层；问一问、ASR 等非图片接口仍真实调用。普通启动和构建不启用该替换；Demo 开关只在本次进程中设置。范围、使用方式及复现见 [PSD 素材接入记录](docs/PROVIDED_PSD_DEMO_ASSETS.md)。
