# Fabric 开源编辑器复用评估

> 评估日期：2026-07-31  
> 项目基线：`integration/material-library@e7e46503982493827a441024bb6e946e884a77be`  
> 工作分支：`feature/material-library/fabric-reuse-spike`  
> 性质：只读上游分析与隔离 PoC，不是正式编辑器实现，也不冻结最终路线。

## 1. 结论摘要

明确推荐路线 C：**只引入 Fabric.js，并参考上游实现建立本项目自己的轻量适配层**。

证据如下：

- Fabric 5.3.0 已在本项目实际使用的 Vue 3.5.40、TypeScript 5.9.3、Vite 7.3.6、Electron 43.2.0 组合中完成隐藏窗口实测，核心能力全部通过。
- 两个候选项目都把 Fabric JSON 当作主要编辑数据，且都把 `workspace` 作为 Fabric 对象写入历史或 JSON；这与 `SceneDocument` 是唯一真实数据源、背景层 `zIndex=0`、贴纸从 1 连续排列的约束不一致。
- `vue-fabric-editor/packages/core` 虽然名为 core，仍绑定 DOM `#workspace`、全局 Fabric prototype、`hotkeys-js`、右键菜单、`tapable` hooks、远程素材接口和大量非本项目功能。
- `electron-fabric-editor` 的编辑器核心直接放在 `apps/web/src/lib/core`，同时绑定 Pinia、Element Plus、路径别名和它自己的 Electron monorepo；其 Main/Preload 边界也不应替换本项目现有的窄 IPC 与 `felt-resource` 安全边界。
- 路线 C 的总代码量会比复制一个插件少，但需要自主实现 Scene 映射、资源加载、历史记录和交互约束。这些部分恰好是本项目必须掌控的业务边界。

建议只把上游的小型算法当作设计参考，不直接复制完整插件框架、UI 或 Electron 外壳。最终路线仍需 ZXR 确认。

## 2. 上游版本与许可证据

### 2.1 ikuaitu/vue-fabric-editor

- 仓库：[`ikuaitu/vue-fabric-editor`](https://github.com/ikuaitu/vue-fabric-editor)
- 本次固定 Commit：[`b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889`](https://github.com/ikuaitu/vue-fabric-editor/commit/b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889)
- 默认分支：`main`
- 根 [`LICENSE`](https://github.com/ikuaitu/vue-fabric-editor/blob/b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889/LICENSE)：MIT，`Copyright (c) 2022 秦少卫`。
- 根 [`package.json`](https://github.com/ikuaitu/vue-fabric-editor/blob/b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889/package.json) 未声明 `license` 字段，但 README 明确链接根 MIT License。
- 被评估目录 [`packages/core/package.json`](https://github.com/ikuaitu/vue-fabric-editor/blob/b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889/packages/core/package.json) 声明 `license: ISC`，目录内没有单独的 ISC LICENSE 文本。
- 多个被评估源文件保留 `@Author: 秦少卫`、日期和其他贡献者头注释。

许可处理结论：根 MIT 与 `packages/core` 的 ISC 元数据存在不一致。若未来逐字复制任何 `packages/core` 文件，必须先确认适用许可；至少保留根 MIT 全文、`Copyright (c) 2022 秦少卫` 和原文件作者头。未确认前只参考行为和算法，不复制表达性实现。

### 2.2 Qiu-Jun/electron-fabric-editor

- 仓库：[`Qiu-Jun/electron-fabric-editor`](https://github.com/Qiu-Jun/electron-fabric-editor)
- 本次固定 Commit：[`854d57d19422098b824b5ab3cc42d4acfb72f3b6`](https://github.com/Qiu-Jun/electron-fabric-editor/commit/854d57d19422098b824b5ab3cc42d4acfb72f3b6)
- 默认分支：`main`
- 根目录没有 `LICENSE` 文件。
- 根 [`package.json`](https://github.com/Qiu-Jun/electron-fabric-editor/blob/854d57d19422098b824b5ab3cc42d4acfb72f3b6/package.json) 声明 `license: MIT`，作者为 June / Qiu-Jun。
- [`apps/electron/package.json`](https://github.com/Qiu-Jun/electron-fabric-editor/blob/854d57d19422098b824b5ab3cc42d4acfb72f3b6/apps/electron/package.json) 声明 MIT，但作者与 repository 指向 `buqiyuan/electron-vite-monorepo`。
- [`apps/web/package.json`](https://github.com/Qiu-Jun/electron-fabric-editor/blob/854d57d19422098b824b5ab3cc42d4acfb72f3b6/apps/web/package.json) 没有 `license` 字段。
- README 明确称其为 `vue-fabric-editor` 的 Electron 版本；`apps/web/src/lib/core` 多数文件仍保留秦少卫等人的作者头。

许可处理结论：只有 package 元数据，没有根许可正文，且 Electron 外壳和编辑器代码来源不同。不能把整个仓库或 `apps/web/src/lib/core` 视为具有单一、清晰的版权声明。若未来复制文件，需要同时追溯 `vue-fabric-editor` 原文件和 Electron 脚手架来源；本轮不复制。

### 2.3 Fabric.js 5.3.0

- npm 版本：`fabric@5.3.0`
- 许可：MIT。
- 必须保留的声明：`Copyright (c) 2008-2015 Printio (Juriy Zaytsev, Maxim Chernyak)` 及 Fabric MIT 全文。
- 浏览器构建通过 package `browser` 映射排除 Node 专用 `canvas`、`jsdom` 等模块；npm 安装仍解析可选的 `canvas@2.11.2` 和 `jsdom@19.0.0`。

## 3. 依赖兼容矩阵

| 维度 | felt-craft-lab 基线 | vue-fabric-editor | electron-fabric-editor | 兼容性判断 |
|---|---|---|---|---|
| Vue | 3.5.40 | `^3.2.25` | `^3.4.33` | Fabric 本身兼容；完整 UI 的组件/自动导入约定不同 |
| Fabric | 未安装 | 5.3.0 | 5.3.0 | 5.3.0 PoC 通过；项目仍需独立版本决策 |
| TypeScript | 5.9.3 | 5.1.6 | 5.9.3 | vue 上游偏旧；Fabric 自定义字段需要本项目类型扩展 |
| Vite | 7.3.6（由 electron-vite 5 使用） | `^4.2.1` | 7.2.6 | Electron 上游较接近；vue 上游插件配置不可直接搬入 |
| 包管理器 | npm 11.16.0 | pnpm，`only-allow pnpm` | pnpm 10.18.3 + workspace catalog | 整体接入会冲突；不得引入 pnpm lockfile |
| Electron | 43.2.0 + electron-vite 5，单仓布局 | 无 Electron | 39.2.6，Turbo monorepo，Main Vite 后再 Webpack bundle | 上游 Electron 外壳不兼容本项目边界，也没有复用必要 |
| UI 组件库 | 无 | View UI Plus 1.3.7 | Element Plus 2.8 + UnoCSS | 任一完整 UI 都会引入新的设计系统和大量裁剪工作 |
| 状态管理 | Vue 局部状态；无全局状态库 | reactive/composable + EventEmitter | Pinia 2.2.8 | 完整接入会带入不需要的状态模型 |
| 构建方式 | `electron-vite build` + electron-builder | Vite SPA；core 另行 Vite library build | Turbo + 多 workspace + Vite + Webpack + electron-builder | 只有 Fabric 浏览器包能无架构替换地接入 |
| 历史记录 | 尚未实现 | `HistoryPlugin` 保存 Fabric JSON 栈 | 同名插件 + `fabric-history` 双重扩展痕迹 | 可参考事件集合，不应复用状态格式 |
| JSON 导入导出 | `SceneDocument` 必须是唯一真实数据源 | `ServersPlugin.loadJSON/getJson` 直接读写 Fabric JSON，含 `workspace` 与扩展键 | 同类实现并绑定模板/Pinia UI | 与 Contracts 冲突，必须自主映射 |
| 图片加载 | `felt-resource`；renderer 可 `fetch(ref) -> blob URL` | `fabric.Image.fromURL(target.src)`、远程 API、crossOrigin | 同类 URL/API 流程 | Fabric 可加载该协议，但上游资源层不可复用 |
| 开源许可 | 项目自身 `UNLICENSED` | 根 MIT；`packages/core` 标 ISC | 无根 LICENSE；package 元数据 MIT | Fabric 自身最清晰；复制 core 前需法务确认 |

### 3.1 传递依赖影响

`vue-fabric-editor` 根应用除 Fabric 外还依赖 View UI Plus、Vue Router、Vue I18n、裁剪、瀑布流、渐变选择器、Axios、lodash、uuid 等；`packages/core` 又声明 `events`、`fabric-history`、`hotkeys-js`、`tapable`、PSD、二维码、条码、字体加载等。即使只取 core，也不能视为“只有 Fabric”。

`electron-fabric-editor/apps/web` 同时引入 Element Plus、Pinia、UnoCSS、更新器、Excel、文件保存、PSD、条码、二维码、远程 API 等；根工程还要求 pnpm、Turbo 和多个 workspace。其 Main/Preload 不是编辑器能力的必要依赖。

路线 C 的隔离安装显示：Fabric 5.3.0 浏览器包可以被 Vite 正常裁剪，但 npm 安装树仍出现 `canvas@2.11.2` 与 `jsdom@19.0.0`，共新增 176 个隔离目录包。安装摘要报告 6 个 high、1 个 critical 漏洞；这是一次 npm 安装时点的审计摘要，不等同于生产可利用性结论，但足以要求单独升级/安全评估。

## 4. 可复用能力与源码定位

表中“直接复制”以当前项目可不修改地使用为判断标准。结论均不授权复制；实际复制仍受上一节许可要求约束。

| 能力 | vue-fabric-editor 源码 | electron-fabric-editor 源码 | 主要依赖 | 直接复制 / 是否重写 | SceneDocument 冲突 | felt-resource 冲突 | 推荐处理 |
|---|---|---|---|---|---|---|---|
| Canvas 初始化与销毁 | `src/views/home/index.vue`；`packages/core/Editor.ts` | `apps/web/src/views/home/index.vue`；`apps/web/src/lib/core/Editor.ts` | Fabric、Editor 插件容器、DOM、ContextMenu、hotkeys、tapable | 否；重写 | 上游启动后立即注册大量非 V1 插件；`destory()` 没有调用 `canvas.dispose()` | 无直接协议支持 | 自建生命周期，显式 `new fabric.Canvas`、解绑监听、撤销 object URL、`dispose()` |
| 画布尺寸管理 | `packages/core/plugin/WorkspacePlugin.ts`、`ResizePlugin.ts`、`src/components/setSize.vue` | `apps/web/src/lib/core/plugin/WorkspacePlugin.ts`、`ResizePlugin.ts`、`apps/web/src/components/SetSize.vue` | `#workspace` DOM、ResizeObserver、lodash throttle、虚拟 workspace Rect | 否；重写 | 把 workspace Rect 写入 Fabric 对象与历史，和 Scene 背景语义、zIndex 冲突 | 无直接冲突 | Scene.canvas 驱动真实 Canvas 尺寸；视口缩放与作品尺寸分离 |
| 图片插入 | `packages/core/plugin/AddBaseTypePlugin.ts#createImgByElement/addBaseType`、`ServersPlugin.ts#dragAddItem` | `apps/web/src/lib/core/plugin/AddBaseTypePlugin.ts`、`ServersPlugin.ts` | Fabric、HTMLImageElement、uuid、Editor position/workspace | 否；重写 | 上游生成自己的 id，未绑定 `assetSnapshotId`，中心/缩放规则不同 | 直接使用任意 `target.src`，没有 ResourceRef 白名单与 object URL 生命周期 | 由资源服务取 `felt-resource`，创建 Fabric Image，同时保留 ResourceRef 元数据但不暴露路径 |
| 对象选中 | `packages/core/ServersPlugin.ts#_initSelectEvent`、`src/hooks/useSelectListen.ts` | `apps/web/src/lib/core/ServersPlugin.ts`、`apps/web/src/store/modules/editor.ts` | Fabric selection events、EventEmitter、Vue reactive/Pinia | 小段事件模式可参考；重写 | 上游支持多选、辅助线和大量对象类型；V1 只处理 Scene sticker | 无 | 自建 selection adapter，只向 UI 暴露对象 ID 与允许操作 |
| 移动 | Fabric 默认控制；`packages/core/plugin/MoveHotKeyPlugin.ts` | Fabric 默认控制；`apps/web/src/lib/core/plugin/MoveHotKeyPlugin.ts` | Fabric、hotkeys-js、Editor | 算法可参考；重写 | 未统一坐标原点/中心点，也未提交 Scene/history | 无 | 使用 `originX/Y=center`，移动结束归一化并写回 Scene |
| 等比例缩放 | Fabric 默认角控件；`packages/core/plugin/ControlsPlugin.ts` | `apps/web/src/lib/core/plugin/ControlsPlugin.ts` | Fabric controlsUtils、全局 prototype、自定义 SVG | 否；重写 | 上游保留边中点控制，可产生非等比缩放；未强制 `scaleX===scaleY` | 无 | 只保留角点控制，交互和导入后都断言等比；禁止中点非等比缩放 |
| 旋转 | `ControlsPlugin.ts#rotationControl`、`src/components/attributePostion.vue` | 同名 core 文件、`apps/web/src/components/AttributePostion.vue` | Fabric rotationWithSnapping、全局 prototype、UI | 光标/吸附思路可参考；重写 | 上游角度可为任意 Fabric 表示，未归一化到 `[-180,180)` | 无 | 自建旋转适配，写回前规范化顺时针角度 |
| 删除 | `packages/core/plugin/DeleteHotKeyPlugin.ts#del` | `apps/web/src/lib/core/plugin/DeleteHotKeyPlugin.ts#del` | Fabric、hotkeys-js、Editor | 小算法可参考；重写 | 上游可删除任意活动对象，缺少背景保护、解锁/资源规则和 Scene 更新 | 无 | 仅删除贴纸对象；背景和异常占位不可静默删除 |
| 图层上移/下移/置顶/置底 | `packages/core/plugin/LayerPlugin.ts` | `apps/web/src/lib/core/plugin/LayerPlugin.ts` | Fabric object stacking、workspace id | 小算法可参考；重写 | 用 `workspace` 特例回到底层，不能保证 Scene 的连续 zIndex | 无 | 每次操作后按 Fabric 顺序重建 sticker 连续 zIndex，背景固定 0 |
| Undo/Redo | `packages/core/plugin/HistoryPlugin.ts` | `apps/web/src/lib/core/plugin/HistoryPlugin.ts`、`utils/fabric-history.ts` | Editor.getJson、Fabric loadFromJSON、hotkeys、window beforeunload | 否；重写 | 历史单位是 Fabric JSON，含 workspace/UI 扩展；不是 SceneDocument | JSON 可能保存临时 blob URL 或外部 src | 以 SceneDocument 快照或命令为历史真相；Fabric 只是投影 |
| JSON 导入 | `packages/core/ServersPlugin.ts#insert/loadJSON` | `apps/web/src/lib/core/ServersPlugin.ts#insert/loadJSON` | FileReader、uuid、Fabric enliven、插件 hooks | 否；重写 | 接受并修改任意 Fabric JSON，没有先经过 Shared Contracts 校验 | 任意图片 src 可被重载 | 仅接收已运行时校验的 SceneDocument，再生成 Fabric 对象；禁用任意 Fabric JSON 导入 |
| JSON 导出 | `packages/core/ServersPlugin.ts#getJson/saveJson` | 同名文件与方法 | Fabric.toJSON、扩展键、下载工具 | 否；重写 | 输出 Fabric JSON，不满足 Scene schema、快照与 zIndex 约束 | 会原样序列化 src | Fabric JSON 只可作为内存/测试中间态；正式保存必须由 Scene mapper 生成 SceneDocument |
| PNG 预览导出 | `packages/core/ServersPlugin.ts#saveImg/preview` | 同名文件；`EditorHeader/components/Save.vue`、`Preview.vue` | Fabric.toDataURL、workspace save hooks | 核心调用可参考；外围重写 | 上游裁剪依赖 workspace 对象；没有校验 preview 与 Scene 一致性 | 外部图片可能污染 canvas | 资源必须经安全同源 scheme/blob 加载；保存流程对同一 Scene 版本导出 PNG |
| 对象事件监听 | `ServersPlugin.ts`、`HistoryPlugin.ts`、`AlignGuidLinePlugin.ts` | 同名 core 文件；多个 UI 组件直接监听 canvas | Fabric events、EventEmitter、Vue/Pinia | 事件名可参考；重写 | 多处分散监听，容易重复写历史；没有 Scene transaction 边界 | 无直接冲突 | 单一 adapter 汇总 selected/moving/scaling/rotating/modified/removed，并统一提交 Scene |
| 快捷键 | `packages/core/Editor.ts#_bindingHotkeys`、Move/Delete/History/Copy plugins | `apps/web/src/lib/core/Editor.ts` 与同名 plugins | hotkeys-js、全局 window | 否；重写 | 上游快捷键覆盖超出儿童产品范围，且未统一权限/背景保护 | 无 | 自建带作用域的键盘层；输入框禁用、卸载清理、操作经命令校验 |
| 背景锁定 | `packages/core/plugin/WorkspacePlugin.ts`、`LockPlugin.ts` | `apps/web/src/lib/core/plugin/WorkspacePlugin.ts`、`LockPlugin.ts` | Fabric Rect、全局 controls、对 Fabric 私有选择方法的 monkey patch | 否；重写 | workspace 是普通 Fabric 对象；LockPlugin 改写私有 Canvas prototype，不等价于 Scene 背景 | 背景图片仍是任意 URL | 自建不可选、不可事件、zIndex=0 的背景投影；背景来源只接受合法 ResourceRef 或颜色/透明语义 |

### 4.1 可以独立借鉴的部分

- `LayerPlugin.ts` 中四个 Fabric 堆叠 API 的调用方式。
- `MoveHotKeyPlugin.ts` 的方向键微移意图。
- `DeleteHotKeyPlugin.ts` 的活动对象删除流程。
- `ServersPlugin.ts` 的 selection 事件集合和 `toDataURL` 调用时机。
- `HistoryPlugin.ts` 的 `object:modified/removed` 事件观察和重载期间抑制历史的思路。

这些内容都需要包裹本项目的 Scene、权限、资源和生命周期约束，不能原样成为业务 API。

### 4.2 依赖上游完整环境的部分

- `Editor.ts` 插件系统：ContextMenu、hotkeys、tapable hooks、ServersPlugin 和动态 API 注入相互绑定。
- `WorkspacePlugin.ts` / `ResizePlugin.ts`：依赖固定 `#workspace` DOM、虚拟 Rect、ResizeObserver、CSS 和其他插件 API。
- Material/Font/PSD/二维码/条码/水印等插件：依赖远端服务或非本项目功能。
- 两套完整 UI：分别绑定 View UI Plus 或 Element Plus，并包含模板、登录、后台、字体、裁剪、滤镜等无关页面。
- `electron-fabric-editor` 的 Main/Preload/Turbo 架构：不提供本项目所需的额外编辑能力，反而会扩大安全边界。

## 5. 三条路线评分

评分采用 1–5，5 表示兼容性/清晰度最高，或工作量、成本、体积、难度最低。每项等权，总分 50。

| 维度 | A 整体接入 vue-fabric-editor | B 提取 packages/core + 插件 | C 只用 Fabric.js + 自建适配层 |
|---|---:|---:|---:|
| 当前 Electron 工程兼容性 | 2 | 3 | 5 |
| 改造工作量 | 1 | 3 | 3 |
| 后续维护成本 | 1 | 2 | 4 |
| Contracts 适配难度 | 1 | 2 | 5 |
| felt-resource 兼容性 | 2 | 3 | 5 |
| 依赖体积 | 1 | 2 | 3 |
| UI 裁剪难度 | 1 | 4 | 5 |
| 测试难度 | 2 | 3 | 5 |
| 开源许可清晰度 | 3 | 2 | 5 |
| 儿童产品功能匹配度 | 2 | 3 | 5 |
| **总分** | **16/50** | **27/50** | **45/50** |

路线 A 的问题不是 Vue 无法运行，而是它会把编辑器应用、UI、路由、远程服务和状态模型一起带进来，随后再大规模删除。路线 B 比 A 可控，但 core 的许可元数据冲突、插件框架耦合和 Fabric JSON 真相模型仍然存在。路线 C 的自主实现量集中在必须由本项目掌控的边界，PoC 已验证技术可行。

## 6. 最小 PoC

### 6.1 隔离方式

PoC 位于仓库外的 `fabric-reuse-poc-temp`，不会提交。项目 `package.json`、`package-lock.json`、Main、Preload、Shared Contracts 均未修改。

隔离依赖固定为：

- `fabric@5.3.0`
- `@types/fabric@5.3.10`
- 与项目相同的 `vue@3.5.40`、`typescript@5.9.3`、`vite@7.3.6`、`@vitejs/plugin-vue@6.0.1`、`vue-tsc@3.1.5`
- Electron 直接复用项目已安装的 `electron@43.2.0`

PoC 使用隐藏且沙箱化的 BrowserWindow，临时注册 `felt-resource` 并只允许 `felt-resource://material/mock-sticker.png` 映射到项目测试图片。绝对路径只在临时 Main 内部使用，没有暴露给 renderer。正式 `felt-resource` 处理器由项目现有 `test:electron-resource` 单独覆盖。

### 6.2 实际命令与结果

```text
npm install --ignore-scripts
# passed；隔离目录 added 176 packages
# audit summary: 6 high, 1 critical

npm run poc
# vue-tsc passed
# Vite 7.3.6 build passed，14 modules
# renderer JS: 374.74 kB，gzip 116.62 kB（包含 Vue + Fabric + PoC）
# hidden Electron execution passed
```

最终运行结果：

```json
{
  "success": true,
  "fabricVersion": "5.3.0",
  "resourceRef": "felt-resource://material/mock-sticker.png",
  "canvasCreated": true,
  "imageLoaded": true,
  "selected": true,
  "moved": true,
  "uniformScale": true,
  "rotated": true,
  "layerOrderAdjusted": true,
  "jsonExported": true,
  "jsonReloaded": true,
  "propertiesPreserved": true,
  "pngExported": true,
  "undoWorked": true,
  "redoWorked": true,
  "windowsPathExposed": false,
  "backgroundLocked": true
}
```

### 6.3 PoC 观察

- Fabric 5.3.0 浏览器构建可以在 Vite 7 / Electron 43 中运行，不需要修改 Main/Preload。
- `fabric.Image.fromURL` 能加载已注册、secure、CORS-enabled 的 `felt-resource` URL，导出 PNG 未发生 canvas taint。
- JSON 往返可保留位置、等比 scale、角度和显式附加的 `resourceRef`。
- `id`、`resourceRef` 不在 `@types/fabric` 标准字段中，需要本项目局部类型扩展。
- `selectable`、`evented`、`hasControls` 等非默认状态必须显式列入 `toJSON` 附加字段；selection 本身不应当持久化。
- 最小 Undo/Redo 可通过两个 JSON 快照重载完成，但正式实现不应把 Fabric JSON 作为持久化或历史真相。
- 上游 `Editor.destory()` 只清理自身引用；本项目必须调用 Fabric `canvas.dispose()` 并撤销资源 object URL。

## 7. 推荐复用边界

建议正式实现只引入 Fabric，并建立以下小型 renderer 内适配边界；名称只是任务拆分建议，不是本轮冻结的业务 API：

1. Canvas 生命周期：创建、尺寸、事件订阅、销毁。
2. Scene 投影器：`SceneDocument -> Fabric objects` 与 Fabric 变换结果回写 Scene；正式保存仍只保存 SceneDocument。
3. 资源加载器：ResourceRef 校验、`felt-resource` fetch/blob、图片创建、object URL 回收；永不接收 Windows 路径。
4. 交互约束：选择、移动、等比例缩放、角度归一化、删除、背景保护。
5. 图层适配：背景固定 0，贴纸层连续重排。
6. 历史记录：基于 Scene 快照或命令，不复用 Fabric JSON 历史。
7. 预览导出：对同一 Scene 版本导出 PNG，并返回给正式保存流程。

## 8. 文件处理建议

### 8.1 建议直接复制

当前阶段 **无**。技术上较小的插件也包含上游类型、Editor API、许可或业务假设；直接复制的收益低于按本项目约束重写。

### 8.2 建议参考后改写

- `vue-fabric-editor/packages/core/plugin/LayerPlugin.ts`
- `vue-fabric-editor/packages/core/plugin/MoveHotKeyPlugin.ts`
- `vue-fabric-editor/packages/core/plugin/DeleteHotKeyPlugin.ts`
- `vue-fabric-editor/packages/core/plugin/HistoryPlugin.ts`
- `vue-fabric-editor/packages/core/ServersPlugin.ts` 中 selection、JSON 重载和 PNG 导出片段
- `vue-fabric-editor/packages/core/plugin/AddBaseTypePlugin.ts` 中 Fabric 图片创建片段
- `vue-fabric-editor/packages/core/plugin/ControlsPlugin.ts` 中旋转控制思路

Electron 候选中的同名文件不作为首选参考，因为它们是应用内副本且许可链更模糊。若需要比较差异，只以固定 SHA 的 `apps/web/src/lib/core` 为证据。

### 8.3 建议舍弃

- 两个上游的完整 UI、路由、模板、登录、后台、素材 API、字体、PSD、二维码、条码、滤镜、水印和裁剪功能。
- `vue-fabric-editor/packages/core/Editor.ts` 的动态插件容器与 ContextMenu。
- `WorkspacePlugin.ts` 的 workspace Fabric Rect 持久化模型。
- `LockPlugin.ts` 对 Fabric 私有 prototype / grouping 方法的 monkey patch。
- 两个上游的 Fabric JSON 文件导入/正式保存流程。
- `electron-fabric-editor/apps/electron`、`apps/preload`、Turbo/pnpm workspace 和更新器架构。
- View UI Plus、Element Plus、Pinia、UnoCSS 以及与本轮基础编辑能力无关的传递依赖。

## 9. 后续正式开发任务拆分

1. Fabric 版本与供应链任务：比较 5.3.0 与当前维护版本的 API、bundle、Electron 43、图片重载和许可；输出版本 ADR。
2. 资源适配任务：以生产 `felt-resource` handler 和 renderer resource service 为唯一入口，补图片失败、撤销 object URL、CORS/taint 测试。
3. Scene/Fabric mapper：覆盖中心坐标、角度区间、等比 scale、背景三语义、assetSnapshotId 和连续 zIndex。
4. Canvas 生命周期与基础交互：创建/销毁、选择、移动、缩放、旋转、删除、图层操作。
5. Scene 历史记录：定义事务边界、Undo/Redo 上限和导入后的历史重置。
6. 预览一致性：同一 Scene 版本导出 PNG，正式保存校验 Scene 与 preview 信息一致。
7. 测试：mapper 单元测试、Electron 资源集成测试、Canvas 行为测试、异常资源占位与不静默删除测试。
8. 许可合规：若最终复制任何上游实现，建立 THIRD_PARTY_NOTICES，并按文件记录来源 SHA、许可和修改。

## 10. 未解决风险

- `packages/core` 的 ISC 字段与仓库根 MIT 正文不一致；复制前需要许可确认。
- `electron-fabric-editor` 缺少根 LICENSE 正文，且 web/editor 与 Electron 脚手架来源不同。
- Fabric 5.3.0 的安装树较旧，隔离 npm 安装出现高危/严重审计摘要；需要专门的可利用性和升级评估。
- Fabric 5 typings 不知道本项目的 `id/resourceRef` 字段；错误的全局 declaration merge 可能污染其他模块，应使用局部序列化类型。
- Fabric JSON 不能替代 SceneDocument；导入任意 Fabric JSON 会绕过 Shared Contracts 和资源快照语义。
- Blob URL 不能持久化；JSON 重载必须从 ResourceRef 重新解析图片，并及时 revoke 旧 URL。
- 图片 CORS、解码失败、损坏和正式下架必须映射到资源异常占位，不能删除 Scene 对象或修改解锁状态。
- Fabric 默认坐标原点、角度表示、控制点和缩放行为必须由 mapper/interaction adapter 统一约束。
- Vue + Fabric 的 PoC renderer bundle 为 374.74 kB / gzip 116.62 kB；正式代码分割与启动性能仍需测量。
- 儿童产品只需要小型能力子集；上游自由文本、绘图、PSD、远程模板等功能会扩大测试和安全面。

## 11. Fabric 版本建议

不建议现在把 Fabric 5.3.0 冻结为长期生产版本。

如果正式编辑器任务必须立即开始，可以把 **精确版本 `5.3.0`** 作为短期兼容基线，禁止使用范围版本，并在同一里程碑另开升级/安全任务；在生产发布前完成对当前维护版本的迁移评估。理由是：两个候选上游都基于 5.3.0，PoC 已证明其兼容，但其可选 Node 依赖、类型包和审计摘要已经表现出维护风险。

最终是否采用路线 C、是否临时固定 5.3.0，以及升级任务的完成门槛，由 ZXR 确认。

## 12. 项目验证结果

在本工作分支的完整 checkout 中实际执行：

```text
npm run typecheck
# passed；tsc(node) + vue-tsc(web)

npm test
# passed；3 test files，33 tests

npm run build
# passed；Electron-Vite main 18 modules、preload 2 modules、renderer 12 modules

npm run test:electron-resource
# passed；内部 build passed
# production protocol + resolver + roots passed
# image canvas toDataURL + audio seek/currentTime + method 405 + preview userData passed
# material/audio/preview 全部通过
```

本轮没有修改 Shared Contracts、SceneDocument、ResourceRef 协议、Electron Main/Preload，也没有向项目添加依赖或 `pnpm-lock.yaml`。
