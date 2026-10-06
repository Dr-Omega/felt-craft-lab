# 学习区后端接入 PRD

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 产品 | Felt Craft Lab 学习区 |
| 目标界面 | 已验收的正式书本式学习区 UI |
| 文档状态 | 待开发确认 |
| 本期范围 | 将已有贴纸游戏后端与正式 UI 接通 |
| 不在本期范围 | 重新设计布局、重新开发关卡数据、重做素材库导航 |

## 2. 已有实现定位结论

### 2.1 功能来源

现有贴纸游戏后端位于历史提交：

```text
1350f4d feat: add integrated sticker learning zone
```

该提交新增了 `sticker-game-backend/`，包含：

- `src/server.js`：HTTP 服务、静态资源服务和 API 路由；
- `src/game-service.js`：游戏会话、落点校验、完成判定和通关奖励；
- `src/levels.js`：15 个主题、21 个关卡、贴纸、目标区域、容错值和音频资源映射；
- `src/celebrations.js` 与 `celebrations/*.mp4`：通关鼓励视频；
- `public/app.js`：旧测试版前端交互参考；
- `test/`：关卡、落点、资源与贴纸盘测试。

该功能随后在提交 `75f3d1b Revert "feat: add integrated sticker learning zone"` 中被整体回退。因此，当前正式 UI 分支已有静态界面与素材预览，但尚未与该后端建立运行时连接。

### 2.2 现有服务能力

| 能力 | 现有实现 | 接入策略 |
| --- | --- | --- |
| 关卡目录 | `GET /api/levels` | 用于主题和背景关卡映射 |
| 单关卡读取 | `GET /api/levels/{levelId}` | 进入主题时按需读取 |
| 创建会话 | `POST /api/sessions` | 每次开始一局解锁任务创建 |
| 查询进度 | `GET /api/sessions/{playSessionId}` | 刷新、恢复或异常重试时读取 |
| 提交贴纸落点 | `POST /api/sessions/{playSessionId}/placements` | 在贴纸落下时调用 |
| 命中校验 | 服务端校验画布边界、目标区域和容错值 | 前端不得自行判定成功 |
| 完成判定 | 最后一张贴纸返回 `allFinished`、`justFinished` | 驱动主题解锁与奖励展示 |
| 通关奖励 | session 固定一条随机 MP4 | 完成后播放一次 |
| 音频资源 | 每张贴纸返回中文名、英文名、中文介绍三段音频 URL | 前端按指定顺序播放 |

## 3. 产品目标

在不改变已验收书本式布局的前提下，使未解锁主题成为可完成的互动学习任务：

1. 孩子选择主题后进入该主题的未解锁页；
2. 按既定顺序拖放贴纸；
3. 每张贴纸开始拖拽时同步播放对应语音；
4. 当前贴纸“放置成功且语音播放完成”后，下一张贴纸才可拖动；
5. 全部贴纸完成后，主题成为已解锁状态，并展示既有素材学习页；
6. 再次进入学习区时保留已解锁状态。

## 4. 范围与边界

### 4.1 本期必须接入

- 正式 UI 到贴纸游戏后端的关卡、会话与落点接口；
- 贴纸顺序控制；
- 拖拽开始时的三段语音播放；
- 后端落点成功/失败反馈；
- 全部完成后的主题解锁、奖励播放与状态保存；
- 已解锁素材页中“中英文名称”“中文介绍”按钮的真实音频播放。

### 4.2 已完成，不重复开发

- 单元选择、主题选择和页面切换；
- 未解锁页、已解锁页和书本背景的视觉布局；
- 素材卡片排版；
- 返回素材库入口。

### 4.3 不在本期范围

- 修改主题、贴纸或背景的视觉排版；
- 修改既有关卡坐标、目标区域和容错参数；
- 增加重置关卡按钮；
- 多账号云端同步、排行榜或教师管理功能；
- 重录、生成或编辑音频素材。

## 5. 用户流程与状态机

### 5.1 进入关卡

1. 用户选择单元和主题；
2. 前端根据主题匹配后端 `levelId`；同一主题有多个背景关卡时，按产品配置选择默认关卡，后续可扩展为背景选择；
3. 前端调用 `POST /api/sessions` 创建会话；
4. 后端返回背景、贴纸、虚线轮廓、三段音频 URL、会话 ID 和已完成贴纸状态；
5. 前端渲染当前主题的背景、轮廓和贴纸盘，仅第一张未完成贴纸可操作。

### 5.2 单张贴纸顺序规则

对贴纸列表第 `n` 张，状态为：

```text
locked → dragging-and-playing → placed-waiting-audio → completed → next-unlocked
```

规则如下：

1. 只有当前顺序的第一张未完成贴纸可被拖拽；
2. 用户开始拖拽该贴纸时，前端依次播放：中文名称、英文名称、中文介绍；
3. 用户可在音频播放过程中继续拖动并松开当前贴纸；
4. 贴纸松开后，将画布逻辑中心点 `x`、`y` 提交给后端；
5. 后端返回成功前，前端不得把贴纸标记为完成；
6. 若落点失败或超出边界，贴纸回到贴纸盘，仍为当前可操作贴纸；
7. 若落点成功但音频尚未结束，贴纸固定在目标位置，下一张仍锁定；
8. 仅当“落点成功”和“三段音频均结束”同时满足时，当前贴纸完成，下一张解锁；
9. 拖拽当前贴纸期间不允许开始拖拽其他贴纸，也不允许并行播放其他贴纸音频。

### 5.3 异常与恢复

| 场景 | 前端行为 |
| --- | --- |
| 创建会话失败 | 保持当前未解锁页，展示“暂时无法开始，请重试” |
| 会话不存在或过期 | 自动重新创建一次会话；仍失败则提示重试 |
| 提交落点网络失败 | 当前贴纸回到可操作状态，不解锁下一张 |
| 音频播放失败 | 显示重播入口；未完成前不解锁下一张 |
| 刷新页面 | 读取会话进度；若服务端会话失效，以本地已解锁主题状态为准，不把未完成关卡误标为解锁 |

## 6. 后端接口契约

### 6.1 创建游戏会话

```http
POST /api/sessions
Content-Type: application/json

{ "levelId": "mid-autumn-lake-001" }
```

成功响应（核心字段）：

```json
{
  "playSessionId": "uuid",
  "level": {
    "levelId": "mid-autumn-lake-001",
    "themeId": "mid_autumn_festival",
    "backgroundAssetUrl": "/assets/...png",
    "canvasBounds": { "minX": 0, "minY": 0, "maxX": 1024, "maxY": 583 },
    "stickers": [
      {
        "stickerId": "sticker_moon_001",
        "stickerAssetUrl": "/assets/...png",
        "narrationAudio": [
          { "type": "nameZh", "assetUrl": "/assets/...mp3" },
          { "type": "nameEn", "assetUrl": "/assets/...mp3" },
          { "type": "introZh", "assetUrl": "/assets/...mp3" }
        ],
        "targetArea": { "minX": 0, "minY": 0, "maxX": 0, "maxY": 0 },
        "tolerance": 24,
        "placeholder": {}
      }
    ]
  },
  "allFinished": false
}
```

### 6.2 提交贴纸落点

```http
POST /api/sessions/{playSessionId}/placements
Content-Type: application/json

{ "stickerId": "sticker_moon_001", "x": 240, "y": 170 }
```

前端坐标换算：

```text
logicalX = (dropCenterX - canvasLeft) / canvasWidth  * canvasBounds.maxX
logicalY = (dropCenterY - canvasTop)  / canvasHeight * canvasBounds.maxY
```

成功响应必须使用：`success`、`isCompleted`、`allFinished`、`justFinished`、`celebration`。重复提交已完成贴纸时，服务端已有幂等响应，前端应保持完成状态，不重复计数。

### 6.3 服务端错误码

| HTTP | code | 前端处理 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` / `INVALID_STICKER_ID` / `INVALID_COORDINATES` | 当前贴纸回位，记录开发日志 |
| 404 | `LEVEL_NOT_FOUND` | 提示关卡配置不存在 |
| 404 | `SESSION_NOT_FOUND` | 重建一次会话 |
| 404 | `STICKER_NOT_FOUND` | 提示素材与关卡配置不一致 |
| 500 | `INTERNAL_ERROR` | 允许用户重试，不改变解锁状态 |

## 7. 解锁状态与持久化

### 7.1 主题解锁记录

本期至少在 Electron 本地持久化主题解锁状态，建议键结构：

```json
{
  "learningZoneProgress": {
    "schemaVersion": 1,
    "unlockedThemeIds": ["mid_autumn_festival"],
    "completedLevelIds": ["mid-autumn-lake-001"],
    "updatedAt": "2026-10-05T00:00:00.000Z"
  }
}
```

写入时机：仅在后端返回 `allFinished: true` 且 `justFinished: true` 后写入。读取时机：进入学习区及切换主题时。

### 7.2 当前服务限制

现有 `GameService` 将 session 保存在内存；服务重启后 session 会清空。因此本期的“跨应用保留解锁结果”以前端/Electron 本地持久化为准，不能依赖后端内存 session。

## 8. 前端接入要求

### 8.1 正式 UI 映射

| 正式 UI 区域 | 数据/行为来源 |
| --- | --- |
| 单元、主题按钮 | 现有正式 UI 状态；保持当前跳转逻辑 |
| 背景图 | `level.backgroundAssetUrl` |
| 虚线位置 | `sticker.placeholder` |
| 待拖拽贴纸 | 未完成贴纸，按后端 `stickers` 数组顺序 |
| 当前可拖拽贴纸 | 第一张未完成且前序均完成的贴纸 |
| 已完成贴纸 | 以后端成功落点的位置固定在背景中 |
| 素材学习页 | 本地进度确认该主题已解锁后展示 |
| 音频按钮 | 使用后端提供的音频 URL 或与其一致的素材映射 |

### 8.2 音频播放约束

- 单次只允许一个贴纸的叙述序列播放；
- 顺序固定为 `nameZh → nameEn → introZh`；
- 不能因为用户开始拖动下一张贴纸而中断前一张；下一张在当前序列完成前禁用；
- 已解锁素材卡片的两个按钮分别播放：名称组合音频、中文介绍音频；
- 若浏览器/桌面端自动播放策略阻止声音，必须由当前拖拽手势触发播放，失败时提供可点击的重播按钮。

## 9. 事件与数据流

```text
选择主题
  → POST /api/sessions
  → 渲染关卡与第一张贴纸
  → 开始拖拽当前贴纸
  → 播放 nameZh / nameEn / introZh
  → 松开贴纸
  → POST /api/sessions/{id}/placements
  → 成功且音频已结束？
      ├─ 否：等待另一条件完成
      └─ 是：开放下一张贴纸
  → 最后一张完成
  → 写入 learningZoneProgress
  → 播放 celebration
  → 切换至已解锁素材页
```

## 10. 验收标准

### AC-01 关卡加载

- 选择任一未解锁主题后，前端创建 session，并显示后端返回的背景、贴纸与轮廓。

### AC-02 顺序拖拽

- 初始仅第一张未完成贴纸可以拖动；其他贴纸不可拖动且有禁用反馈。

### AC-03 拖拽中语音

- 开始拖拽当前贴纸后，依次播放中文名称、英文名称、中文介绍。

### AC-04 音频与放置双条件

- 当前贴纸即使已经放置成功，只要音频未结束，下一张贴纸仍不可拖动；音频结束后立即开放下一张。

### AC-05 错误落点

- 贴纸放到错误位置或画布外时，后端返回失败，贴纸回到待拖拽区域，顺序不前进。

### AC-06 完成解锁

- 最后一张贴纸成功且音频结束后，主题被记录为已解锁，鼓励视频只播放一次，并进入已解锁素材页。

### AC-07 状态保留

- 关闭并重新打开应用后，已解锁主题直接进入素材学习页，不会恢复为未解锁。

### AC-08 素材页音频

- 已解锁素材卡片的“中英文名称”和“中文介绍”按钮均能播放对应音频，不影响布局。

### AC-09 回归

- 已确认的书本式 UI、单元/主题跳转、素材卡片布局和返回素材库入口保持不变。

## 11. 开发顺序

1. 从 `1350f4d` 恢复/迁移 `sticker-game-backend`，保留其现有测试；
2. 建立正式 UI 的 API 客户端、主题到 `levelId` 映射与会话状态；
3. 接入背景、轮廓、拖拽和服务端落点提交；
4. 接入三段音频顺序、双条件解锁和错误处理；
5. 接入本地解锁状态与通关奖励；
6. 接入已解锁素材卡片音频；
7. 补充端到端验收：中秋、春节、清明等不同贴纸数量主题各至少一关。

## 12. 待确认项

在开始实现前，需要产品确认以下两点：

1. 同一主题存在多个 `levelId` 时，正式 UI 的默认关卡选择规则；本期建议固定为主题下第一关。
2. 通关鼓励视频播放后，是自动进入素材学习页，还是由用户点击“查看已解锁素材”进入；本期建议视频播放结束后自动进入。
