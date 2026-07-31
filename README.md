# felt-craft-lab

不织布儿童美育创作工具

## 仓库说明

- 组织仓库：`Dr-Omega/felt-craft-lab`
- 组长工作分支：`feature/material-ai-services`

## 第 10 步：错误码与重试/降级（进行中）

- 文档：`docs/ai-services/错误码与重试降级.md`
- 环境模板：`backend/.env.example`（复制为 `.env`，勿提交密钥）
- 在线规则：http://127.0.0.1:8788/api/ops/rules

## 本地启动（验收）

```bat
cd backend
双击 启动第1步.bat
```

浏览器打开：http://127.0.0.1:8788/api/health  

看到 `"ok": true` 即表示后端可用。
