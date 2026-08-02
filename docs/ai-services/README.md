# 组长 · AI 服务说明

面向 **SXY 对接** 请先看：

→ **[SXY对接指南.md](./SXY对接指南.md)**

固定介绍语音批量工具：

→ **[固定TTS批量工具.md](./固定TTS批量工具.md)**

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
| 正式 Gateway | Main → `AI_GATEWAY_BASE_URL`（远端）；**无**本地 Python sidecar |
| 密钥 | 仅 Gateway 服务端 |
| 动态 TTS | Gateway `audioBase64` → Main `userData/audio/dynamic/<hash>.mp3` → `felt-resource://audio/dynamic/<hash>.mp3` |
| animation kind | 本阶段不新增 |

## 接口速查（Gateway HTTP；仅 Main 调用）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/ready` | 能力就绪 |
| POST | `/api/asr/transcribe` | 语音识别（multipart） |
| POST | `/api/qa/ask` | 儿童问答 |
| POST | `/api/tts/synthesize` | 动态 TTS（`audioBase64`） |
| GET | `/api/*/mock` | 开发 Mock |
| GET | `/api/ops/rules` | 错误码 + 重试/降级 |

## 产品硬规则

1. ASR 空识别（`ASR_EMPTY_TRANSCRIPT`）→ **禁止**进 DeepSeek，提示重说  
2. TTS 失败 → **仍显示文字**  
3. 前端 **零密钥**；Renderer **零直连** Flask  
4. `retryable=true` 才提示重试；否则不要死循环
