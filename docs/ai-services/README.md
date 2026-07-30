# 组长 · AI 服务说明

## 第 2 步：ASR

### 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/asr/transcribe` | 正式识别：multipart `file` 或 JSON `audioUrl` |
| GET | `/api/asr/smoke-test` | 一键测官方示例音频 |
| GET | `/api/asr/mock` | Mock 结果，供 SXY 并行开发 |

### 成功返回（节选）

```json
{
  "ok": true,
  "result": {
    "transcript": "识别出的文字",
    "provider": "qwen_cloud_http",
    "durationMs": 0,
    "latencyMs": 1234,
    "empty": false,
    "requestId": "..."
  }
}
```

### Provider

- 已实现：`qwen_cloud_http`、`mock`
- 已预留：`qwen_cloud_realtime`、`qwen_local`（切换只改服务端配置）

### 环境变量

见 `backend/.env.example`。`.env` 不得提交。
