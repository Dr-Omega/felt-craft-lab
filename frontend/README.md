# 前端 Demo（Flask 浏览器联调）

> **正式 AudioService / AnimationService** 在 Electron renderer：`src/renderer/src/services/`  
> 本目录下的 `.js` 与 HTML demo 仅供 Flask 浏览器联调，不参与 Electron 打包。

完整对接说明请看：`docs/ai-services/SXY对接指南.md`

## 固定语音快照

- 正式 ResourceRef：`felt-resource://audio/...`
- 输出目录：`assets/generated/audio/`
- 索引：`assets/generated/audio/audio-index.json`
- 浏览器辅助试听：http://127.0.0.1:8788/demo/fixed-audio
- 工具说明：`docs/ai-services/固定TTS批量工具.md`
- 播放地址转换（正式）：`src/renderer/src/services/audio-url.ts`

## FeltAiClient（浏览器 demo 可选）

- `frontend/services/felt-ai.client.js`（仅 demo / 无打包）

正式客户端封装若需要，应放在 `src/renderer/src/services/` 并由根工程构建。

## AudioService demo（第 6 步）

正式实现：`src/renderer/src/services/audio.service.ts`

Demo 脚本（浏览器无打包）：
- `frontend/services/audio.service.js`

演示：http://127.0.0.1:8788/demo/audio

## AnimationService demo（第 7 步）

正式实现：`src/renderer/src/services/animation.service.ts`（空映射，YWN 注入）

Demo 脚本（含 CDN 示例 Lottie，仅 demo）：
- `frontend/services/animation.service.js`

演示：http://127.0.0.1:8788/demo/animation
