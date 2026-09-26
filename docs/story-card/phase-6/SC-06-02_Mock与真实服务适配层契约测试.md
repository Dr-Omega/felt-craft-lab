# SC-06-02 Mock 与真实服务适配层契约测试

## 任务目标

验证 Mock 与真实服务网关适配层在成功和可重试失败时，返回一致的领域数据结构与错误形态。

## 修改范围

- 复核 `tests/story-card/speech-recognition.adapter.test.ts`
- 复核 `tests/story-card/story-rewrite.adapter.test.ts`
- 不修改业务代码；现有测试已经直接比较 Mock 与网关适配器的结果，重复新增同类测试没有额外价值。

## 契约覆盖

| 能力 | 成功结果 | 可重试失败结果 | 结论 |
| --- | --- | --- | --- |
| 语音识别 | Mock 与网关适配器返回相同的 `SpeechRecognitionResult` | 两者返回相同的 `ASR_TIMEOUT` 错误结构 | 已覆盖 |
| 故事整理 | Mock 与网关适配器返回相同的 `StoryCardDraft` | 两者返回相同的 `story-rewrite-failed` 错误结构 | 已覆盖 |

补充边界已由现有测试覆盖：语音识别空文本、网关错误映射、整理结果格式错误，以及 `needs_more_input` 候选故事。

## 验证方式

```powershell
npx.cmd vitest run tests/story-card/speech-recognition.adapter.test.ts tests/story-card/story-rewrite.adapter.test.ts
npm.cmd run typecheck
```

## 人工确认

本任务为自动化适配层契约检查，无人工确认节点。
