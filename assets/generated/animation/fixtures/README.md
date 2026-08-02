# Lottie 动画资源（待资源方案确认）

生产 `AnimationService` 的 `DEFAULT_LOTTIE_MAP` 为空；正式 Lottie JSON 由 YWN 交付后通过 `setResourceMap` 注入。

**重要（PR#10 冻结）：** `felt-resource` 当前 kind 仅为 `material | audio | preview`。  
本 PR **不新增** `animation` kind。请勿编写或接入 `felt-resource://animation/...`——解析层会拒绝。

待 ZXR 确认 animation 资源根/协议扩展后，再由资源解析层统一实现与测试。在此之前，联调可用本地文件路径注入（非 ResourceRef），或等待正式方案。

本目录可放置本地 fixture JSON 供未来方案使用；**不要在生产服务代码中硬编码远程 LottieFiles URL**。
