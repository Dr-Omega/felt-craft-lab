# SXY 对接指南（组长 AI 服务）

> 目标：你只按本文调用接口 / 服务，**不需要**申请云端密钥、不需要懂 Qwen / DeepSeek / MiniMax。

---

## 0. 正式调用边界（已确认）

1. **Renderer 不直连 Flask**；统一通过 `window.electronAPI.ai.*`（Preload → Main 转发）。
2. 开发：Main → `http://127.0.0.1:8788`；正式：Main → 远端 `FELT_AI_GATEWAY_BASE_URL` / `AI_GATEWAY_BASE_URL`（HTTPS）。Renderer API 一致。
3. 真实 API Key 只在 Gateway 服务端；不进 Electron 安装包。**也不**在 Electron 硬编码永久 Gateway secret。
4. 防滥用：Main 自动用本机 `installationId` 申请短期 Session Token，缓存并在过期前刷新；ASR/QA/TTS 统一携带 `Authorization: Bearer …` + `X-Felt-Installation-Id`。
5. 动态 TTS：Gateway 返回音频字节（`audioBase64`）→ Main 写入 `userData/audio/dynamic/<hash>.mp3` → Renderer 收到 `felt-resource://audio/dynamic/<hash>.mp3`。
6. **不要** `fetch('http://127.0.0.1:8788')`，也**不要**依赖 CORS。保持 `webSecurity: true`。
7. 本 PR **不**新增 `felt-resource://animation` kind。

推荐 Renderer 封装：`src/renderer/src/services/ai.client.ts`。

浏览器 Flask demo（`/demo/*`）仅联调辅助，非正式 Electron 接入路径；demo 客户端也会自动申请 Session Token。

---

## 1. 你负责调用什么？组长负责什么？

| 模块 | 谁实现 | 你怎么用 |
|------|--------|----------|
| 录音按钮 / 画布 / 素材库页 | **你（SXY）** | 自己做 UI |
| ASR / QA / TTS | **组长** | `electronAPI.ai.*` |
| AudioService | **组长** | `play(url)` / `stop()` |
| AnimationService | **组长** | `play('collect'\|'save'\|'loading')`（资源 map 由 YWN 注入；暂无 animation ResourceRef） |

**密钥永远不进前端。**

---

## 2. 推荐业务链路（贴纸问答 · Electron）

```text
录音结束得到 Blob
  → Blob → base64
  → aiClient.asrTranscribe({ audioBase64, mimeType })
  → 若 error.code === ASR_EMPTY_TRANSCRIPT：提示「请再说一次」，禁止进问答
  → 用户确认/修改文字
  → aiClient.qaAsk({ question, asset })
  → 页面先显示 answer 文字（必须）
  → aiClient.ttsSynthesize({ text: answer })
  → AudioService.play(result.audioUrl, 'primary')  // felt-resource://audio/dynamic/...
```

收藏 / 保存 / 加载时：

```text
AnimationService.play('collect' | 'save' | 'loading')  // 需先 setResourceMap
加载结束 → AnimationService.stop('loading')
```

---

## 3. Preload API

```ts
await window.electronAPI.ai.health()

await window.electronAPI.ai.asrTranscribe({
  audioBase64: '...',
  mimeType: 'audio/webm',
  language: 'zh',
  provider: 'mock' // 仅开发
})

await window.electronAPI.ai.qaAsk({
  question: '小兔子可以贴在哪里？',
  asset: { assetId: 'sticker_rabbit_demo', nameZh: '小兔子' },
  provider: 'mock'
})

await window.electronAPI.ai.ttsSynthesize({
  text: '可以贴在草地上。',
  voicePurpose: 'qa_answer',
  provider: 'mock'
})
```

成功时 TTS `result.audioUrl` 形如：

```text
felt-resource://audio/dynamic/<hash>.mp3
```

Mock 固件可能直接返回：

```text
felt-resource://audio/mock-name-zh.wav
```

---

## 4. 无密钥并行：Mock

开发态可在请求里带 `{ "provider": "mock" }`（经 Main 转发）。  
浏览器可临时打开 `http://127.0.0.1:8788/api/*/mock` 看形状，但正式页面必须走 `electronAPI.ai`。

---

## 5. ASR 成功 / 失败形状

成功（冻结 `AsrResult`）：

```json
{
  "ok": true,
  "result": {
    "transcript": "识别出的文字",
    "provider": "qwen_cloud_http",
    "durationMs": 1234,
    "audioDurationMs": 900,
    "requestId": "..."
  }
}
```

空识别为 SharedError：`ASR_EMPTY_TRANSCRIPT`（**不要**再看 `empty` 字段）。

---

## 6. QA

`qaAsk` → `QaResult`：`answer` + 可选 `safetyAction`（`allow|redirect|reject`）。  
`answer` 已是安全处理后的文案。

---

## 7. TTS

- 失败：只显示文字，不致命打断流程  
- 成功：`TtsResult.audioUrl` 必须是 `felt-resource://audio/...`  
- 固定介绍语音（YWN 验收后）：`felt-resource://audio/<id>.mp3`  
- 未验收示例在 `assets/demo/audio/`，不进安装包

---

## 8. AudioService

```ts
import { audioService } from '../services/audio.service'

await audioService.play(ttsResult.audioUrl, 'primary')
audioService.stop('primary')
```

`play()` 仅在真正开始播放时视为成功开始；失败/停止会 settle，不把异常抛到业务层。

---

## 9. 联调门禁

等 PR#11 审查通过（Contracts + Main/Preload 调用链）后再正式接入。保持 Draft 期间可先用 Mock 搭 UI。
