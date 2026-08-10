# V4.6 Editor UI Capability Gaps

本轮只记录 V4.6 正式编辑器 UI 对当前公开应用层能力的需求差距，不修改
`Shared Contracts`、`SceneDocument`、`FabricEditorAdapter` 或
`EditorSessionService`。缺口以 `BLOCKED_BY_AUTHORIZATION` 或
`TEMP_UI_FALLBACK` 标记，避免通过私有 Fabric 状态、DOM 推断或伪造业务状态绕过边界。

## 1. OQT（选中对象工具）定位与删除

- **当前公开能力**：`EditorSessionService` 暴露 `deleteSelected`、图层操作，
  但没有选中对象事件、对象几何信息、Canvas 屏幕矩形或 selection projection。
- **缺失的最小能力**：只读的 `SelectionProjection`（`objectId`、屏幕坐标、
  角点/旋转柄锚点和可见性）以及 `subscribeSelection(listener)`；删除仍由
  Session 的公开方法执行。
- **应修改的文件（未来任务）**：
  `src/renderer/src/editor/editor-session.types.ts`、
  `src/renderer/src/editor/editor-session.service.ts`，必要时由
  `src/renderer/src/editor/fabric-editor-adapter.ts` 提供适配事件。
- **本轮状态**：`BLOCKED_BY_AUTHORIZATION`。未实现 OQT 浮层、删除按钮或删除
  Toast；其余 Editor UI 不依赖 Fabric 私有实例。

## 2. Dirty 状态与返回门禁

- **当前公开能力**：Session 状态包含编辑、恢复和 pending operation，但没有
  “自上次保存以来是否变化”的公开比较结果，也没有保存基线事件。
- **缺失的最小能力**：`isDirty` 只读字段或等价的变更订阅，并由成功的 Draft/
  Project 保存更新基线；不得由页面比较 Fabric JSON。
- **应修改的文件（未来任务）**：
  `src/renderer/src/editor/editor-session.types.ts`、
  `src/renderer/src/editor/editor-session.service.ts`，以及持久化成功回调的
  Session 编排处。
- **本轮状态**：`TEMP_UI_FALLBACK`。返回作品库时始终显示三选一确认框，
  明确允许保存进度、直接返回或继续编辑；没有把它伪装成真实 dirty 检测。

## 3. Fabric 控件主题化

- **当前公开能力**：Fabric 控件样式由 Adapter/Fabric 实例拥有，Vue 页面不能
  通过正式公开 API 重设边框、角点、旋转柄颜色。
- **缺失的最小能力**：Adapter 构造配置或受控的 `setControlTheme`，仅映射到
  V4.6 token，不改变 SceneDocument。
- **应修改的文件（未来任务）**：
  `src/renderer/src/editor/fabric-editor-adapter.ts` 及其类型声明。
- **本轮状态**：`BLOCKED_BY_AUTHORIZATION`。本轮不改 Fabric 控件配置，保留
  现有交互与行为回归。

## 4. Undo/Redo 可用性投影

- **当前公开能力**：Session 公开 `undo()` / `redo()`，但 `SessionState` 未暴露
  `canUndo` / `canRedo`。
- **缺失的最小能力**：只读布尔值或等价的历史状态订阅，用于让 Dock 在无历史
  时禁用按钮；不能让 UI 读取 Fabric history。
- **应修改的文件（未来任务）**：
  `src/renderer/src/editor/editor-session.types.ts`、
  `src/renderer/src/editor/editor-session.service.ts`。
- **本轮状态**：`BLOCKED_BY_AUTHORIZATION`。Dock 调用既有公开命令并保持可见，
  没有猜测或复制历史状态。

## 5. 资源分类筛选

当前 `AssetRecord` 没有 category 字段，且 V4.6 要求严格使用对应快照目录。
因此本轮只显示真实目录的“全部”筛选，不添加动物、植物等伪造分类，也不改变
快照或解锁规则。状态：`CATEGORY_SOURCE_NOT_AVAILABLE`。

## 本轮完成边界

除上述明确标记的能力差距外，V4.6 UI Shell 已通过公开 Session、Catalog、
Persistence API 接入；没有直接持有 Fabric 实例、访问私有字段、读取 DOM 推断
业务状态或修改冻结 Contracts。正式验收报告必须分别列出这些缺口，而不能将它们
记为 UI 通过项。
