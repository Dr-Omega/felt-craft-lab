# ResourceRef 与 felt-resource 解析层

## 目标

把 `ResourceRef` 从“字符串别名”落到可在 Electron 开发环境与 Windows 打包环境统一解析的验证协议：`felt-resource:`。

本层不实现素材库页面、Manifest 导入、Dexie、Fabric 或 AI 服务，也不修改 `src/shared/contracts`。

## 引用格式

```text
felt-resource://material/<relative-path>
felt-resource://audio/<relative-path>
felt-resource://preview/<relative-path>
```

示例：

```text
felt-resource://material/mock-sticker.png
felt-resource://audio/mock-name-zh.wav
felt-resource://preview/project-demo.png
```

约束：

- 仅 `felt-resource:` 协议（验证方案）；
- host 必须是 `material` / `audio` / `preview`；
- 相对路径禁止 `..`、反斜杠、空段、query/hash/userinfo；
- 持久化层继续通过 `ResourceRefValidationPolicy` 注入允许协议；测试 fixtures 仍可用 `mock:`。

## 边界

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| Shared | 解析 URI、校验格式、纯路径拼装与 realpath 校验 | 不直接依赖 Electron；不把 OS 路径暴露给页面 |
| Main | 根目录映射、`felt-resource` 流式协议、受信任 IPC inspect | 不把绝对路径返回给 Renderer；不向不受信任页面提供 IPC |
| Preload | 暴露 `inspectResource(ref)` | 不暴露 `fs` / `path` / 任意 IPC |
| Renderer | 只持有 `ResourceRef`；`<img>`/`<audio>` 直接使用该字符串 | 不拼接 Windows 绝对路径，不绕过 Main |

## 根目录映射

- `material` → `assets/generated/material`（打包后位于 `process.resourcesPath/assets/generated/material`）
- `audio` → `assets/generated/audio`（同上）
- `preview` → `{userData}/previews`（开发与安装包均写用户目录，避免装进 asar）

## 安全实现要点

1. 读取前对 root 与候选路径执行 `realpath`，阻止根目录内的 symlink / Windows junction 逃逸。
2. IPC 始终返回 `ResourceInspectResult` / `SharedError`，捕获 fs 异常，不向 Renderer 泄露绝对路径。
3. IPC 校验 `event.senderFrame.url`；主窗口限制 `will-navigate` / `will-redirect`。
4. 协议层使用 `protocol.handle + net.fetch(pathToFileURL(...))` 流式响应，支持音视频 Range/seek。
5. Bootstrap ping 仅返回 `markerFound`，不再返回 `markerPath` / `markerUrl`。
6. Fabric / Canvas：推荐 `fetch(ref) → blob → ObjectURL/ImageBitmap` 再绘制，可稳定避免跨源污染；若直接使用 `<img src="felt-resource://...">`，必须设置 `crossOrigin = 'anonymous'`（协议已启用 CORS）。

## 异常

- 非法协议 / 非法 kind / 路径穿越 / 链接逃逸 → `INVALID_ARGUMENT`
- 文件不存在或不是普通文件 → `ASSET_NOT_FOUND`
- 协议 handler 读取失败 → HTTP 500（仅协议响应；IPC 使用 SharedError）

## 验证命令

```bash
npm run typecheck
npm test
npm run test:electron-resource
npm run build
npm run dist:win
```

## 已知注意点（不更换协议）

1. `protocol.registerSchemesAsPrivileged` 必须在 `app.ready` 之前调用。
2. CSP 必须显式允许 `felt-resource:`（`img-src` / `media-src`）。
3. 自定义协议只在 Electron 内有效。
4. Windows 非 ASCII 工程路径可能影响打包工具本身；打包验证请使用 ASCII 路径。

若后续发现 `felt-resource:` 在 Electron/打包上有硬性阻塞，先在本 PR 记录，不擅自改协议名。
