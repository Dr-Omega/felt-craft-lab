# 组长 · AI 服务说明（第 1 步）

## 目标

建立安全代理：密钥只在服务端 `.env`，前端只调用本仓库后端接口。

## 当前接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查；只返回密钥是否配置，不返回密钥内容 |
| GET | `/api/ready` | 第 1 步就绪标记 |

## 环境变量

见 `backend/.env.example`。复制为 `.env` 后填写；`.env` 已被 `.gitignore` 忽略。

## 下一步（先别做）

1. 接 Qwen3-ASR-Flash HTTP  
2. 统一 AsrResult  
3. Mock 供 SXY 并行开发  
