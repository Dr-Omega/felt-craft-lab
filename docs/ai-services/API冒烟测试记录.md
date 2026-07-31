# API 冒烟测试记录（模板）

每次重要交付前，启动 `backend\启动第1步.bat`，用浏览器或 curl 点开下列地址，把结果记在表里。

| 时间 | 接口 | 结果（ok/失败原因） | 测试人 |
|------|------|---------------------|--------|
| | `/api/health` | | |
| | `/api/ready` | | |
| | `/api/ops/rules` | | |
| | `/api/asr/mock` | | |
| | `/api/asr/smoke-test` | | |
| | `/api/qa/mock` | | |
| | `/api/qa/smoke-test` | | |
| | `/api/tts/mock` | | |
| | `/api/tts/smoke-test` | | |
| | `/demo/audio` | | |
| | `/demo/animation` | | |
| | `/demo/fixed-audio` | | |

ASR 延迟：打开 `/api/asr/metrics`，把 P50/P95/失败率抄到下方：

```text
P50:
P95:
失败率:
空文本率:
```
