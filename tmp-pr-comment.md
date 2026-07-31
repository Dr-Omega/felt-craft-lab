## 复审修复说明（Request changes）

已针对 6 项阻塞逐项修复，**继续保持 Draft，不自行合并**。最新提交已推送。

### 修复对照

1. **symlink / junction 逃逸**：`resolveFeltResourcePath` 在读取前对 root 与候选路径做 `realpath` 再校验；补充 Windows junction 回归测试。
2. **IPC 原生异常**：inspect 统一走带 try/catch 的 resolver，始终返回 `ResourceInspectResult`，不再让 `existsSync/statSync` 外抛。
3. **IPC 来源 + 导航**：校验 `event.senderFrame.url`；主窗口限制 `will-navigate` / `will-redirect`。
4. **流式协议**：改为 `protocol.handle + net.fetch(pathToFileURL)`，支持 Range；启用 CORS，供 Canvas 使用。
5. **Renderer OS 路径**：`felt:bootstrap:ping` 改为只返回 `markerFound`，删除 `markerPath` / `markerUrl`。
6. **Electron 冒烟**：新增 `npm run test:electron-resource`
   - 图片 `fetch→blob→canvas.toDataURL` 成功（无污染）
   - 固定音频加载 + seek
   - preview 写入/读取 `userData/previews`
   - Windows 打包后 material/audio 已打入 `resources/assets/generated/**`

### 非阻塞清理

- 新增 `assets/generated/FIXTURES.md`：注明 3 个 mock 为项目自生成测试 Fixture，无第三方授权问题。

### 复验（Node v22.22.0 / Windows）

| 步骤 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 通过（30 tests） |
| `npm run test:electron-resource` | 通过 |
| `npm run build` | 通过 |
| `npm run dist:win` | 通过；MATERIAL/AUDIO 打包资源存在 |

请复审并关闭对应 Inline Review 线程。协议名 `felt-resource:` 仍保留。
