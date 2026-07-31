# 固定 TTS 批量工具（第 9 步）

和「问答时临时合成」不同：这里是把 **贴纸介绍等固定文案** 预先生成 mp3，做成快照，给 SXY 稳定播放。

## 分工

| 角色 | 做什么 |
|------|--------|
| **YWN** | 写文案（CSV/JSON）、试听、确认通过 |
| **组长** | 批量工具、MiniMax 参数、索引格式、技术排错 |
| **SXY** | 读 `audio-index.json`，用 AudioService 播放 `url` |

## 文案格式

推荐 CSV（可用 Excel 另存为 UTF-8 CSV）：

```csv
id,assetId,text
rabbit_intro,sticker_rabbit_demo,小兔子有圆圆的耳朵……
```

或 JSON：见 `backend/tools/fixed_tts/scripts.example.json`

规则：
- `id`：文件名，仅字母数字 `_` `-`
- `assetId`：对应素材 id（可空，但建议填）
- `text`：要朗读的中文，建议 ≤ 200 字

## 怎么跑

1. 确认 `backend/.env` 里已有 MiniMax 密钥（第 5 步已配过）
2. 双击：`backend\批量固定语音第9步.bat`  
   或只检查不花钱：

```bat
cd backend
.venv\Scripts\python.exe tools\fixed_tts\batch_fixed_tts.py --dry-run
```

3. 输出目录：`frontend/assets/fixed-audio/`
   - `*.mp3`
   - `audio-index.json`

## 索引格式（SXY 用）

```json
{
  "version": 1,
  "purpose": "fixed_snapshot",
  "items": [
    {
      "id": "rabbit_intro",
      "assetId": "sticker_rabbit_demo",
      "text": "……",
      "file": "rabbit_intro.mp3",
      "url": "/fixed-audio/rabbit_intro.mp3",
      "status": "ok"
    }
  ]
}
```

页面播放示例：

```js
const base = 'http://127.0.0.1:8788';
const url = base + item.url; // /fixed-audio/xxx.mp3
await audio.play(url, 'primary');
```

联调时也可打开：`http://127.0.0.1:8788/demo/fixed-audio`

## 注意

- 正式文案由 YWN 替换 `scripts.example.*`，不要把密钥写进 CSV
- 动态问答仍走 `/api/tts/synthesize`，不要和固定快照混用
- 生成失败时索引里 `status` 为 `error`，不要把失败项交给页面
