# 本机真实服务联调配置

本次用于 Windows 本机实测，不是远端生产部署。云服务沿用现有 Qwen、DeepSeek、Seedream 和 MiniMax，不新增 OpenAI 账号，不自动调用付费接口，不启用 mock 或模拟充值。

## 组长填写的位置

真实服务配置只写入仓库的 `backend/.env`。该文件已经创建并被 Git 忽略；不要上传、截图、粘贴到聊天或复制到前端。不要用示例文件覆盖它：其中两个本地签名密钥已经随机生成，应保持稳定。

| 功能 | 填写空值 | 其他设置 |
|---|---|---|
| 语音识别 | `QWEN_ASR_API_KEY` 或 `DASHSCOPE_API_KEY`，二选一 | `QWEN_ASR_PROVIDER=qwen_cloud_http` |
| 故事整理 | 可复用上述 key，或填写独立 `QWEN_STORY_API_KEY` | 模型访问权限需真实请求验证，可设置 `QWEN_STORY_MODEL` |
| 问答、创作意图 | `DEEPSEEK_API_KEY` | 保留 `QA_PROVIDER=deepseek` 和现有 base URL |
| 生图 | `ARK_API_KEY` | 确认 `SEEDREAM_MODEL_ID` 在该账号可用，保留当前风格 profile |
| 动态朗读 | `MINIMAX_API_KEY`、`MINIMAX_GROUP_ID` | 确认已有 `MINIMAX_VOICE_ID`、`MINIMAX_TTS_MODEL` 的权限 |

“填写了密钥”不等于“有效或有余额”；检查命令只报告存在状态，不输出值，也不付费验证。后续按语音识别、问答、生图、故事整理、朗读分别实测；素材固定录音与动态朗读不是同一功能。尚未接 UI 的能力不能因配置完成就报告用户流程完成。

本机费用保险丝为每小时 60 次、每天 200 次（现有服务端调用限额，不是货币预算）；保持 `AI_SMOKE_ENABLED=false`、`ALLOW_SIMULATED_RECHARGE=false`。支付渠道仍未配置。

## 启动方式

### 首次从 GitHub 下载后

GitHub 不含本机密钥、数据库、Node/Python 安装目录或去背景模型。现有电脑更新代码时保留自己的配置与数据；新电脑需要先安装 Node.js >= 22.12 和 Python 3.12，再在项目根目录执行：

```powershell
npm ci
py -3.12 -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
./backend/.venv/Scripts/python.exe scripts/local-test-gateway.py --init
# 如果尚无 .env.local，创建不含密钥的桌面配置；已有文件绝不覆盖。
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

在生成的 `backend/.env` 填写下表所列供应商配置。在 `.env.local` 设置公开地址 `FELT_AI_GATEWAY_BASE_URL=http://127.0.0.1:8788`，并取消注释、填写 `FELT_FABRICATION_PYTHON`、`FELT_BACKGROUND_PYTHON`、`FELT_BIREFNET_CACHE` 三个路径。路径可使用双引号；必须指向本机已经安装好依赖的算法环境和模型缓存，不能照抄其他电脑的路径。模型与算法环境仍需单独准备，不会自动下载。

最后执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/launch-local.ps1 -CheckOnly`，通过后双击 `Start-Felt-Craft.cmd`。启动检查只证明启动条件具备，不证明付费模型权限或余额有效。

如需运行完整开发测试（正常启动不需要），安装 `backend/requirements-dev.txt`，并将该虚拟环境的 `Scripts` 目录加入当前终端 PATH 或激活环境，再运行 `npm test` 与 `python -m pytest backend/tests -q`。素材构建测试需要 `openpyxl`；后端测试需要 `pytest`，两者都不属于应用运行时依赖。

### 双击启动（推荐本机测试使用）

双击项目根目录的 `Start-Felt-Craft.cmd`。本机工作区外层也提供了 `启动不织布.cmd` 入口。

启动器检查配置和算法路径后，自动启动缺失的本地后端，再打开应用。已在运行的健康后端会复用，不会杀进程、覆盖配置或自动调用付费 API。重复双击同一个启动器不会重复打开开发服务。

测试期间保留启动器命令窗口。保存作品后，在该窗口按 `Ctrl+C` 停止前端开发服务；自动启动的后端会继续在后台运行以便下次复用，重启 Windows 后会退出。修改密钥后，仍需重启后端才能加载新配置。不要同时使用手动启动和双击启动打开多个前端。

失败时窗口会保留错误；后台启动日志在 `tmp/launcher-logs/`，不要把密钥配置文件发到聊天。仅检查启动条件、不打开应用：`powershell.exe -NoProfile -File scripts/launch-local.ps1 -CheckOnly`。

### 手动启动

在仓库根目录 PowerShell 中执行：

```powershell
# 不调用云服务，不输出密钥
./scripts/start-local-test.ps1 -Mode Check

# 终端一：保持运行。只监听 127.0.0.1:8788，debug/reloader 关闭。
./scripts/start-local-test.ps1 -Mode Gateway

# 终端二：启动 Electron；从 .env.local 载入本机算法路径
./scripts/start-local-test.ps1 -Mode Desktop
```

如果 8788 已被本次启动的网关占用，不要再开第二个；填写密钥后只重启本次网关。普通前台启动可 Ctrl+C 停止，不批量结束其他 Python/Node 进程。保存代码不会自动重新加载后端配置。

`backend/.env` 在导入任何后端服务前载入，避免模块提前读取默认路径或限额。前端启动器不读该文件，且清理继承的供应商密钥和签名密钥。`.env.local` 仅保存公开网关地址和本机 Python/模型路径；不要往里填写 key。使用此启动器启动分层，单独 `npm run dev` 不保证算法环境变量已载入。

## 本机文件与运行环境

- 后端独立环境：`backend/.venv`；没有向冻结算法/去背景环境安装或升级依赖。
- 分层：复用工作区 `algorithm-v1-venv/Scripts/python.exe`。
- 去背景：复用 `C:/Users/1/miniconda3/envs/felt-br-bench/python.exe`。
- 模型：复用 `felt-craft-lab-checkout/benchmarks/background-removal/models/rembg-cache/birefnet-general.onnx`，禁止自动下载/更换模型。
- 生图参考：已有 8 张 `backend/assets/style-references/felt-style-ref-v1/` 图片。
- 后端账号/业务数据：`tmp/local-test-data/plaza.db` 和 `tmp/local-test-data/uploads/`。虽然位于 Git 忽略目录，**这是本次持久数据，不要作为临时缓存清理**。备份数据与 `backend/.env`；本次没有搬迁、覆盖或导入旧测试数据库。
- Electron 仍使用应用自己的 userData，图层任务位于其中 `fabrication-jobs/`；创建的新本地后端没有旧后端账号，旧客户端会话失效时需要退出并重新注册/登录。

## 未来迁移服务器

本次不开放局域网端口，不将 Flask 开发服务器用于正式部署。以后把后端配置、持久数据与受控凭据迁入服务器，通过 WSGI、HTTPS 和备份部署，再修改终端网关地址。正式环境应关闭开发角色注册并执行账号隔离/冲突/隐私验收。

目前去背景与分层仍在终端本地运行。本次配置没有把 Python 模型变成远端推理服务；无 Python/模型的轻客户端不能仅改网关地址就获得分层能力。

## 本次验收边界

检查记录见仓库外 `local-runtime-check-20261012/SETUP_RESULTS.md`。任何真实 API 密钥、模型权限、余额和端到端云服务调用仍需组长填写后再验收，不用 mock 的成功替代。
