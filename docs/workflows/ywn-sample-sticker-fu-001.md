# YWN 单条试转复核：sticker_fu_001

**来源包：** 归档(3).zip  
**assetSnapshotId：** `snapshot_ywn_20260805_112922`  
**生成时间：** `2026-08-05T11:29:22.063Z`

## 1. 原始飞书行（春节表）

```json
{
  "sourceSheet": "spring_festival\\feishu_fields_spring_festival.xlsx",
  "assetId": "sticker_fu_001",
  "type": "sticker",
  "themeId": "spring_festival",
  "categoryId": "festival_decoration",
  "nameZh": "福字",
  "nameEn": "Fu Character",
  "introZh": "福字是春节常见的吉祥字。人们常把它倒着贴，盼望“福到了”。看到红红的福字，就想起新年要顺顺利利。",
  "imageFileName": "sticker_fu_001.png",
  "thumbnailFileName": "sticker_fu_001_thumb.png",
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
  "introZh": "福字是春节常见的吉祥字。人们常把它倒着贴，盼望“福到了”。看到红红的福字，就想起新年要顺顺利利。",
  "keywords": [
    "春节",
    "福字",
    "祝福",
    "装饰"
  ],
  "imageUrl": "felt-resource://material/sticker_fu_001.png",
  "audio": {
    "nameZhUrl": "felt-resource://audio/sticker_fu_001_name_zh.mp3",
    "nameEnUrl": "felt-resource://audio/sticker_fu_001_name_en.mp3",
    "introZhUrl": "felt-resource://audio/sticker_fu_001_intro_zh.mp3"
  },
  "contentVersion": 1,
  "status": "ready",
  "thumbnailUrl": "felt-resource://material/sticker_fu_001_thumb.png",
  "source": "Midjourney生成 + 后期",
  "license": "生成平台条款；组内按MJ主口径确认"
}
```

## 3. assetSnapshotId

`snapshot_ywn_20260805_112922`（本批正式快照；与单条 `contentVersion` 分开）

## 4. validateAssetRecord

见 `tests/assets/manifest-validation.test.ts`（`FELT_RESOURCE_REF_POLICY`）。

## 5. ResourceRef 文件存在性

| ref | 打包路径 | 存在 |
| --- | --- | --- |
| `felt-resource://material/sticker_fu_001.png` | `assets/generated/material/sticker_fu_001.png` | yes |
| `felt-resource://material/sticker_fu_001_thumb.png` | `assets/generated/material/sticker_fu_001_thumb.png` | yes |
| `felt-resource://audio/sticker_fu_001_name_zh.mp3` | `assets/generated/audio/sticker_fu_001_name_zh.mp3` | yes |
| `felt-resource://audio/sticker_fu_001_name_en.mp3` | `assets/generated/audio/sticker_fu_001_name_en.mp3` | yes |
| `felt-resource://audio/sticker_fu_001_intro_zh.mp3` | `assets/generated/audio/sticker_fu_001_intro_zh.mp3` | yes |

说明：未向 Renderer 暴露 OS 路径；上表仅供 SXY/ZXR 构建复核。
