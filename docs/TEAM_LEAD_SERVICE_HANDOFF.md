# 组长交接：共享服务器、AI 服务和支付接口

本文件不含真实密钥。组长在服务器秘密配置中填写；不要发到聊天、GitHub、前端 `.env` 或安装包。复制 `backend/.env.example` 时正式环境设置 `APP_ENV=production`，不能用开发 mock 冒充上线。

## 1. 终端和服务器分工

- 所有终端连接同一个 HTTPS Gateway。构建时设 `FELT_AI_GATEWAY_BASE_URL`，或 Electron 运行时设 `AI_GATEWAY_BASE_URL`。终端只存登录令牌，不能分发供应商 API Key。
- Flask 保存账号、余额、支付订单、分享内容和私有作品同步。设置持久的 `PLAZA_DB_PATH`、`PLAZA_UPLOAD_DIR`，数据库与文件一起备份；服务重启不能丢失目录或更换签名密钥。
- `PLAZA_JWT_SECRET` 是真实用户登录签名密钥；`AI_SESSION_HMAC_SECRET` 是安装实例 AI 会话签名密钥。两个用途不同，应分别随机生成至少 32 字符，不复用开发占位值。
- SQLite 适用于单服务器、有限并发；不把其文件放网络共享盘。反向代理提供 HTTPS、请求体上限、限流和访问日志，WSGI 托管 Flask，不能直接公开 debug server。多副本部署前需要迁移存储/限流，不能仅多开互不共享状态的进程。
- 本轮同步是完整账号工作区快照的乐观并发控制，不是多人实时协同。多个终端同时编辑会提示冲突，不悄悄取“最后写入”。
- 正式环境不能从公开注册接口自行获得教师或管理员身份；需组长审核后在受控管理流程配置。开发环境的角色选项不是正式授权机制。没有所属账号的历史演示/算法任务不会自动归给新登录用户。

## 2. 组长填写的服务项（来自当前源码）

|功能|服务端配置|前端验收路径|
|---|---|---|
|语音识别|`QWEN_ASR_API_KEY` 或 `DASHSCOPE_API_KEY`；`QWEN_ASR_PROVIDER=qwen_cloud_http`|录一段语音，确认识别文字与录音一致；空音频/无权调用应有错误|
|素材问答与口语创作意图|`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`QA_PROVIDER=deepseek`（意图默认复用）|同一素材连续追问，检查上下文与取消后无迟到回答|
|动态朗读|`MINIMAX_API_KEY`、`MINIMAX_GROUP_ID`、`MINIMAX_VOICE_ID`、`MINIMAX_TTS_MODEL`、`TTS_PROVIDER=minimax`|实际播放返回音频，验证失败和停止；素材固定介绍音频不需实时生成|
|生图|`ARK_API_KEY`、`IMAGE_PROVIDER=seedream_ark`、`SEEDREAM_MODEL_ID`、`IMAGE_PROFILE_CORE_PATTERN`|生成→确认→当前画布入图→自动准备分层；核对模型权限、地区、余额和参考图部署|
|故事整理|优先 `QWEN_STORY_API_KEY`，否则复用 ASR/DashScope key；可设 `QWEN_STORY_MODEL`|完成录音→补充→故事草稿→人工确认；服务默认模型必须在该账号可用，不可用时由组长选可用模型|
|本地去背景/分层|不需要云 API key；`FELT_FABRICATION_ROOT`、`FELT_FABRICATION_PYTHON`、`FELT_BACKGROUND_PYTHON`、`FELT_BIREFNET_CACHE`|原图确认后 BiRefNet General→分层→画布换色→保存恢复|

供应商和模型的可用性需组长在自己的账号验证；没有以本批测试代替真实云调用。限流、超时和错误不可通过扩大权限或关闭检查绕过。

**部署重要限制：** 现有模型任务仍由 Electron 主进程启动本地 Python，不是服务器推理队列。多终端只要各有运行环境就能运行；若终端是无 GPU/无 Python 的轻客户端，要另行把已验证 worker 部署成服务器任务服务。本批没有暗中把它改为远端模型平台。

## 3. 接入验收顺序

1. 部署持久数据库/文件与 HTTPS，配置两个签名密钥；确认健康检查，不在日志打印密钥或完整录音。
2. 两终端登录同一账号：A 保存作品→同步→B 登录并继续；检查图片、图层换色、录音和素材版本可读。不同账号不得读写彼此快照或资源块。
3. A 离线编辑，B 同时修改并上传；A 重连必须提示冲突。选择云端时本机旧版本保留在 IndexedDB `syncBackups`，原始资源字节不覆盖；备份恢复目前由维护人员操作，尚无备份浏览 UI。
4. 逐项配置 AI key，分别走表中真实流程并记录供应商请求 ID、耗时与错误（不得记录 key）。不以 mock 的 PASS 替代这些步骤。
5. 最后验证分享发布/撤回；公开内容仅预览和标题。私有同步包含作品和录音，不等于公开分享。

同步限制：单资源 30 MiB、分块 512 KiB、账号资源配额 1 GiB、清单 2 MiB、单次恢复 256 MiB；超限明确失败，保留本机。当前没有自动垃圾收集或后台断点上传承诺。素材固件需在各终端部署相同快照；同步不能用另一份素材顶替丢失快照。同步是私有数据存储，上线前需落实告知、家长授权、保留期限和删除流程。

离线保存指已经登录并打开应用后的编辑保存；冷启动离线登录尚未接入。自动同步在大厅、个人中心和作品列表触发，另有“立即同步／重试”；编辑过程中不拉取云端覆盖画布。未完成模型任务不跨设备迁移，只同步已完成且归属明确的展示/换色资源，不把迁移当成重新运行几何验收。

## 4. 支付渠道交接（渠道尚未确定）

已接统一 API，默认不收款、不发钻石。`GET /api/payments/capabilities` 返回不可用；UI 展示未配置，不再调用模拟增加余额。

- `POST /api/payments/orders`：登录令牌 + `packageId` + `requestId`。价格/币种/钻石由服务器套餐表决定；重复请求复用订单，相同请求改套餐返回冲突。
- `GET /api/payments/orders/<id>`：只查本人订单，可通过渠道查询补偿漏回调。
- `POST /api/payments/orders/<id>/cancel`：先经渠道确认，不能只改本地状态。
- `POST /api/payments/callback`：不信任客户端“成功”。适配器验证原始请求签名、时间/重放、商户/应用身份、金额/币种及成功状态，再返回 `VerifiedPayment`。
- `PaymentProvider` 接口在 `backend/services/payments.py`：`create/query/cancel/verify_callback`。下单必须以内部订单 ID 作为商户幂等键；具体微信/支付宝签名、证书、支付拉起/二维码、回调应答协议需选定渠道后实现并沙箱验收。本轮不伪造通用签名等于已接通某个渠道。
- 确认支付、唯一交易 ID、余额变动、账本写入在同一事务。重复/并发通知只入账一次；取消后迟到支付返回人工对账状态，不吞掉、不重复发货。退款、真实付款确认 UI 和商户日对账尚待渠道接入。
- 旧 `/api/rewards/recharge` 默认关闭；只有开发/测试显式 `ALLOW_SIMULATED_RECHARGE=true` 才能模拟，不允许正式环境启用。

## 5. GitHub 已有导出的准确边界

核对 `feature/projection/display-and-layout@5611cd8`、`feature/projection/explode-ui-v2@de25cc1`：存在图层排版 PDF、尺寸选择与导出 UI。后者原入口使用固定 `createProjectionDemoScene()`，并有未接通的完成/返回按钮。本批复用其 UI/排版接到当前已保存作品，不能把固定演示当真实作品。

此 PDF 是图像图层排版参考，不是物理裁片矢量纸样，不承诺切割边界、真实尺寸、材料厚度或制造验收。个人中心“制作图纸”不能把普通拼贴自动归类成已验收制造图纸。

## 6. 视频功能补充（2026-10-10）

视频中的个人中心、成长中心、兑换、邮箱、小熊房间来自已整合的 `feature/personal-center-growth-ui@010da910`（2026-10-08）。本次经 GitHub API 回读，分支仍为该提交；没有用旧本地远端引用判定最新状态。

补充 `PUT /api/rewards/bear/room`：儿童登录账号保存 `character`、`furniture`、`revision`。数据库自动新增 `bear_room_settings`；`GET /api/rewards/dashboard` 返回该账号的 `room`。客户端不得指定其他用户；过期 revision 返回 409，需明确重新载入，不静默覆盖。保存偏好不收费、不发奖励，不属于购买角色解锁。

房间仍复用组员的小熊原画，角色动作仅文字反馈、配色是整图滤镜预览；没有声称已有独立家具换肤或角色动画。对应图片/动画和购买解锁规则确定后再扩展，不能将随机盲盒展示当作持久角色库存。

本次类型检查、构建、657 项前端测试、133 项后端测试（另 2 subtests）通过。实际 Electron + Flask 隔离账号复核兑换→领奖→喂食→保存房间→离开返回恢复，以及外部更新后的冲突拒绝/重新载入；1440×900、960×640 与键盘焦点检查完成。证据在仓库外 `frontend-flow-audit-20261010/video-2/`，未上传测试账号数据库。真实支付/AI 配置状态不因本次检查而改变。
