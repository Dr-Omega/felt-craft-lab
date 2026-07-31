# 组长 · AI 服务说明

面向 **SXY 对接** 请先看：

→ **[SXY对接指南.md](./SXY对接指南.md)**

固定介绍语音批量工具：

→ **[固定TTS批量工具.md](./固定TTS批量工具.md)**

错误码 / 重试 / 降级：

→ **[错误码与重试降级.md](./错误码与重试降级.md)**

## 进度

- 第 1 步：安全代理 + 健康检查
- 第 2 步：Qwen3-ASR-Flash HTTP + Provider + Mock
- 第 3 步：统一输出字段 + 错误码 + P50/P95
- 第 4 步：DeepSeek 儿童问答
- 第 5 步：MiniMax TTS + 哈希缓存
- 第 6 步：AudioService（Howler）
- 第 7 步：AnimationService（lottie）
- 第 8 步：SXY Mock / 对接文档 + 轻量 HTTP 客户端
- 第 9 步：固定文案 TTS 批量工具 + 音频快照索引
- 第 10 步：`.env.example` + 错误码 + 重试/降级规则

## 基址

本地：`http://127.0.0.1:8788`

## 接口速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/ready` | 能力就绪 |
| POST | `/api/asr/transcribe` | 语音识别 |
| GET | `/api/asr/mock` | ASR Mock |
| GET | `/api/asr/contract` | ASR 契约 |
| GET | `/api/asr/metrics` | ASR 延迟统计 |
| POST | `/api/qa/ask` | 儿童问答 |
| GET | `/api/qa/mock` | QA Mock |
| GET | `/api/qa/contract` | QA 契约 |
| POST | `/api/tts/synthesize` | 文字转语音（动态） |
| GET | `/api/tts/mock` | TTS Mock |
| GET | `/api/tts/contract` | TTS 契约 |
| GET | `/fixed-audio/<file>` | 固定语音快照文件 |
| GET | `/demo/audio` | AudioService 演示 |
| GET | `/demo/animation` | AnimationService 演示 |
| GET | `/demo/fixed-audio` | 固定语音试听 |
| GET | `/api/ops/rules` | 错误码 + 重试/降级规则 |

## 产品硬规则

1. ASR `empty=true` → **禁止**进 DeepSeek，提示重说  
2. TTS 失败 → **仍显示文字**  
3. 前端 **零密钥**  
4. `retryable=true` 才提示重试；否则不要死循环
