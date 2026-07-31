# 前端技术封装（组长）

完整对接说明请看：`docs/ai-services/SXY对接指南.md`

## 固定语音快照

- 正式 ResourceRef：`felt-resource://audio/...`
- 输出目录：`assets/generated/audio/`
- 索引：`assets/generated/audio/audio-index.json`
- 浏览器辅助试听：http://127.0.0.1:8788/demo/fixed-audio
- 工具说明：`docs/ai-services/固定TTS批量工具.md`
- 播放地址转换：`frontend/services/audio-url.ts`（与 ResourceRef / felt-resource 兼容）

## FeltAiClient（第 8 步，可选）

路径：
- `frontend/services/felt-ai.client.ts`
- `frontend/services/felt-ai.client.js`

封装 ASR / QA / TTS 的 `fetch` 调用，避免手写 URL。

## AudioService（第 6 步）

路径：
- `frontend/services/audio.service.ts`（给正式工程引用）
- `frontend/services/audio.service.js`（demo / 无打包环境）

接口：

```ts
play(url: string, channel?: 'primary' | 'effect'): Promise<void>
stop(channel?: 'primary' | 'effect'): void
setEffectsEnabled(enabled: boolean): void
```

规则：
- 新的 `primary` 会先停旧的 `primary`
- `effect` 不打断 `primary`
- 播放失败只打日志，不抛错（文字仍可显示）

## AnimationService（第 7 步）

路径：
- `frontend/services/animation.service.ts`
- `frontend/services/animation.service.js`

接口：

```ts
play(eventKey: string, target?: HTMLElement): Promise<void>
stop(eventKey?: string): void
```

预置 eventKey：`collect` / `save` / `loading`  
演示：http://127.0.0.1:8788/demo/animation
