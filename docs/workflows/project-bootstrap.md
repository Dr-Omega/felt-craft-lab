# 项目启动基线

## 目标

为素材库与背景贴纸模块建立可运行、可测试、可构建的最小工程基线。此阶段只搭建工程骨架，不实现业务功能。

## 责任人

- 主负责人：SXY
- 根级结构与共享依赖审核：XR
- AI服务接口占位建议：组长

## 目标分支

`chore/project-bootstrap`

## 必须完成

1.使用Vue3、TypeScript和Electron建立最小可运行桌面应用。
2.确定并锁定包管理器，不混用锁文件。
3.提供开发、类型检查、测试、构建和Windows打包命令。
4.建立renderer、main、shared、server、scripts、assets、docs和tests的最小目录映射；不提前填充其他成员负责的业务实现。
5.配置基础TypeScript、Vite、Electron安全入口和路径别名。
6.提供最小首页，用于确认Renderer和Electron主进程能够正常启动。
7.建立`.gitignore`和`.env.example`，禁止真实密钥进入仓库。
8.提交README中的本地启动与验证说明。

## 暂不完成

- Fabric编辑器；
- 素材库业务页面；
- Dexie收藏和草稿；
- Qwen、DeepSeek和MiniMax真实调用；
- AudioService和AnimationService实现；
- 素材Manifest转换；
- 任何真实API密钥或儿童数据。

## 验收命令

最终PR必须给出并实际验证：

```text
安装依赖
开发启动
类型检查
单元测试
生产构建
Windows打包或等价构建验证
```

## 合并要求

- 目标分支：`integration/material-library`
- 不直接合并到`main`
- PR中必须说明变更文件、命令结果、已知问题及XR后续建立共享Contracts所需的路径
