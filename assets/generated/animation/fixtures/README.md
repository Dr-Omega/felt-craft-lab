# Lottie 动画资源（YWN 注入）

生产 `AnimationService` 的 `DEFAULT_LOTTIE_MAP` 为空；正式 Lottie JSON 由 YWN 交付后通过 `setResourceMap` 注入。

示例：

```ts
animationService.setResourceMap({
  collect: 'felt-resource://animation/collect.json',
  save: 'felt-resource://animation/save.json',
  loading: 'felt-resource://animation/loading.json'
})
```

本目录用于放置本地 fixture JSON（联调/测试），**不要在生产服务代码中硬编码远程 LottieFiles URL**。
