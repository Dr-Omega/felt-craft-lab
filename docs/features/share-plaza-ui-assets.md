# 分享广场 UI 素材替换清单

当前实现使用 **占位布局 + 现有素材复用**。你确认美术稿后，按下列项替换即可。

## 已复用（无需新文件即可运行）

| 用途 | 当前文件 | 说明 |
|------|----------|------|
| 广场全屏背景 | `assets/ui/psd160/background.png` | 与三动物界面同源 |
| 装饰层（可选） | `assets/ui/auth/splash-decor.png`（见 `auth-assets`） | 半透明叠在背景上 |
| 登录/注册 | `assets/ui/auth/*` | 沿用现有登录页 PSD 切图 |

## 已接入（来自 `新建文件夹 (3)`）

| 文件 | 用途 |
|------|------|
| `assets/ui/plaza/background.png` | 分享广场纯色背景 |
| `assets/ui/plaza/screen-border-decor.png` | 屏幕边框装饰（展示框之下） |
| `assets/ui/plaza/title-banner.png` | 顶部标题 |
| `assets/ui/plaza/showcase-frame.jpg` | 作品展示框 |

「开始创作」仍使用手绘 `primary` 按钮；若提供切图可再替换。

## 可选增强（非 MVP 必须）

- 广场卡片外框 / 空状态插画
- 「返回广场」按钮手绘样式（当前为 `ghost` 文字按钮）
- 作品详情弹窗边框（当前为 `text-box-surface` 通用样式）

## 替换步骤

1. 将 PNG 放入 `assets/ui/plaza/`（新建目录即可）。
2. 在 `plaza-assets.ts` 中 import 并赋值给 `titleBanner` / `startCreateButton`。
3. 在 `PlazaPage.vue` 中把虚线占位块改为 `<img>` 层 + 热区（可参考 `LoginPage.vue`）。
