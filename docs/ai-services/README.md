# 组长 · AI 服务说明

## 进度

- 第 1 步：安全代理 + 健康检查
- 第 2 步：Qwen3-ASR-Flash HTTP + Provider 抽象 + Mock
- 第 3 步：统一输出字段 + 错误码 + P50/P95 统计

## ASR 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/asr/transcribe` | 正式识别 |
| GET | `/api/asr/smoke-test` | 官方示例音频冒烟测试 |
| GET | `/api/asr/mock` | Mock，供 SXY 并行 |
| GET | `/api/asr/contract` | 字段契约 + 错误码列表 |
| GET | `/api/asr/metrics` | P50/P95、失败率、空文本率 |

## 成功返回固定字段

`result.transcript` / `provider` / `durationMs` / `latencyMs` / `empty`  
（`requestId` 可选）

产品规则：`empty=true` 时，SXY **不得**把文本交给 DeepSeek，应提示重说。

## 验收目标（规范）

- 停录到出字：P50 ≤ 1.5s，P95 ≤ 3s
- 失败率 ≤ 5%

查看：`/api/asr/metrics`
