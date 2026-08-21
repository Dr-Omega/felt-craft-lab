# 本地 SD + LoRA（画风锁定）

语音生图默认仍可用通义万相（`wan_dashscope`）。若要**统一不织布扁平卡通画风**，把 Gateway 切到本机 Stable Diffusion WebUI，并用 LoRA 锁风格。

## 一句话流程

```text
Canonical Prompt（程序已编译）
  → Gateway IMAGE_PROVIDER=sd_local
  → Automatic1111 /sdapi/v1/txt2img
  → 自动追加 <lora:名字:权重>
  → PNG → 抠图 / 质量检查 → 预览
```

Electron **不直连** WebUI：仍走 Main → Gateway（`8788`）→ `sd_local`。

## 本机准备

1. 安装 [Automatic1111 Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui)（NVIDIA 显卡更稳；无 GPU 可试 CPU，会很慢）。
2. 下载一个**卡通 / 贴纸风** checkpoint（SD 1.5 系更省显存，例如各类 “flat / sticker / chibi” 底模）。
3. 把不织布风格 LoRA 放到 `models/Lora/`，记下**不含扩展名**的文件名，例如 `felt_cartoon.safetensors` → `felt_cartoon`。  
   - 若还没有自训 LoRA：可先用社区「flat color / sticker / children’s illustration」类 LoRA 做 Demo，再换你们自己的（见下方「暂无自训权重时」）。
4. 启动 WebUI 时打开 API：

```text
webui.bat --api --listen
```

默认地址：`http://127.0.0.1:7860`。浏览器打开该地址，确认能正常出图后，再切 Gateway。

## 暂无自训权重时（社区 LoRA Demo）

组员训好 `.safetensors` 之前，可用社区扁平/贴纸风 LoRA 先跑通产品链路。**不要把别人的权重提交进本仓库**；只在本机 WebUI 目录使用。

| 步骤 | 做什么 |
|------|--------|
| 1 | 在 [Civitai](https://civitai.com) / Liblib 搜关键词：`flat color`、`sticker`、`chibi`、`children illustration`、`simple flat` |
| 2 | 选 **SD 1.5** 系 LoRA（与底模同一代；XL 需换 XL 底模） |
| 3 | 下载到本机 A1111：`models/Lora/<名字>.safetensors` |
| 4 | `.env` 里设 `SD_LOCAL_LORA_NAME=<名字>`（不含扩展名），例如社区文件 `flat_sticker_v1.safetensors` → `flat_sticker_v1` |
| 5 | 权重建议从 `0.6`～`0.8` 试；过拟合再降 |

示例（占位名，请换成你本机真实文件名）：

```env
IMAGE_PROVIDER=sd_local
SD_LOCAL_BASE_URL=http://127.0.0.1:7860
# 示例：先用社区扁平贴纸 LoRA；组员自训完成后改成 felt_craft_v1 等
SD_LOCAL_LORA_NAME=flat_sticker_v1
SD_LOCAL_LORA_WEIGHT=0.7
```

自训完成后：只需替换文件并改 `SD_LOCAL_LORA_NAME`，**不必改业务代码**。

## Gateway 配置（`backend/.env`）

```env
IMAGE_PROVIDER=sd_local
SD_LOCAL_BASE_URL=http://127.0.0.1:7860
SD_LOCAL_LORA_NAME=felt_cartoon
SD_LOCAL_LORA_WEIGHT=0.8
# 可选：与 WebUI 里 Checkpoint 下拉显示的名字一致
# SD_LOCAL_CHECKPOINT=
SD_LOCAL_STEPS=25
SD_LOCAL_CFG=7
SD_LOCAL_SAMPLER=Euler a
SD_LOCAL_SEED=-1
SD_LOCAL_TIMEOUT_SEC=120
```

改完后**重启 Flask**。检查：

```text
GET http://127.0.0.1:8788/api/health
```

应看到：

- `providers.image` 含 `sd_local`
- `selected.image` 为 `sd_local`
- `keysConfigured.sdLocal` 为 `true`

## 冒烟步骤

1. WebUI 已 `--api` 启动，本机能访问 `7860`。
2. Flask 用上面 `.env` 重启。
3. Electron「生成作品」：说一句完整描述 →「就这样画」。
4. 预览应在约 10～60 秒内出现（视显卡而定）。
5. 「再画一张」应得到**不同**结果（`SD_LOCAL_SEED=-1`）。

## 没有 GPU / 暂时没装 WebUI

继续用：

```env
IMAGE_PROVIDER=wan_dashscope
```

或开发态：

```env
IMAGE_PROVIDER=mock
```

## 边界

- Provider **不改写** Canonical Prompt 的风格句子，只追加 LoRA 标签。
- 本地 SD **不计入**付费 API 保险丝（用的是本机显卡）。
- ControlNet 未接；姿势控制可在后续版本加。
- ComfyUI 未接；当前只认 A1111 `txt2img` API。
- 若 `SD_LOCAL_LORA_NAME` 为空，仍会出图，但**画风不会被 LoRA 锁定**。
