# SC-05-08 AC-01 至 AC-15 Mock 全流程验收

**任务：** SC-05-08
**状态：** 已完成并通过验收
**范围：** 汇总并执行故事卡的固定 Mock 验收；不新增功能、不接入真实语音识别／故事整理服务、不进行正式 UI 验收。

## 自动执行结果

```powershell
.\node_modules\.bin\vitest.cmd run tests/story-card tests/persistence/story-card-store.test.ts tests/resource/felt-resource-range.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.test.json
.\node_modules\.bin\vue-tsc.cmd --noEmit -p tsconfig.web.json
```

结果：2026-09-25 重新执行后，`32` 个测试文件、`105` 项测试全部通过；Node、测试、Renderer 三组 TypeScript 检查通过。

## AC 逐项证据

| AC | Mock 验收操作与预期 | 自动证据 | 已有人工证据 | 结果 |
| --- | --- | --- | --- | --- |
| AC-01 | 已完成作品进入故事卡测试流程并带入图片、背景、主体、贴纸。 | `story-card-entry.service`、`work-context.adapter`、测试入口／Fixture 测试。 | SC-05-01 通过。 | 通过 |
| AC-02 | 完整录音可开始、暂停、继续、结束、重录；上限为 5 分钟。 | `recording-session.service`、录音资产工作流测试。 | SC-05-02 通过。 | 通过 |
| AC-03 | 完整录音后可补充文字；文字请求关联完整原始音频，纯文字不能首次建卡。 | `manual-text-input.adapter`、`story-processing.service`、录音资产工作流测试。 | SC-05-02 通过。 | 通过 |
| AC-04 | 内容不足不编造故事，返回儿童易懂的补充问题。 | `content-sufficiency.service`、`story-processing.service`、测试处理流程测试。 | SC-05-03 通过。 | 通过 |
| AC-05 | 中文、英文和中英混合输入仅做连贯整理，不翻译或统一语言。 | `speech-recognition.adapter`、`story-rewrite-rules.service`、`story-processing.integration` 测试。 | 不需要额外界面操作。 | 通过 |
| AC-06 | 整理稿不新增未被孩子表达的画面元素、人物或核心事件。 | `story-visual-boundary.service`、`story-processing.integration` 测试。 | 不需要额外界面操作。 | 通过 |
| AC-07 | 不适宜措辞替换为儿童友好中性表达，不新增事实。 | `story-rewrite-rules.service` 测试。 | 不需要额外界面操作。 | 通过 |
| AC-08 | 候选标题／正文可编辑；确认前不是正式卡，确认后保存编辑结果。 | `story-card-editing.service`、`story-card-confirmation.service`、`confirmed-full-recording` 测试。 | SC-05-04 通过。 | 通过 |
| AC-09 | 正式详情仅显示作品图、标题、日期、最终故事和完整原始音频。 | `story-card-detail.service`、`story-card-store` 测试。 | SC-05-05 通过。 | 通过 |
| AC-10 | 故事正文显示区域固定高度，内容可独立滚动。 | 页面受限样式检查。 | SC-05-05 通过。 | 通过 |
| AC-11 | 原始音频可播放／暂停、显示时长并支持拖动跳转。 | 音频播放器辅助、受保护完整录音、资源分段读取测试。 | SC-05-06 通过。 | 通过 |
| AC-12 | 作品图片自动更新，并提供保持故事、完整重录、局部补录三种选择。 | 图片同步、更新决策、阶段 4 组合流程测试。 | SC-05-07 通过。 | 通过 |
| AC-13 | 局部补录确认后更新文本并保持完整原始音频。 | `partial-supplement-flow`、阶段 4 组合流程测试。 | SC-05-07 已验证局部补录候选入口。 | 通过 |
| AC-14 | 完整重录再次确认后替换完整原始音频并覆盖原卡。 | `full-rerecording-flow`、受保护完整录音、阶段 4 组合流程测试。 | SC-05-07 已验证完整重录候选入口。 | 通过 |
| AC-15 | 使用 Mock 完成进入、录音、补充、整理、确认、查看、播放与更新闭环；不验收正式视觉设计。 | 本任务 `32` 个文件、`105` 项全通过。 | SC-05-08 最终串联人工确认通过。 | 通过 |

## 最终人工确认节点

在 Electron 的“故事卡测试”页，用同一件 Mock 已完成作品串联确认：进入流程、完成一段录音、提交文字、生成并确认候选故事、读取详情、播放并拖动原始音频、模拟作品图片更新，并依次查看保持故事、完整重录与局部补录结果。

通过标准：核心操作均可完成；正式故事卡只在“确认这就是我的故事”后写入；测试页始终标识为功能验证页面。

**验证结果：** 通过。2026-09-25 重新自动验收：32 个测试文件、105 项测试全部通过；Node、测试、Renderer 三组 TypeScript 检查通过。Electron 最终人工确认通过：录音、文字补充、候选故事、正式确认、详情查看、音频播放与拖动、作品更新三条选择均可完成；测试页面始终保持功能验证定位。
