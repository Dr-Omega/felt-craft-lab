# 飞书素材总表 → AssetRecord 转换说明（SXY维护）

**状态：** 已获 ZXR 确认；整体映射符合当前 AssetRecord / Shared Contracts，**不改合同**  
**读者：** YWN（维护飞书列）、SXY（实现转换）、ZXR（复核样例）  
**输出：** Program Manifest 中的 `AssetRecord`（不是飞书行的完整复制）

---

## 1. 正式转换流水线（冻结）

```text
飞书 status=ready
  → 字段 / 授权检查
  → 文件名转 ResourceRef
  → 确认实际文件存在
  → validateAssetRecord(..., FELT_RESOURCE_REF_POLICY)
  → 才进入 Manifest / 快照
```

程序**不**实时读飞书；儿童端只读 Manifest。

`assetSnapshotId`：整批不可变素材快照 ID。  
`contentVersion`：单条素材自己的内容版本。两者分开，不要混用。

---

## 2. 飞书表头约定（YWN）

### 2.1 会进入转换的列

| 飞书列 | 说明 |
| --- | --- |
| `assetId` | 全局唯一；与主图文件名主体一致 |
| `type` | `background` \| `sticker` |
| `themeId` | 如 `theme_spring_festival` |
| `categoryId` | **单值**；运行时变数组 |
| `nameZh` / `nameEn` / `introZh` | ready 必填非空 |
| `keywords` | 逗号分隔字符串 |
| `imageFileName` | 仅文件名，不要 OS 路径（原 `imagePath`） |
| `thumbnailFileName` | 仅文件名（原 `thumbnailPath`）；可空则省略并记报告 |
| `preSplitFileName` | 仅 sticker 可选 |
| `audioNameZhPath` / `audioNameEnPath` / `audioIntroZhPath` | **只填** `felt-resource://audio/{assetId}_name_zh.mp3` 这类引用，或仅文件名；**禁止**本机绝对路径；可空 |
| `source`（若有） | **真实素材来源/生成来源**（自制、Midjourney、豆包处理等），不是维护人 |
| `license` | 授权备注；可空 |
| `status` | 内容侧：`draft` / `review` / `ready` / … |

### 2.2 不进 AssetRecord 的列

| 飞书列 | 处理 |
| --- | --- |
| `owner` | 内容责任人/维护人（正式填 `YWN`）。**只留飞书工作流或构建报告，不进入 AssetRecord**；也不映射到 `source`；不新增 `owner` 字段 |
| `unlockStatus` | **非导入备注**。锁是用户权限 → `AssetAccessState` |
| 审核意见、返工记录、原始网盘链接、TTS 原文等 | 留飞书；可不写入 `AssetRecord` |
| `contentVersion` | **不要让 YWN 填**。由 SXY 按单条素材版本规则生成 |

### 2.3 文件名硬规则

- 只写**相对文件名**（可含子目录如 `spring/sticker_fu_001.png`），禁止 OS 路径、`../`、反斜杠。
- `felt-resource` 相对路径字符集：`[A-Za-z0-9._/-]`（协议**允许**连字符 `-`）。新文件名建议偏好下划线 `_`，这是命名约定，不是协议限制。
- 主图建议：`{assetId}.png`（校验文件名主体与 `assetId` 一致）。
- 缩略图建议：`{assetId}_thumb.png`。
- 音频建议：`{assetId}_name_zh.mp3` 等，落在 `assets/generated/audio/`。

---

## 3. 字段转换规则（ZXR 已确认可固定）

| # | 飞书 | → AssetRecord | 规则 |
| --- | --- | --- | --- |
| 1 | `categoryId` | `categoryIds` | `[原值.trim()]`；空则失败；去重 |
| 2 | `keywords` | `keywords` | 按 `[,，]` 拆分 → trim → 去空 → 去重 |
| 3 | `imageFileName` | `imageUrl` | `felt-resource://material/{imageFileName}` |
| 4 | `thumbnailFileName` | `thumbnailUrl` | 有值则 `felt-resource://material/{...}`；空则省略并记报告 |
| 5 | `preSplitFileName` | `preSplitDataUrl` | 仅 sticker；`felt-resource://material/{...}`；背景禁止 |
| 6 | 音频文件名三列 | `audio.*Url` | 有值则 `felt-resource://audio/{fileName}`；全空则 `audio: {}` |
| 7 | `status` | 过滤 + `status` | **仅飞书 `ready` 进入正式 Manifest**；运行时 `status: "ready"`。`review` **不导入** |
| 8 | `source`（若有） | `source` | 保留真实出处；**不要**把 `owner=YWN` 写成 `source` |
| 9 | `owner` | — | **不映射**；仅工作流/构建报告 |
| 10 | `license` | `license` | trim；空则省略 |
| 11 | `unlockStatus` | — | **丢弃** |
| 12 | `assetId`/`type`/`themeId`/`name*` | 同名字段 | trim；ready 要求中英名与介绍非空 |
| 13 | — | `contentVersion` | 见 §3.1（SXY 生成） |

### 3.1 `contentVersion`（单条素材版本）

由 SXY 生成，规则：

- 某 `assetId` **首次**进入正式快照：`contentVersion = 1`
- 后续同一 `assetId` 发生**实质内容更新**：`contentVersion` 递增
- **不要**每生成一个新 `assetSnapshotId` 就把所有素材重新写成 `1`

实质更新至少包括：主图/缩略图/预拆分/固定音频文件变更，或 `nameZh`/`nameEn`/`introZh`/`keywords`/`categoryId`/`type`/`themeId`/`license`/`source` 等会影响运行时投影的字段变更。

### 3.2 导入过滤与失败

```text
if status !== "ready" → skip（不进 Manifest；可进报告「未导入」）
if imageFileName 缺失 → fail
if ResourceRef 对应文件不存在 → fail
if assetId 重复 → fail
if validateAssetRecord 失败 → fail
```

`owner` 缺失只影响构建报告/工作流提示，**不**因此改写 `AssetRecord`。

### 3.3 ResourceRef

- 正式协议只用 `felt-resource:`，策略用 `FELT_RESOURCE_REF_POLICY`。
- 禁止 OS 路径、`file://`、网盘 URL 进 Manifest。

---

## 4. 单条样例复核清单（给 ZXR）

YWN 表头定稿后，先发 **1 条真实 ready**。SXY 只转这一条，并提交：

1. 原始飞书行
2. 转换后的 `AssetRecord`
3. 对应 `assetSnapshotId`
4. `validateAssetRecord` 结果
5. 图片 / 缩略图 / 音频 ResourceRef 的实际解析结果（存在性，不暴露给 Renderer 的 OS 路径细节按现有 inspect 约定）

**这一条通过后再全量转换。**

---

## 5. 对齐用假数据样例（非正式；勿当真源）

> 仅说明字段形态。`owner` 不进结果；`source` 若飞书有真实出处才填。

假设飞书行含 `owner=YWN`、`source=自制`、`status=ready` 时，转换结果示例：

```json
{
  "assetId": "sticker_spring_fu_001",
  "type": "sticker",
  "themeId": "theme_spring_festival",
  "categoryIds": ["festival_object"],
  "nameZh": "福字",
  "nameEn": "Fu Character",
  "introZh": "春节时人们常把「福」字贴在门上，祈求一年平安顺利。",
  "keywords": ["福字", "春节", "节日"],
  "imageUrl": "felt-resource://material/sticker_spring_fu_001.png",
  "thumbnailUrl": "felt-resource://material/sticker_spring_fu_001_thumb.png",
  "audio": {
    "nameZhUrl": "felt-resource://audio/sticker_spring_fu_001_name_zh.mp3",
    "introZhUrl": "felt-resource://audio/sticker_spring_fu_001_intro_zh.mp3"
  },
  "source": "自制",
  "license": "internal_ywn_v1",
  "contentVersion": 1,
  "status": "ready"
}
```

注意：结果中**没有** `owner`；`source` 是「自制」而不是 `YWN`。

---

## 6. YWN checklist

1. 表头用 `imageFileName` / `thumbnailFileName`。
2. `owner=YWN` 表示维护责任，不进 Manifest。
3. 若有「真实出处」，用单独的 `source` 列（或约定列），不要填维护人名字。
4. `unlockStatus` 非导入字段。
5. 只有 `status=ready` 会被导入；`review` 先留着。
6. 文件名安全字符 + 下划线；与 `assetId` 对齐。
7. 改文案只改飞书；不手改 Manifest JSON。
8. 表头定稿后先发 **1 条真实 ready** 给 SXY。

---

## 7. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-08-04 | 初稿；假数据试转 |
| 2026-08-04 | ZXR 确认整体映射；修正：`owner` 不映射 `source`；`contentVersion` 按 assetId 递增而非每快照重置；正式流水线含文件存在性校验 |
