## 对接文档（SXY 必读）

**[`docs/ai-services/SXY对接指南.md`](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/SXY对接指南.md)**

> **状态：Draft（请审查；请勿合并、勿转 Ready）**  
> 已同步 `integration/material-library`（含 PR#10）。  
> ZXR 已确认正式 AI 调用边界；按 Review 线程 + 确认边界完成修复与回归测试。  
> **SXY 暂勿正式接入**；等本轮审查通过后再做端到端联调。

---

## Summary

组长 AI 网关 + Main/Preload 代理 + 正式 Audio/Animation（`src/renderer/src/services`）。

### 已确认边界（已实现）

1. Renderer **不**直连 Flask；统一 `electronAPI.ai.*` → Main → Gateway（无 CORS 方案）
2. 开发：Main → `localhost:8788`；正式：Main → 远端 `AI_GATEWAY_BASE_URL`（**无**本地 Python sidecar）
3. 真实 API Key 仅 Gateway 服务端
4. 动态 TTS：Gateway `audioBase64` → Main `userData/audio/dynamic/<hash>.mp3` → `felt-resource://audio/dynamic/<hash>.mp3`
5. Main 只做 IPC/转发/超时/落盘/契约边界；不承载 Prompt/Provider/安全后处理
6. 本 PR **不**新增 `felt-resource://animation` kind

### 其它 Review 修复

- Contracts 对齐：`AsrResult` / `QaResult` / `TtsResult` / `SharedError`
- 守卫：`remote_addr` 限流、`MAX_CONTENT_LENGTH`、拒绝任意 JSON `audioUrl`、provider 白名单
- 指标：session 桶化、可写目录、有界轮转
- AudioService：`play` 成功开始才 settle；stop/替换可靠结束；不把 `load` 当成功
- 未验收 demo 语音移至 `assets/demo/audio/`（不进 extraResources）
- 根 README 保持 branch-agnostic

### 本地命令

```bash
npm install
npm run typecheck
npm test
npm run build
```

```bat
cd backend
双击 启动第1步.bat
python -m unittest discover -s tests -p "test_*.py"
```
