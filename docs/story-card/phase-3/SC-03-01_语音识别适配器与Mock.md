# SC-03-01 语音识别适配器与 Mock

**任务：** SC-03-01  
**状态：** 已实现，待阶段 3 统一验收  
**范围：** 只建立语音识别适配器接口与固定 Mock；不接入真实服务、不写入候选稿或正式故事卡。

## 接口边界

- 输入仅接受阶段 0／阶段 2 定义的音频输入：初始完整录音、完整重录或局部补录。
- 输出仅包含 `workId` 与第一轮中间转写文本；不返回音频引用、临时文件路径、服务商响应或密钥。
- 中间转写仅供后续 `SC-03-03` 编排和 `SC-03-02` 故事整理使用，不能写入正式 `StoryCard`。

## 固定 Mock

Mock 覆盖中文、英文、中英混合和识别超时，文本与阶段 0 `SC-00-07` 的语言样例保持一致。

| 场景 | 返回结果 |
| --- | --- |
| 中文／英文／中英混合完整录音 | 成功，返回原始语言结构的中间转写。 |
| 超时录音 | `ASR_TIMEOUT`，`retryable: true`。 |
| 未配置或空白转写 | `ASR_EMPTY_TRANSCRIPT`，`retryable: false`。 |
| 非音频输入 | `INVALID_ARGUMENT`，`retryable: false`。 |

## 错误码决策

经人工确认，本任务沿用现有共享错误码：识别超时使用 `ASR_TIMEOUT`，空转写使用 `ASR_EMPTY_TRANSCRIPT`；不新增阶段 0 文档中的 `TRANSCRIPTION_FAILED`。

## 验证方法

执行：

```powershell
.\node_modules\.bin\vitest.cmd run tests/story-card/speech-recognition.adapter.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.test.json
.\node_modules\.bin\vue-tsc.cmd --noEmit -p tsconfig.web.json
```

**验证结果：** `vitest run tests/story-card/speech-recognition.adapter.test.ts`：1 个测试文件、3 项通过；`tsc --noEmit -p tsconfig.node.json`、`tsc --noEmit -p tsconfig.test.json` 与 `vue-tsc --noEmit -p tsconfig.web.json` 均通过。
