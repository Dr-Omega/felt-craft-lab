## 对接文档（SXY 必读）

**[`docs/ai-services/SXY对接指南.md`](https://github.com/Dr-Omega/felt-craft-lab/blob/feature/material-ai-services/docs/ai-services/SXY对接指南.md)**

> **状态：Draft（请审查；请勿合并、勿转 Ready）**  
> ZXR 已确认：Main/Preload 代理、动态 TTS、Session Token 防滥用、无永久 Electron secret。  
> **SXY 暂勿正式接入**；等本轮审查通过后再做端到端联调。

---

## Summary

组长 AI 网关 + Main/Preload 代理 + 短期 Session Token 防滥用 + 正式 Audio/Animation。

### 已确认并实现

1. Renderer → `electronAPI.ai.*` → Main → Gateway（开发 localhost / 正式 HTTPS Gateway）
2. 无本地 Python sidecar；Provider Key 仅 Gateway
3. 动态 TTS → Main `userData/audio/dynamic/<hash>.mp3`
4. **Session Token**：`installationId` + Main 申请/缓存/刷新；ASR/QA/TTS 统一携带；单实例宽松限流 + 全局保险丝；**不**硬编码永久 secret
5. Main 对 ASR/QA/TTS 做 Contracts 运行时校验；TTS/服务端缓存有界
6. 不新增 `felt-resource://animation` kind

### 本地命令

```bash
npm run typecheck
npm test
npm run build
python -m unittest discover -s backend/tests -p "test_*.py"
```
