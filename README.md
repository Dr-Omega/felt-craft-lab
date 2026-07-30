# felt-craft-lab

不织布儿童美育创作工具

## 仓库说明

- 组织仓库：`Dr-Omega/felt-craft-lab`
- 组长工作分支：`feature/material-ai-services`

## 第 5 步：MiniMax TTS（进行中）

- 冒烟测试：http://127.0.0.1:8788/api/tts/smoke-test
- 成功后把返回的 audioUrl 接到地址栏播放，例如：http://127.0.0.1:8788/api/tts/audio/xxxx.mp3
- Mock：http://127.0.0.1:8788/api/tts/mock

## 本地启动（验收）

```bat
cd backend
双击 启动第1步.bat
```

浏览器打开：http://127.0.0.1:8788/api/health  

看到 `"ok": true` 即表示后端空架子可用。
