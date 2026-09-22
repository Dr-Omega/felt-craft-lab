# SC-03-02 故事整理适配器与 Mock

**任务：** SC-03-02  
**状态：** 已实现，待阶段 3 统一验收  
**范围：** 建立故事整理适配器与固定 Mock，输出候选稿；不编排语音识别、不保存正式故事卡、不接入真实模型。

## 输入与输出边界

- 输入由 `workId`、待整理文本和已完成作品上下文构成；作品上下文必须属于同一 `workId`。
- 输出为阶段 0 定义的 `StoryCardDraft`：`ready_for_review`、`needs_more_input` 或 `failed`。
- 输出不会携带第一轮转写、音频引用、临时文件路径、服务商原始响应或密钥。
- `needs_more_input` 是正常结果，不附带错误；正式保存和用户编辑留待阶段 4。

## 固定 Mock 与错误码

- 测试直接复用阶段 0 `SC-00-07_故事处理Mock数据集.json` 的中文、英文、中英混合、内容不足、儿童友好措辞和服务失败样例。
- 经人工确认，故事整理超时使用现有共享错误码 `QA_TIMEOUT`，`retryable: true`；阶段 0 错误契约与 Mock 数据已同步。
- 对未配置的 Mock 输入也返回安全、可重试的 `QA_TIMEOUT`；作品上下文不匹配或空输入返回 `INVALID_ARGUMENT`。

## 验证方法

```powershell
.\node_modules\.bin\vitest.cmd run tests/story-card/story-rewrite.adapter.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.test.json
.\node_modules\.bin\vue-tsc.cmd --noEmit -p tsconfig.web.json
```

**验证结果：** `vitest run tests/story-card/story-rewrite.adapter.test.ts`：1 个测试文件、3 项通过；`tsc --noEmit -p tsconfig.node.json`、`tsc --noEmit -p tsconfig.test.json` 与 `vue-tsc --noEmit -p tsconfig.web.json` 均通过。
