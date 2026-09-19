# Assets

- `generated/material/`：素材图片开发快照（SXY 导入；本 PR 仅含 mock）
- `generated/audio/`：固定音频开发快照（本 PR 仅含 mock）
- `runtime/`：打包运行时文件（例如 bootstrap marker）
- 项目预览不放仓库，运行时写入 Electron `userData/previews`，引用为 `felt-resource://preview/...`

Do not commit unlicensed or source-unknown production media in this PR.

See `generated/FIXTURES.md` for authorship and license status of mock media.
