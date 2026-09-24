# 儿童贴纸匹配游戏后端

这是一个可直接运行的贴纸匹配游戏后端原型。素材库中的正式主题已配置为 16 个 `themeId` 和 22 个可选 `levelId`，前端可按主题分组切换。

## 运行

要求 Node.js 20 或更高版本，无需安装第三方依赖。

```bash
cd /Users/yangwanning/Desktop/素材库/sticker-game-backend
npm start
```

服务默认运行在 `http://127.0.0.1:3000`。

## 接口

### 获取关卡列表

```http
GET /api/levels
```

### 主题与关卡

每个关卡返回 `themeId`、`themeName`、`levelId`、`name`、背景资源和该主题的贴纸列表。
同一主题下的多个背景各自拥有独立 `levelId`，例如 `mid-autumn-lake-001` 和 `mid-autumn-osmanthus-001`。

前端地址栏下方的“选择关卡”会按 `themeName` 分组，切换后重新创建 session。

### 创建一局游戏

```http
POST /api/sessions
Content-Type: application/json

{"levelId":"mid-autumn-lake-001"}
```

### 查询当前进度

```http
GET /api/sessions/{playSessionId}
```

### 提交贴纸落点

`x`、`y` 是以画布左上角为原点的贴纸中心逻辑坐标。

```http
POST /api/sessions/{playSessionId}/placements
Content-Type: application/json

{"stickerId":"sticker_moon_001","x":240,"y":170}
```

## 当前规则

- 先校验画布边界，再校验贴纸目标区域及容错值。
- 已完成贴纸重复提交采用幂等响应。
- 最后一张贴纸完成时返回 `allFinished: true` 和 `justFinished: true`。
- 通关时从六个 MP4 中随机选择一个，并固定保存在当前 session 中。
- `placeholder` 负责前端虚线轮廓显示，`targetArea` 负责后端判定，二者可独立调整。
- 前端轮廓使用浅灰色低透明度虚线；贴纸拖近对应目标时会轻微高亮。
- 不提供重置按钮，切换关卡会创建新的游戏 session。
- session 当前保存在内存中，服务重启后清空，适合第一阶段联调。

## 调整关卡

示例关卡位于 `src/levels.js`。常用调整项：

- `placeholder.x/y/width/height`：虚线轮廓显示位置和大小。
- `targetArea`：贴纸中心点应落入的实际区域。
- `tolerance`：目标区域向四周扩展的容错像素。
- `outlineStyle`：前端绘制虚线轮廓时使用的样式建议。

## 测试

```bash
npm test
```
