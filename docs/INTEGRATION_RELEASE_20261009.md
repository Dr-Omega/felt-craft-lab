# 项目流程整合与共享服务器接口 — 2026-10-09

分支：`integration/creation-flow-v1`。父提交：`81698b9fea0099ca1f95668e3e867078bc0b7d07`。
承接本工作树已有整合，保留团队 UI、素材、画布内图层换色和算法适配，不替换美术设计、不重跑算法研究。最终提交身份以 `git rev-parse HEAD` 和远端分支回读为准；本文不将本地验证冒充远端发布或线上服务验收。

## 用户现在可以走的路径

1. 标题页 → 登录/注册 → 森林大厅；头像进入个人空间，分享区进入分享社区，书架进入学习，蘑菇/开始创作进入作品与素材。
2. 锁定主题 → 引导创作（独立任务，不修改自己的作品）→ 按现有关卡放置并听讲解 → 整个主题解锁 → 自由创作使用。生成自己的图片不自动解锁主题。
3. 作品列表 → 新建并选主题/继续作品 → 上传或确认生成图 → 自动排队准备前景及分层 → 在完整画布中双击元素、编辑其制作层颜色 → 保存。模型环境未就绪时明确报错，不替换成演示分层。
4. 保存 → 故事卡/已保存作品展示 → 实际图层展开 → 当前作品图层排版 PDF → 返回作品。不是固定演示图，不宣称制造可用纸样。
5. 个人空间 → 本人作品继续编辑/发布预览 → 分享列表/详情 → 本人撤回。默认仅公开图片与标题；故事文字与录音仍私有，本次没有开放它们的公开发布功能。
6. 账号 → 成长中心/余额/收件箱/兑换；充值进入订单 UI，未配置支付渠道时没有可收款动作。渠道选定后实现适配器并进行商户沙箱联调，不能只填一个 key 就声称接通。
7. 同一账号 A 保存并同步 → B 登录恢复数据和私有资源 → 继续打开；A/B 同时修改则提示冲突，选择云端前保留本机备份。不同账号隔离。已登录时断网仍可本机保存。

## 本次新增与复用来源

- GitHub 有排版导出：`feature/projection/display-and-layout@5611cd8378827b93e38b82e97764e8b7df5c9f6e`、`feature/projection/explode-ui-v2@de25cc12baaf55a9b8a6befb5543cf6c0e9d3208`。复用 ExportScreenV2、排版 PDF 与对应 PS 资源；原 V2 入口使用固定 demo，本次改为 WorkDisplay 当前保存作品。尺寸为图层排版参考，不是裁片矢量/制造资格。
- 支付：渠道无关下单/查单/取消/回调入口、适配器验签边界、订单归属、金额/币种核对、交易唯一约束与事务幂等入账。旧模拟充值默认关闭，正式环境不能打开。真实渠道、退款与对账未假装完成。
- 同步：账号私有内容寻址分块 + 原子清单版本；服务端校验文件大小和摘要；主进程只恢复快照声明资源，拒绝路径越界及同名不同字节；Renderer 在事务内更换当前账号工作区并备份。恢复作品和个人素材调用正式资源合同而非测试 mock 策略。
- 图片任务：主进程核验登录账号；未绑定任务增加持久 owner，排队复用键包含账号。不同账号不能复用/读取/重试彼此任务，旧无主任务不自动认领。
- 素材、学习、个人中心与分享来源详见既有 `MATERIAL_V2_IMPORT.md`、`THEME_GUIDED_CREATION.md` 及阶段记录。完整供应商/部署交接见 `TEAM_LEAD_SERVICE_HANDOFF.md`。

## 实际验证（不以测试数替代流程）

| 检查 | 结果/范围 |
|---|---|
| TypeScript | node/web/test 三项通过 |
| Vitest | 101 文件，657 通过，0 失败 |
| Flask/Python | 124 通过，2 subtests 通过；31 条既有 Pillow 弃用警告 |
| 素材构建 unittest | 11 通过；在已有含 openpyxl 的 jupyter-env 运行 |
| Build | Electron 主进程、preload、Renderer 构建通过；存在同步模块动态/静态重复引入的打包提示，不影响功能 |
| 支付测试 | 未配置拒绝、重复下单、超时恢复同订单、金额/币种错误、交易复用拒绝、并发回调只入账一次、取消与迟到付款；验签使用测试适配器，不代表真实渠道通过 |
| 同步单测 | 离线重试、revision 冲突、跨账号拒绝、缺块/损坏拒绝、孤立版本拒绝、下载期间本机编辑保护、不同账号 ID 冲突不覆盖 |
| Electron 实际流程 | 标题→登录→大厅→个人空间/学习/分享/创作；实际中秋三贴纸/九段音频完成后解锁五素材；发布/撤回、账号切换、重开持久化 |
| 两终端 | 两套独立 userData + 实际 Flask/SQLite；B 恢复 A 的作品/预览并展示；关闭服务器后两端都可保存，重连拒绝静默覆盖，显式选择后本机旧版本备份仍在 |
| 图层及录音迁移 | 已有真实三层柿子产物的隔离测试副本，绑定测试账号；第一端第三层换成紫色，第二端保持三层和颜色，PNG 摘要相同；合成 WebM 经真实保存 IPC 及云同步逐字节恢复。未重跑模型、未声称模型质量验证 |
| 排版导出 | 实际新建月牙作品→保存→展示/展开→导出；生成有效 PDF，包含本作品而非 demo。长图排版越界有专项测试 |

本地详细证据在仓库同级 `frontend-flow-audit-20261009-source/`：`services-3/`、`sync-conflict-2/`、`layer-sync-3/`，对应 `check-services.cjs`、`check-sync-conflict.cjs`、`check-layer-sync.cjs`。包含测试截图、实际 PDF、原始 HTTP 日志、结果 JSON；没有上传测试账号数据库、userData 或录音到源码仓库。
本机 Browser 专用技能不可用，按前端验证技能采用已有 Playwright 驱动真实 Electron；人工查看了 1440×900 和 960×640 截图、支付提示、导出页、冲突界面及恢复后的图层。导入时的四份乱码副本已移到仓库外恢复目录，正确资源保留。

复现基础门禁：`npm run typecheck`、`npx vitest run`、`npm run build`、`PYTHONPATH=backend python -m pytest backend/tests -q`、`python -m unittest discover -s tests/assets -p test_build_ywn_manifest.py -v`。本机 Node 单测使用现有 Electron 运行时，通过 `ELECTRON_OVERRIDE_DIST_PATH` 指向 `felt-craft-lab-fabrication-ui-v1/node_modules/electron/dist`；未构建可选 canvas 原生包隔离保存，未改测试绕过业务断言。

## 尚需组长/后续接入的边界

- AI key、服务权限与余额由组长配置，真实云服务未在本批调用；不要把 fixture 响应当上线联调。
- 作品数据在共享服务器同步，但模型任务目前仍在终端 Electron 启动 Python；轻终端若无模型环境，需另接服务器 worker，不能仅靠作品同步解决。
- 暂无离线冷启动登录、多账号实时协作、自动备份浏览/垃圾回收。同步替换是整个账号工作区，不是逐对象自动合并。
- 教师/管理员生产账号需受控授权，学习进度同步不是服务端防作弊；上线需补部署侧限流、隐私告知、备份和运维。
- PDF 仍为图层图像参考；制造与生产导出未验收。未修改 benchmarks、R4、冻结算法、后台去背景处理或正式 M3/B2 分支。

`INDEPENDENT_REVIEW=PENDING`；`USER_VISUAL_ACCEPTANCE=PENDING`；`MANUFACTURING=NOT_EVALUATED`；`PRODUCTION_EXPORT_ELIGIBLE=NO`。
