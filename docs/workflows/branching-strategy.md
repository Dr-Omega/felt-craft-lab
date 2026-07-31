# 仓库分支与合并策略

## 1.适用范围

本仓库承载“不织布儿童美育创作工具”整个项目，不属于单一素材库模块。所有模块开发均使用同一套项目级分支规则。

## 2.分支层级

```text
main
└─develop
   ├─integration/material-library
   ├─integration/image-generation
   ├─integration/layer-splitting
   ├─integration/template-layout
   └─integration/making-guidance
```

具体任务从对应模块集成分支创建：

```text
feature/<module>/<task>
fix/<module>/<task>
chore/<task>
docs/<task>
```

## 3.分支职责

### `main`

- 全项目稳定版本；
- 只接收来自`develop`的发布PR；
- 不直接开发，不直接推送；
- 合并前必须完成项目级验收。

### `develop`

- 全项目统一集成分支；
- 接收工程基线、跨模块公共能力和已完成模块；
- 不接收未经模块联调的零散功能分支；
- 进入`main`前统一执行构建、测试和演示路径验证。

### `integration/<module>`

- 单个复杂模块的联调分支；
- 接收该模块的`feature/*`和`fix/*`PR；
- 模块验收通过后向`develop`发PR；
- 不承担其他模块的长期集成职责。

### `feature/<module>/<task>`

- 单个功能或明确工作包；
- 从对应`integration/<module>`创建；
- 只修改当前角色负责的范围；
- 通过PR合入模块集成分支。

### `chore/<task>`和`docs/<task>`

- 全项目工程、工具、CI或文档任务；
- 全项目级任务通常从`develop`创建并合回`develop`；
- 仅属于某一模块的任务从对应模块集成分支创建。

## 4.当前素材库模块分支

```text
integration/material-library
feature/material-editor-core
feature/material-ai-services
feature/material-ui-workflows
```

以上3条既有功能分支在首次同步工程基线前暂时保留。后续新建任务统一采用带模块命名空间的形式：

```text
feature/material-library/editor-core
feature/material-library/ai-services
feature/material-library/ui-workflows
```

不得在现有分支尚有未合并提交时直接删除或重建。

## 5.标准合并路径

模块功能：

```text
feature/<module>/<task>
→integration/<module>
→develop
→main
```

全项目工程任务：

```text
chore/<task>
→develop
→main
```

## 6.PR要求

每个PR至少包含：

- 目标和范围；
- 变更文件；
- 接口或共享契约变化；
- 验证命令和结果；
- 截图、日志或测试证据；
- 已知问题；
- 下一位成员需要执行的接入步骤。

功能分支不得直接向`main`发PR。模块功能分支不得绕过`integration/<module>`直接进入`develop`。

## 7.受保护分支

项目核心Ruleset应保护：

```text
main
develop
```

模块Ruleset应保护：

```text
integration/*
```

最低规则：

- 禁止删除；
- 禁止强制推送；
- 必须通过PR；
- 至少1人批准；
- 新提交后旧批准失效；
- 最近一次可审查推送需由其他人批准；
- 合并前解决全部讨论。

`feature/*`、`fix/*`、`chore/*`和`docs/*`不设置同等保护，保证成员能够正常推送开发提交。

## 8.工程基线同步

`chore/project-bootstrap`合入`develop`后：

1.由ZXR发起`develop`到`integration/material-library`的同步PR；
2.模块集成分支合并工程基线；
3.ZXR、TSH和SXY分别同步模块集成分支；
4.三条角色分支再开始提交正式业务代码；
5.不得在工程基线同步前各自创建不同的Vue、Electron或依赖配置。