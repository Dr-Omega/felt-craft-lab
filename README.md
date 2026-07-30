# felt-craft-lab

不织布儿童美育创作工具

## 仓库说明

- 组织仓库：`Dr-Omega/felt-craft-lab`
- 组长工作分支：`feature/material-ai-services`

## 第 2 步：ASR（进行中）

- Provider：`qwen_cloud_http`（已接）+ `mock`（已接）+ realtime/local（占位）
- 浏览器冒烟测试：http://127.0.0.1:8788/api/asr/smoke-test
- Mock：http://127.0.0.1:8788/api/asr/mock

## 本地启动（验收）

```bat
cd backend
双击 启动第1步.bat
```

浏览器打开：http://127.0.0.1:8788/api/health  

看到 `"ok": true` 即表示后端空架子可用。
