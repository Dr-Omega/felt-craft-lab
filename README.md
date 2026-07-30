# felt-craft-lab

不织布儿童美育创作工具

## 仓库说明

- 组织仓库：`Dr-Omega/felt-craft-lab`
- 组长工作分支：`feature/material-ai-services`

## 第 1 步已完成内容（组长）

统一 **AI 服务后端 / 安全代理** 空架子：

- 前端不存放真实 API Key
- Key 只放在本机 `.env`（不会上传到 GitHub）
- 目前提供健康检查接口；ASR / DeepSeek / MiniMax 后续再接

## 本地启动（验收）

```bat
cd backend
双击 启动第1步.bat
```

浏览器打开：http://127.0.0.1:8788/api/health  

看到 `"ok": true` 即表示后端空架子可用。
