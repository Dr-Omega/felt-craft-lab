# SC-05-01 测试入口与 Mock 作品上下文

**任务：** SC-05-01
**状态：** 已完成
**范围：** 提供故事卡测试入口与一个完成作品的 Mock 上下文；不实现录音、转写、候选稿、正式确认、音频播放或正式视觉设计。

## 实现内容

- 顶部导航新增“故事卡测试”入口，进入极简测试页。
- Mock 作品固定为已完成状态，包含作品 ID、图片引用、背景、主体与贴纸。
- 点击“进入故事卡测试流程”后仅显示已进入提示，明确后续功能尚未在本任务实现。

## 验证方法

### 自动验证

```powershell
.\node_modules\.bin\vitest.cmd run tests/story-card/story-card-test-fixtures.test.ts tests/story-card/story-card-test-entry.navigation.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.test.json
.\node_modules\.bin\vue-tsc.cmd --noEmit -p tsconfig.web.json
```

### 人工确认节点

1. 在仓库根目录运行 `npm.cmd run dev`。
2. 在应用顶部点击“故事卡测试”。
3. 确认页面展示 Mock 完成作品信息；点击“进入故事卡测试流程”后出现已进入提示。
4. 确认页面没有录音、转写、候选稿、确认或音频播放控件。

**验证结果：** 自动验证通过：Vitest 2 个测试文件、2 项测试通过；Node、测试、Renderer 三组 TypeScript 类型检查均通过。人工确认通过：已在 Electron 应用中打开“故事卡测试”页面，确认 Mock 上下文和进入提示可见，且未出现后续阶段控件。
