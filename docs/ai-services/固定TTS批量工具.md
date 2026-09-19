# 固定 TTS 批量工具

和「问答时临时合成」不同：这里是把 **贴纸介绍等固定文案** 预先生成 mp3，做成快照。

## 分工

| 角色 | 做什么 |
|------|--------|
| **YWN** | 写文案（CSV/JSON）、试听、确认通过 |
| **组长** | 批量工具、MiniMax 参数、索引格式、技术排错 |
| **SXY** | 读 `audio-index.json`，用 AudioService 播放 `url`（ResourceRef） |

## Electron 正式地址（PR#10 后）

```text
felt-resource://audio/<file>.mp3
```

- 文件落盘：`assets/generated/audio/`
- 索引：`assets/generated/audio/audio-index.json`
- **不要**再把 `/fixed-audio/...` 当作 Electron 正式对接地址  
- `/generated-audio/...` 仅用于浏览器 Flask demo 辅助试听

## 文案格式

CSV 示例见 `backend/tools/fixed_tts/scripts.example.csv`。

## 怎么跑

```bat
cd backend
双击 批量固定语音第9步.bat
```

或：

```bat
.venv\Scripts\python.exe tools\fixed_tts\batch_fixed_tts.py --dry-run
```

## 索引示例

```json
{
  "url": "felt-resource://audio/rabbit_intro.mp3",
  "file": "rabbit_intro.mp3",
  "status": "ok"
}
```

SXY 播放：

```js
await audio.play('felt-resource://audio/rabbit_intro.mp3', 'primary');
// AudioService 在 Electron 内直接使用该 ResourceRef
```

浏览器辅助试听：`http://127.0.0.1:8788/demo/fixed-audio`
