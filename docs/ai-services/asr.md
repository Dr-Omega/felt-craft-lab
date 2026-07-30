# ASR（第 2 步）

## 接口

`POST /api/asr/transcribe`

### 方式 1：JSON（方便用公网测试音频）

```json
{
  "audioUrl": "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3",
  "provider": "qwen_cloud_http",
  "language": "zh"
}
```

### 方式 2：multipart（SXY 录音上传）

- 字段 `audio`：音频文件
- 可选：`provider`、`language`、`sessionId`

### 成功返回（AsrResult）

```json
{
  "transcript": "识别出的文字",
  "provider": "qwen_cloud_http",
  "durationMs": 1234,
  "latencyMs": 1234,
  "confidence": null,
  "requestId": "...",
  "emptyTranscript": false
}
```

### Mock（不耗额度）

```json
{ "provider": "mock", "audioUrl": "https://example.com/a.mp3" }
```

## Provider

| id | 状态 |
|----|------|
| `qwen_cloud_http` | 已实现（Qwen3-ASR-Flash） |
| `qwen_cloud_realtime` | 预留 |
| `qwen_local` | 预留 |
| `mock` | 已实现（给 SXY 联调） |

## 延迟日志

写入 `backend/data/logs/asr_metrics.jsonl`（不上传仓库）。
