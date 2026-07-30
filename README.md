# felt-craft-lab

不织布儿童美育创作工具的全项目工程基线（Electron + Vue3 + TypeScript）。

本阶段只提供可安装、可启动、可类型检查、可测试、可构建和可 Windows 打包的最小桌面应用骨架。  
**不包含**素材库页面、Dexie、Manifest、Fabric 业务或真实 AI 接口。

## 技术栈

- Electron + electron-vite
- Vue 3 + TypeScript
- Vitest
- electron-builder（Windows NSIS）

## 包管理器

唯一包管理器：**npm**（Node.js >= 20）。

请只使用 package-lock.json，不要引入 pnpm-lock.yaml 或 yarn.lock。

## 目录映射

`	ext
src/main/          Electron 主进程与静态资源路径解析（SXY）
src/preload/       contextBridge 安全入口（SXY）
src/renderer/      Vue3 Renderer 最小首页（SXY）
src/shared/        跨模块常量/契约/错误形态占位（契约由 ZXR 维护）
server/            AI 网关安全入口占位（TSH）
scripts/           导入与校验脚本占位（SXY / TSH）
assets/            generated + runtime 资源目录
docs/              工作流与架构文档
tests/             冒烟测试
`

## 常用命令

`ash
# 安装依赖
npm install

# 若 Electron 二进制缺失（常见于受限网络）
node node_modules/electron/install.js

# 开发启动（Electron + Vite）
npm run dev

# 类型检查
npm run typecheck

# 单元测试
npm test

# 生产构建（输出到 out/）
npm run build

# Windows 安装包（NSIS）
npm run dist:win

# Windows 免安装目录包（更快验证打包链路）
npm run dist:win:dir
`

> Windows 打包说明：若仓库路径含非 ASCII 字符导致 electron-builder 卡住，请复制到纯英文路径后再执行打包命令。国内网络可使用仓库内 .npmrc 的 Electron / builder binaries 镜像，或设置环境变量 ELECTRON_MIRROR 与 ELECTRON_BUILDER_BINARIES_MIRROR。

## 本地环境

1. 复制 .env.example 为 .env（可选，当前基线不依赖真实密钥）。
2. 运行 
pm install。
3. 运行 
pm run dev，确认首页能显示主进程 ping 结果和 Windows 静态资源路径。

## 模块接入说明

- 共享 Contracts 已合入 integration/material-library；本 PR 合入 develop 后，由 ZXR 发起 develop → integration/material-library 同步。
- 业务功能请从对应 integration/<module> 拉出 eature/<module>/<task>，不要在本基线分支实现素材库/编辑器/AI。
- 根级依赖与目录变更前先说明影响范围，并由 ZXR 审核。

## 分支

- 工作分支：chore/project-bootstrap
- 合并目标：develop（不直接进 main）
