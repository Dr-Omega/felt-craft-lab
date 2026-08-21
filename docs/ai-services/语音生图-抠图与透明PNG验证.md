# 语音生图 · 抠图与透明 PNG 验证（P5）

生图链路在 Provider 出图后会走 Gateway 的 Pillow 后处理：

```text
Provider PNG/JPEG
  → remove_plain_background（清浅色棚拍底，保留主体内白色）
  → 缩放到角色尺寸
  → RGBA PNG + quality 报告
  → Electron 预览（棋盘格底）
```

## 本机最快验证（无需云 / GPU）

1. `backend/.env` 设 `IMAGE_PROVIDER=mock`，重启 Flask（`8788`）。
2. `npm run dev` 打开「生成作品」。
3. 输入一句完整描述 →「就这样画」。
4. **预览区应出现棋盘格底**；主体色块四周应透出格子（说明已抠成透明 PNG）。
5. 「去编辑器装饰」后，核心图案仍应是透明底。

Mock 会画「浅灰棚拍底 + 彩色椭圆主体」，专门让抠图链路可本机联调。

## 自动化

在 `backend/`：

```text
.venv\Scripts\python.exe -m unittest tests.test_image_transparent_png tests.test_image_postprocess tests.test_image_generate
```

关键断言：`/api/image/generate`（mock）与 `/api/image/finalize` 结果四角 `alpha=0`，中心主体不透明。

## 真实 Provider（可选勾选）

| Provider | 条件 | 期望 |
|----------|------|------|
| `wan_dashscope` | 已配 DashScope Key | 多数棚拍浅底可抠；复杂底可能残留 |
| `sd_local` | WebUI `--api` + 可选 LoRA | 同上；提示词尽量要求 plain / white background |

失败时优先查：`backend/services/image_postprocess.py` 与本页自动化测试。

## 不做

- 不在本步自训 LoRA
- 不引入 rembg 等重模型（首版 Pillow 规则抠图）
