## 对接文档（SXY 必读）

**[`docs/ai-services/SXY对接指南.md`](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/SXY对接指南.md)**

> **状态：Draft（请审查；请勿合并、勿转 Ready）**  
> 已同步 `integration/material-library`（含 PR#10）。  
> 首轮 Request changes 已按线程修复（Contracts 对齐、守卫、安全后处理、Electron 正式服务接入）。  
> **SXY 暂勿正式接入**；等 Contracts 与 Electron 调用链审查通过后再做端到端联调。

---

## Summary

组长 AI 网关 + 正式 Audio/Animation（`src/renderer/src/services`）。

### 已处理

- 成功/错误载荷对齐冻结 Contracts：`AsrResult` / `QaResult` / `TtsResult` / `SharedError`
- Provider 白名单：未知 provider **拒绝**；`mock` 仅开发态
- 上传大小 / MIME / 文本长度 / 限流 / 并发；smoke 改为受保护 POST + `AI_SMOKE_ENABLED`
- 健康检查仅 `keysConfigured` 布尔；错误无密钥派生/上游原文
- QA 安全后处理：非 JSON / 危险输出不得 `allow`
- AudioService Promise 在 stop/替换时可靠 settle；无远程 Lottie 默认地址
- 删除 `frontend/assets/fixed-audio` 旧 mp3/索引；正式音频仅 `assets/generated/audio`

### 待确认（已在对应 Inline 线程回复方案，未自行定案）

1. Electron↔Flask：精确 CORS 允许列表 vs Main/Preload 代理  
2. 动态 TTS → 合法 `felt-resource://audio/...` 落盘与返回方案  

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
