# YWN 单条试转复核：sticker_fu_001

**来源包：** content/material-assets-v2@1cdf77db19d99bc1446277c86783bb09c5f595d6; 素材库.xlsx; byte-preserving aliases: docs/material-v2-source-map.json

**assetSnapshotId：** `snapshot_ywn_material_v2_1cdf77d`
**生成时间：** `2026-10-08T08:17:03.203Z`

## 1. 原始飞书行（春节表）

```json
{
  "sourceSheet": "素材库.xlsx",
  "assetId": "sticker_fu_001",
  "type": "sticker",
  "themeId": "spring_festival",
  "categoryId": "festival_decoration",
  "nameZh": "福字",
  "nameEn": "Fu Character",
  "introZh": "福字是春节常见的传统文字装饰。古时候人们书写福字，用来表达对福气的期盼。后来慢慢出现把福字倒着贴的做法，借“倒”的读音寓意福气“到”来。人们会把写好的福字贴在门上，以此盼望家里吉祥如意。",
  "imageFileName": "sticker_fu_001.png",
  "thumbnailFileName": "sticker_fu_001_thumb.png",
  "preSplitFileName": "",
  "source": "Midjourney生成 + 后期",
  "license": "生成平台条款；组内按MJ主口径确认",
  "licenseStatus": "approved",
  "audioNameZhPath": "felt-resource://audio/sticker_fu_001_name_zh.mp3",
  "audioNameEnPath": "felt-resource://audio/sticker_fu_001_name_en.mp3",
  "audioIntroZhPath": "felt-resource://audio/sticker_fu_001_intro_zh.mp3",
  "owner": "YWN",
  "status": "ready",
  "keywords": "春节,福字,祝福,装饰"
}
```

## 2. 转换后 AssetRecord

```json
{
  "assetId": "sticker_fu_001",
  "type": "sticker",
  "themeId": "spring_festival",
  "categoryIds": [
    "festival_decoration"
  ],
  "nameZh": "福字",
  "nameEn": "Fu Character",
  "introZh": "福字是春节常见的传统文字装饰。古时候人们书写福字，用来表达对福气的期盼。后来慢慢出现把福字倒着贴的做法，借“倒”的读音寓意福气“到”来。人们会把写好的福字贴在门上，以此盼望家里吉祥如意。",
  "keywords": [
    "春节",
    "福字",
    "祝福",
    "装饰"
  ],
  "imageUrl": "felt-resource://material/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001.png",
  "audio": {
    "nameZhUrl": "felt-resource://audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_name_zh.mp3",
    "nameEnUrl": "felt-resource://audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_name_en.mp3",
    "introZhUrl": "felt-resource://audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_intro_zh.mp3"
  },
  "status": "ready",
  "thumbnailUrl": "felt-resource://material/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_thumb.png",
  "source": "Midjourney生成 + 后期",
  "license": "生成平台条款；组内按MJ主口径确认",
  "contentVersion": 2
}
```

## 3. assetSnapshotId

`snapshot_ywn_material_v2_1cdf77d`（本批正式快照；与单条 `contentVersion` 分开；已发布 snapshotId 不可覆盖）

## 4. validateAssetRecord

见 `tests/assets/manifest-validation.test.ts`（`FELT_RESOURCE_REF_POLICY`）。

## 5. ResourceRef 文件存在性

| ref | 打包路径 | 存在 |
| --- | --- | --- |
| `felt-resource://material/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001.png` | `assets/generated/material/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001.png` | yes |
| `felt-resource://material/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_thumb.png` | `assets/generated/material/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_thumb.png` | yes |
| `felt-resource://audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_name_zh.mp3` | `assets/generated/audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_name_zh.mp3` | yes |
| `felt-resource://audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_name_en.mp3` | `assets/generated/audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_name_en.mp3` | yes |
| `felt-resource://audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_intro_zh.mp3` | `assets/generated/audio/snapshot_ywn_material_v2_1cdf77d/sticker_fu_001_intro_zh.mp3` | yes |

说明：未向 Renderer 暴露 OS 路径；上表仅供 SXY/ZXR 构建复核。
