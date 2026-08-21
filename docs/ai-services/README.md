# 组长 · AI 服务说明

面向 **SXY 对接** 请先看：

→ **[SXY对接指南.md](./SXY对接指南.md)**

固定介绍语音批量工具：

→ **[固定TTS批量工具.md](./固定TTS批量工具.md)**

→ **[sd-local-lora.md](./sd-local-lora.md)**（本地 SD + LoRA 画风锁定）

→ **[算力需求调研-LoRA训练.md](./算力需求调研-LoRA训练.md)**（Liblib / 学校云 / 本机训练选型）

→ **[语音生图-进度清单.md](./语音生图-进度清单.md)**（Create Asset 已做 / 未做）

→ **[语音生图-抠图与透明PNG验证.md](./语音生图-抠图与透明PNG验证.md)**（P5 抠图联调）

→ **[语音生图-验收清单.md](./语音生图-验收清单.md)**（P6 端到端勾选）

→ **[语音生图-冒烟测试记录.md](./语音生图-冒烟测试记录.md)**（mock / wan / sd_local Provider 冒烟）

错误码 / 重试 / 降级：

→ **[错误码与重试降级.md](./错误码与重试降级.md)**

验收与合规：

→ **[产品验收清单.md](./产品验收清单.md)**  
→ **[开源许可与云服务记录.md](./开源许可与云服务记录.md)**  
→ **[API冒烟测试记录.md](./API冒烟测试记录.md)**

## 正式边界（ZXR 已确认）

| 项 | 约定 |
|----|------|
| Electron 调用 | Renderer → Preload/`electronAPI.ai.*` → Main → Gateway |
| 开发 Gateway | Main → `http://127.0.0.1:8788` |
| 正式 Gateway | 构建期 `FELT_AI_GATEWAY_BASE_URL` 或运行时 `AI_GATEWAY_BASE_URL`（远端 **HTTPS**）；**无**本地 Python sidecar |
| 密钥 | Provider Key 与 Session HMAC 仅 Gateway 服务端；Electron **无**永久 secret |
| 防滥用 | 短期 Session Token + `installationId`；鉴权后防刷限流与**付费保险丝分离**（仅真实 Provider 记账） |
| Fuse 说明 | 进程内计数；重启清零；多 worker 不共享（本 PR 不引入 Redis/DB） |
| 动态 TTS | Gateway `audioBase64` → Main `userData/audio/dynamic/<hash>.mp3` → `felt-resource://audio/dynamic/<hash>.mp3` |
| 动态缓存淘汰 | oldest-mtime + TTL（非真正 LRU；cache hit 不 touch mtime） |
| animation kind | 本阶段不新增 |

## 接口速查（Gateway HTTP；仅 Main / 受控客户端调用）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/session/token` | 申请短期 Session Token（需合法 `installationId`） |
| GET | `/api/health` | 健康检查（无需 Token） |
| GET | `/api/ready` | 能力就绪（无需 Token） |
| POST | `/api/asr/transcribe` | 语音识别（multipart，需 Token） |
| POST | `/api/qa/ask` | 儿童问答（需 Token） |
| POST | `/api/tts/synthesize` | 动态 TTS（`audioBase64`，需 Token） |
| GET | `/api/*/mock` | 开发 Mock（无需 Token） |
| GET | `/api/ops/rules` | 错误码 + 重试/降级（需 Token） |

## 产品硬规则

1. ASR 空识别（`ASR_EMPTY_TRANSCRIPT`）→ **禁止**进 DeepSeek，提示重说  
2. TTS 失败 → **仍显示文字**  
3. 前端 **零密钥**；Renderer **零直连** Flask  
4. `retryable=true` 才提示重试；否则不要死循环
