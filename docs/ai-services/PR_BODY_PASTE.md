## 对接文档（SXY 必读 · 请置顶阅读）

**[`docs/ai-services/SXY对接指南.md`](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/SXY对接指南.md)**

> **状态：Draft（请审查；请勿合并、勿转 Ready）**  
> 已同步最新 `integration/material-library`（含 **PR#10** ResourceRef / `felt-resource` 解析层）。  
> 固定音频正式地址为 **`felt-resource://audio/...`**，不再以 `/fixed-audio/...` 作为 Electron 正式对接地址。

其他文档：
- [错误码与重试降级](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/错误码与重试降级.md)
- [固定TTS批量工具](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/固定TTS批量工具.md)
- [产品验收清单](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/产品验收清单.md)
- [开源许可与云服务记录](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/开源许可与云服务记录.md)
- [Resource 解析说明](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/architecture/resource-resolver.md)

---

## Summary

组长 AI 服务线：`feature/material-ai-services` → `integration/material-library`。  
交付安全代理后端、ASR/QA/TTS、Audio/Animation、Mock/文档、固定语音批量、验收文档；并已对齐 PR#10 的 `felt-resource://audio/...`。

### 1. 完成范围

| 模块 | 范围 |
|------|------|
| **ASR** | Qwen3-ASR-Flash HTTP；统一字段与错误码；P50/P95；realtime/local 占位；Mock |
| **DeepSeek 问答** | 儿童适龄；`safetyAction`；超时/错误；Mock |
| **MiniMax 语音** | 动态 TTS + 哈希缓存；固定批量 → `assets/generated/audio/`；Mock |
| **AudioService** | Howler；兼容 `felt-resource://audio/...`（Electron）与浏览器 demo 映射 |
| **AnimationService** | lottie：`collect` / `save` / `loading` |

### 2. Mock 与真实服务切换

- 请求 `"provider": "mock"` 或环境变量 `*_PROVIDER=mock`
- `GET /api/asr/mock`、`/api/qa/mock`、`/api/tts/mock`

### 3. 环境变量与密钥

- `backend/.env.example` → 本机 `.env`（勿提交）
- 仓库仅含 example；`/api/health` 掩码显示

### 4. 错误码 / 重试 / 超时 / 降级 / 取消

- 见 `docs/ai-services/错误码与重试降级.md` 与 `GET /api/ops/rules`
- ASR `empty` 禁 QA；TTS 失败 `keep_text_only`
- 取消：停录 / `AudioService.stop()` / `AnimationService.stop()`（无独立 cancel-token API）

### 5. 固定语音与 felt-resource

| 项 | 说明 |
|----|------|
| 落盘 | `assets/generated/audio/*.mp3` |
| 索引 | `assets/generated/audio/audio-index.json` |
| **正式 URL** | `felt-resource://audio/<id>.mp3` |
| 浏览器辅助 | `/generated-audio/...`（非正式） |
| **弃用** | `/fixed-audio/...` 不作 Electron 正式对接 |
| AudioService | `toPlayableAudioUrl`：Electron 原样播放 ResourceRef；非 Electron 映射 HTTP |

### 6. 本地启动与 Demo

```bat
cd backend
双击 启动第1步.bat
```

- `/api/health`
- `/demo/audio` · `/demo/animation` · `/demo/fixed-audio`

主工程（同步后）：

```bat
npm install
npm run typecheck
npm test
npm run build
```

### 7. typecheck / 测试 / 构建

同步 `integration/material-library`（含 PR#10）后，在完整工程实测：

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 通过 |
| `npm test` | ✅ 34 tests passed |
| `npm run build` | ✅ electron-vite build 通过 |

后端 demo / smoke 仍可用：`启动第1步.bat` + `/demo/*`。

### 8. 共享 Contracts

- **未修改** XR 共享 Contracts 定义文件的业务语义；仅消费 PR#10 的 ResourceRef / felt-resource 解析层。
- 固定音频索引使用 `felt-resource://audio/...`，与 `FELT_RESOURCE_REF_POLICY` 一致。

---

## Test plan

- [ ] 保持 Draft：不合并、不转 Ready
- [ ] Diff 无真实 `.env`
- [ ] `npm run typecheck` / `npm test` / `npm run build` 通过
- [ ] `felt-resource://audio/rabbit_intro.mp3` 可被 parse / policy 接受
- [ ] `/demo/fixed-audio` 浏览器辅助可播（映射 `/generated-audio`）
- [ ] 审查 AudioService + ResourceRef 兼容说明
