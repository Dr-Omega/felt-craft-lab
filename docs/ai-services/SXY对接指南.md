# SXY 对接指南（组长 AI 服务）

> 目标：你只按本文调用接口 / 服务，**不需要**申请云端密钥、不需要懂 Qwen / DeepSeek / MiniMax。  
> 本地基址（组长本机或联调机）：`http://127.0.0.1:8788`

---

## 0. 先确认后端活着

浏览器打开：

```text
http://127.0.0.1:8788/api/health
```

看到 `"ok": true` 即可联调。

准备度：

```text
http://127.0.0.1:8788/api/ready
```

---

## 1. 你负责调用什么？组长负责什么？

| 模块 | 谁实现 | 你怎么用 |
|------|--------|----------|
| 录音按钮 / 画布 / 素材库页 | **你（SXY）** | 自己做 UI |
| ASR / QA / TTS 后端 | **组长** | 发 HTTP 请求 |
| AudioService | **组长** | `play(url)` / `stop()` |
| AnimationService | **组长** | `play('collect'\|'save'\|'loading')` |

**密钥永远不进前端。** 不要把任何 `sk-` / API Key 写进页面。

---

## 2. 推荐业务链路（贴纸问答）

```text
录音结束得到 Blob
  → POST /api/asr/transcribe
  → 若 empty=true：提示「请再说一次」，禁止进问答
  → 用户确认/修改文字
  → POST /api/qa/ask（带当前贴纸 asset）
  → 页面先显示 answer 文字（必须）
  → POST /api/tts/synthesize
  → AudioService.play(audioUrl, 'primary')
```

收藏 / 保存 / 加载时：

```text
AnimationService.play('collect' | 'save' | 'loading')
加载结束 → AnimationService.stop('loading')
```

---

## 3. 无密钥并行：先用 Mock

联调初期、或组长机器没开真 Key 时，用下面地址（浏览器可直接打开）：

| 用途 | 方法 | 地址 |
|------|------|------|
| ASR Mock | GET | `/api/asr/mock` |
| QA Mock | GET | `/api/qa/mock` |
| TTS Mock | GET | `/api/tts/mock` |

正式请求里也可临时指定：

```json
{ "provider": "mock" }
```

适用于：`/api/asr/transcribe`、`/api/qa/ask`、`/api/tts/synthesize`。

---

## 4. ASR（语音转文字）

### 4.1 正式：上传录音（推荐）

`POST /api/asr/transcribe`  
`Content-Type: multipart/form-data`

| 字段 | 必填 | 说明 |
|------|------|------|
| `file`（或 `audio`） | 是 | 音频文件 Blob |
| `language` | 否 | 如 `zh` |
| `sessionId` | 否 | 会话追踪 |
| `provider` | 否 | `qwen_cloud_http` / `mock` |

### 4.2 成功返回（固定字段）

```json
{
  "ok": true,
  "provider": "qwen_cloud_http",
  "result": {
    "transcript": "识别出的文字",
    "provider": "qwen_cloud_http",
    "durationMs": 0,
    "latencyMs": 1234,
    "empty": false
  }
}
```

**产品规则：** `result.empty === true` 时，**不得**把文本交给 DeepSeek，应提示重说。

### 4.3 失败返回

```json
{
  "ok": false,
  "error": {
    "code": "ASR_NETWORK_ERROR",
    "message": "……",
    "retryable": true
  },
  "latencyMs": 0
}
```

`retryable === true` 时可提示「再试一次」。  
完整契约：`GET /api/asr/contract`

---

## 5. QA（儿童问答）

`POST /api/qa/ask`  
`Content-Type: application/json`

```json
{
  "question": "小兔子喜欢吃什么？",
  "asset": {
    "assetId": "sticker_rabbit_demo",
    "nameZh": "小兔子",
    "introZh": "圆耳朵、短尾巴的可爱兔子贴纸……",
    "themeId": "nature_spring"
  }
}
```

成功：

```json
{
  "ok": true,
  "result": {
    "answer": "……适合小朋友的回答……",
    "safetyAction": "allow",
    "requestId": "…",
    "latencyMs": 800
  }
}
```

`safetyAction` 可能为：`allow` | `redirect` | `reject`  
（`redirect` / `reject` 时，`answer` 仍可能是温和提示语，直接展示即可。）

契约：`GET /api/qa/contract`  
冒烟：`GET /api/qa/smoke-test`

---

## 6. TTS（文字转语音）

`POST /api/tts/synthesize`  
`Content-Type: application/json`

```json
{
  "text": "要朗读的文字",
  "voicePurpose": "qa_answer"
}
```

成功：

```json
{
  "ok": true,
  "result": {
    "audioUrl": "/api/tts/audio/xxxx.mp3",
    "cacheHit": false,
    "requestId": "…",
    "latencyMs": 600
  }
}
```

把 `audioUrl` 交给 AudioService。若是相对路径，拼上基址：

```text
http://127.0.0.1:8788` + audioUrl
```

**产品规则：** TTS 失败时**仍显示文字回答**，不要整页报错。  
契约：`GET /api/tts/contract`

---

## 7. AudioService（前端封装）

文件：

- `frontend/services/audio.service.ts`（工程引用）
- `frontend/services/audio.service.js`（无打包 demo）

依赖：页面先引入 [Howler](https://cdn.jsdelivr.net/npm/howler@2.2.4/dist/howler.min.js)

```js
const audio = new HowlerAudioService();

// 问答朗读（会打断上一段朗读）
await audio.play(fullAudioUrl, 'primary');

// 轻操作音效（不打断朗读；可被总开关关掉）
await audio.play(clickMp3Url, 'effect');

audio.setEffectsEnabled(false);
audio.stop('primary');
```

演示页：`http://127.0.0.1:8788/demo/audio`

---

## 8. AnimationService（前端封装）

文件：

- `frontend/services/animation.service.ts`
- `frontend/services/animation.service.js`

依赖：`lottie-web`（demo 已用 CDN）

```js
const anim = new LottieAnimationService();

await anim.play('collect');  // 收藏
await anim.play('save');     // 保存
await anim.play('loading');  // 循环，需手动停
anim.stop('loading');
```

正式 Lottie 资源由 **YWN** 交付后，组长/你方可替换映射表；你不必解析 Lottie JSON。

演示页：`http://127.0.0.1:8788/demo/animation`

---

## 9. 联调检查清单（发给自己勾）

- [ ] `/api/health` 为 ok  
- [ ] 先打通三条 Mock：asr / qa / tts  
- [ ] 录音 → ASR → 处理 `empty`  
- [ ] 带 `asset` 调 QA → 先显示文字  
- [ ] TTS → AudioService `primary` 播放  
- [ ] 收藏/保存/加载调 AnimationService  
- [ ] 前端无任何真实 API Key  

---

## 10. 有问题找谁

| 现象 | 找谁 |
|------|------|
| 接口 502 / 密钥 / 延迟指标 | **组长** |
| 录音按钮、素材页、画布 UI | **SXY** |
| Fabric 编辑器行为 | **XR** |
| 正式 Lottie / 视觉资源 | **YWN** |
