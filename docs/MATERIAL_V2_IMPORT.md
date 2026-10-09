# 素材 V2 接入记录

## 来源与范围

- 用户指定源分支：`content/material-assets-v2`。
- 固定来源提交：`1cdf77db19d99bc1446277c86783bb09c5f595d6`。
- 总表：该提交的 `素材库.xlsx`，71 条 `ready` 且 `licenseStatus=approved` 的记录，15 个主题。
- 新应用快照：`snapshot_ywn_material_v2_1cdf77d`。21 张背景、50 张贴纸，142 张 PNG（原图及缩略图）、213 段 MP3。
- 378 个来源 PNG/MP3/XLSX 均按 Git blob SHA 与文件大小核验。正式使用的 355 个媒体文件再由测试独立核验。
- 原表、主题表及原媒体只读，不把缩略图作为原图。总表优先于旧主题分表；未列入总表的额外图片不自动入库。

`docs/material-v2-source-map.json` 记录来源路径、大小、blob SHA 和两项文件名映射。
植物桂花原图在源分支误名为 `plants/stickers/sticker_plum_blossom_001.png`；冬天梅花原图为 `winter/stickers/sticker_plant_plum_002.png`。
这两项与 `feat/learning-zone-formal-ui` 的 `c061b607ca6c6a0fecb93c57adb393c7f3b76e1d` 已发布派生图字节完全相同，并已查看原图/对应缩略图。
只在临时导入副本增加规范文件名，图片不重绘，源文件不改名、不覆盖；映射不是全局同名回退。

学习分支派生清单的灯笼、汤圆介绍与源分支总表不同。本次未直接照搬该清单，重新由指定源总表生成。
月牙在新版总表使用 ID `sticker_moon_001`，名称“月亮”；旧 `sticker_crescent_moon_001` 仍仅在旧快照中解析，未篡改旧作品身份。

## 实际连接

1. 素材库和新作品使用新快照，显示 15 个主题中文名称。
2. Main 学习引擎和 Renderer 使用同一最新快照；21 个关卡绑定实际原图、轮廓和三段讲解音频。
3. 完成凭据的贴纸集合必须等于当前主题素材集合。解锁与进度原子保存，解锁素材能放进原有画布。
4. 旧快照的原图、音频、清单保持不变。旧作品按保存的快照解析，不回退到新素材。
5. AI 生成内容可创作，但不授予主题学习权限。尚未接入真实账号或分享发布，本次不宣称整个项目已经贯通。

## 复现

从固定来源提交取得 PNG/MP3/XLSX 到新的临时目录，然后在仓库根目录运行（不要指向历史证据）：

```powershell
python scripts/prepare-material-v2-aliases.py --source <素材临时副本>
python scripts/build-ywn-manifest.py --source <素材临时副本> --source-pack "content/material-assets-v2@1cdf77db19d99bc1446277c86783bb09c5f595d6; 素材库.xlsx; byte-preserving aliases: docs/material-v2-source-map.json" --snapshot-id <新的唯一快照ID>
```

已存在的快照 ID 拒绝覆盖。现有 71 条记录的许可状态仅按源表批准字段导入，不等同于本次独立版权审查。

## 验证

本节记录素材接入时的历史验证。2026-10-09 后续已按用户确认改为“主题页 → 真实创作画布引导 → 整主题解锁”，原独立拖放 UI 不再使用；当前验证见 `THEME_GUIDED_CREATION.md`。

- 全量 Vitest：95 文件、628 通过、0 失败。
- 导入器 Python 回归：11 通过；覆盖主表优先、损坏表头不回退、重复 ID 拒绝，以及已有版本/回滚/许可检查。
- `npm run typecheck`、`npm run build`：通过。
- `git -c core.whitespace=cr-at-eol diff --check`：通过；旧快照路径无差异。
- 全部 21 关卡逐个放置、拒绝非法位置、生成准确完成凭据，覆盖 15 主题。
- 355 个实际媒体通过 Electron 的 `felt-resource` 协议加载及图片/音频元数据解码，无缺文件。
- 真实 UI：中秋三贴纸拖放、九段真实音频播放、仅该主题五项权限解锁、两轮问答 IPC/HTTP、素材加入画布、刷新保留学习记录、端午新素材显示。
- 1440×900、960×640 截图已查看。QA 回复是本地测试服务，不声称验证云模型效果；未调用付费 Provider。
- 第一次 UI 脚本仍按旧名称“月牙”查找而失败，修正为总表名称“月亮”后完整重跑通过，未改写素材名称迁就测试。
- 工作区证据：`frontend-flow-audit-20261008/material-v2-ui-02/result.json` 及同目录截图。源码仓库与测试输出分开。
- 生成与任务队列额外复核：`material-v2-generation-permission-01`，`TASK_QUEUE_UI_PASS`，确认 AI 图片确认后立即处理，但学习素材权限仍为空。模型及 worker 使用受控测试替身，不宣称算法效果验证。

仍在本地集成分支，未提交或推送；不修改正式分支、算法或冻结证据。
