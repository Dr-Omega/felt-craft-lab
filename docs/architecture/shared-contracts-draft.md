# 素材库与背景贴纸模块共享Contracts草案

**版本：**V0.1-draft  
**状态：**待评审  
**负责人：**ZXR  
**协作评审：**TSH、SXY  
**内容输入：**YWN  
**关联任务：**Issue#3  
**目标模块：**素材库、背景选择、贴纸拼贴、收藏、草稿、作品保存、文字/语音问答  

> 本文件先锁定跨模块共享数据结构、字段语义、标识规则和兼容边界，不代表最终TypeScript目录已经确定。正式代码实现需等待全项目工程基线完成，并映射到真实仓库结构。

---

## 1.文档依据与优先级

本草案依据以下当前执行文档整理：

1.《素材库与背景贴纸模块PRD》V1.2：锁定产品行为、用户流程和验收要求；
2.《素材库与背景贴纸模块技术组三人协作与架构执行规范》V2.0：锁定技术职责、共享类型和Service边界；
3.《YWN素材内容生产与质量保障执行规范》V2.0：锁定内容侧真源、素材字段、授权和开发快照规则。

发生冲突时按以下顺序处理：

```text
产品行为：PRD V1.2优先
技术职责和接口：技术执行规范V2.0优先
内容生产和授权：YWN执行规范V2.0优先
本文件：只细化以上文档未展开的共享契约实现规则
```

本草案不得改变以下已锁定逻辑：

- 未解锁素材不能加入画布；
- 同一作品最多使用一个背景；
- 背景固定在最底层，不作为普通贴纸自由编辑；
- 同一贴纸可多次加入画布，每个实例必须有独立`objectId`；
- `SceneDocument`是作品可编辑状态的唯一真源，PNG只作为预览；
- ASR结果未经用户确认不得发送给DeepSeek；
- 飞书素材总表是内容侧真源，程序只读取经SXY校验生成的开发快照和Manifest；
- 共享Contracts只维护一份，禁止ZXR、TSH、SXY分别复制并演化出不同版本。

---

## 2.目标与非目标

### 2.1目标

本草案用于保证以下链路使用同一套字段和语义：

```text
飞书素材总表
→SXY生成素材Manifest
→素材库和详情页
→ZXR的Fabric编辑器
→SceneDocument
→SXY的Dexie草稿和正式作品
→TSH的ASR/QA/TTS服务
→后续图层拆分与制作模块
```

具体目标：

- 固定素材主数据、用户解锁状态和画布实例之间的边界；
- 固定`assetId`、`objectId`、`sceneId`、`draftId`和`projectId`的职责；
- 固定Scene保存、恢复和版本迁移的最低要求；
- 固定ASR、QA、TTS结果和统一错误形态；
- 为SXY和TSH提供可独立联调的Mock数据；
- 为后续Codex代码化、类型检查和测试提供明确输入。

### 2.2非目标

本草案当前不决定：

- Electron、Vue、Vite或测试框架的最终目录；
- Dexie表结构的全部索引和迁移实现；
- Fabric对象的内部序列化格式；
- Qwen、DeepSeek和MiniMax的真实HTTP参数；
- 云同步服务、对象存储和用户账号系统；
- 收藏功能是否进入共享Contracts还是保留在SXY本地领域模型；
- 后续图层拆分模块的完整输入Schema。

这些事项只能在工程基线和对应模块设计确定后继续补充。

---

## 3.核心标识与唯一性规则

### 3.1`assetId`

`assetId`是素材在整个项目中的全局标识，用于关联：

- 素材图片和缩略图；
- 中文名、英文名和中文介绍；
- 固定语音；
- 主题和类别；
- 收藏记录；
- 解锁状态；
- 画布对象；
- AI问答上下文；
- 后续预拆分数据。

规则：

1.`assetId`全局唯一；
2.素材进入开发快照后不得擅自修改；
3.图片文件名和Manifest中的`assetId`必须可校验对应；
4.同一个素材在不同页面、收藏、问答和画布中必须复用同一`assetId`；
5.测试素材也必须有唯一`assetId`，并使用`status='test_only'`隔离。

### 3.2`objectId`

`objectId`是同一作品内画布实例的唯一标识。

规则：

1.同一`assetId`可对应多个`objectId`；
2.每次贴纸加入画布都必须生成新的`objectId`；
3.删除、移动、旋转、缩放、调整层级、撤销和重做均以`objectId`定位实例；
4.不得使用数组下标替代`objectId`；
5.保存并重新加载后，已有对象的`objectId`保持不变。

示例：

```text
assetId=sticker_lantern_001

第一次加入：objectId=object_lantern_001
第二次加入：objectId=object_lantern_002
第三次加入：objectId=object_lantern_003
```

### 3.3其他标识

|字段|作用|唯一范围|
|---|---|---|
|`sceneId`|一份可编辑场景数据|项目范围内唯一|
|`draftId`|一条本地草稿记录|用户本地数据库唯一|
|`projectId`|一份正式保存作品|项目范围内唯一|
|`userId`|上游用户标识|由上游账号或会话模块提供|
|`requestId`|一次AI服务请求追踪|Provider或服务端生成|

本模块不得自行定义另一套用户身份系统。

---

## 4.共享类型定义

以下定义是V0.1草案的目标形态。正式实现时可以根据真实目录拆分文件，但字段名称和语义不得由单个成员自行改变。

### 4.1素材类型与固定语音引用

```ts
export type AssetType = 'background' | 'sticker';

export interface AssetAudioRefs {
  nameZhUrl?: string;
  nameEnUrl?: string;
  introZhUrl?: string;
}
```

说明：

- `nameZhUrl`：中文名称固定语音；
- `nameEnUrl`：英文名称固定语音；
- `introZhUrl`：中文科普介绍固定语音；
- 固定语音由YWN准备文本、使用TSH提供的工具生成并完成试听；
- SXY页面只消费生成后的受控资源地址；
- 音频字段允许缺失，以支持测试素材和音频失败降级，但正式`ready`素材是否必须完整由SXY的校验脚本按发布规则判断。

### 4.2`AssetRecord`

```ts
export interface AssetRecord {
  assetId: string;
  type: AssetType;
  themeId: string;
  categoryIds: string[];
  nameZh: string;
  nameEn: string;
  introZh: string;
  keywords: string[];
  imageUrl: string;
  thumbnailUrl?: string;
  preSplitDataUrl?: string;
  audio: AssetAudioRefs;
  source?: string;
  license?: string;
  contentVersion: number;
  status: 'ready' | 'test_only';
}
```

字段规则：

|字段|规则|
|---|---|
|`assetId`|全局唯一，进入开发快照后不可擅自修改|
|`type`|只允许`background`或`sticker`|
|`themeId`|所属主题标识，与上游主题保持一致|
|`categoryIds`|允许一个素材进入多个检索类别|
|`nameZh`|YWN复核后的中文主名称|
|`nameEn`|YWN复核后的英文主名称|
|`introZh`|面向儿童的中文介绍|
|`keywords`|搜索和筛选关键词|
|`imageUrl`|程序运行使用的受控路径或受控URL|
|`thumbnailUrl`|列表缩略图路径；缺失时由页面使用安全占位逻辑|
|`preSplitDataUrl`|预拆分数据引用，当前模块只透传，不解析完整结构|
|`audio`|固定语音引用|
|`source`|来源说明或来源记录引用|
|`license`|许可证或授权说明|
|`contentVersion`|内容快照版本，用于识别素材更新|
|`status`|正式运行列表只加载`ready`；`test_only`不得进入正式内容|

边界：

- 解锁状态不得写入`AssetRecord`；
- 收藏状态不得写入`AssetRecord`；
- 用户画布中的位置、缩放和角度不得写入`AssetRecord`；
- YWN不手工维护程序JSON，SXY从飞书和资源文件生成Manifest；
- SXY不得擅自修改YWN文案，只能报告校验问题；
- 字段结构变化由ZXR确认后，SXY调整转换脚本。

### 4.3`AssetAccessState`

```ts
export interface AssetAccessState {
  userId: string;
  assetId: string;
  unlocked: boolean;
  unlockSource?: string;
  updatedAt: string;
}
```

规则：

- 解锁判定由上游“主题学习与素材解锁模块”负责；
- 本模块只读取、展示和执行结果，不修改上游解锁逻辑；
- 未解锁素材可以查看、收听和收藏，但不能加入画布；
- 页面层和`EditorService.addSticker`入口都必须校验`unlocked=true`；
- 收藏、历史记录、缓存和草稿恢复都不能绕过解锁规则。

### 4.4`SceneObject`

```ts
export interface SceneObject {
  objectId: string;
  assetId: string;
  assetType: AssetType;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
}
```

规则：

- `objectId`在当前Scene内唯一；
- `assetId`必须能够回查`AssetRecord`；
- 第一版`objects`主要保存可编辑贴纸实例；
- 背景通过`backgroundAssetId`单独保存，不作为普通贴纸自由编辑；
- `left`、`top`、`scaleX`、`scaleY`、`angle`和`zIndex`必须在保存与重载后保持一致；
- 前端不得只依赖数组顺序表达层级，必须保留`zIndex`；
- `visible`和`locked`为后续编辑与安全恢复保留；
- 下游模块必须能通过`assetId`找到原始图片和`preSplitDataUrl`。

### 4.5`SceneDocument`

```ts
export interface SceneDocument {
  schemaVersion: number;
  sceneId: string;
  userId: string;
  workName: string;
  themeId: string;
  canvas: {
    width: number;
    height: number;
    backgroundColor?: string;
  };
  backgroundAssetId: string | null;
  objects: SceneObject[];
  createdAt: string;
  updatedAt: string;
}
```

核心规则：

1.`SceneDocument`是作品可编辑状态的唯一真源；
2.PNG或其他预览图只用于展示，不能替代Scene；
3.同一作品最多有一个`backgroundAssetId`；
4.`backgroundAssetId=null`表示无背景，画布使用默认纯色或透明背景；
5.更换背景不得改变已有贴纸的位置和编辑状态；
6.背景默认固定在最底层，不允许儿童拖动、旋转或误删除；
7.`objects`中的每个`objectId`必须唯一；
8.保存和重新导入后，对象数量、标识、位置、缩放、角度、层级和背景必须一致；
9.每次Schema升级必须提供迁移策略；
10.后续图层拆分与制作模块依赖Scene中的`assetId`回查原始素材。

### 4.6`DraftRecord`

```ts
export interface DraftRecord {
  draftId: string;
  scene: SceneDocument;
  updatedAt: string;
  status: 'draft';
}
```

规则：

- 草稿由SXY负责通过Dexie保存和恢复；
- 编辑变化应防抖后自动保存，建议防抖时间由实际性能测试确定；
- 用户进入模块时可查询最近草稿并选择是否恢复；
- 恢复时由SXY读取草稿，ZXR的`EditorService.importScene`执行导入；
- 恢复后必须校验背景和对象数量；
- 正式保存失败时，现有本地草稿不得丢失；
- 草稿不是正式项目，不使用正式同步状态。

### 4.7`ProjectRecord`

```ts
export interface ProjectRecord {
  projectId: string;
  projectName: string;
  scene: SceneDocument;
  previewUrl?: string;
  syncStatus: 'local_only' | 'pending_sync' | 'synced' | 'sync_failed';
  createdAt: string;
  updatedAt: string;
}
```

规则：

- 第一阶段允许`local_only`，云端存储未选型不得阻塞正式保存；
- 正式保存必须同时生成`SceneDocument`和预览图；
- `scene`是可继续编辑的数据，`previewUrl`只用于列表和展示；
- `projectName`由作品命名流程确定，不能只依赖`scene.workName`隐式推断；
- 保存失败时需要保留草稿并返回统一错误；
- 后续云同步只扩展`syncStatus`处理，不改变Scene主数据地位。

### 4.8`AsrResult`

```ts
export interface AsrResult {
  transcript: string;
  provider: 'qwen_cloud_http' | 'qwen_cloud_realtime' | 'qwen_local';
  durationMs: number;
  confidence?: number;
  requestId?: string;
}
```

规则：

- 第一版Provider为`qwen_cloud_http`；
- Provider抽象必须保留实时接口和本地接口替换空间；
- `transcript`返回后必须展示给用户确认；
- 用户可以修改识别文本或重新录音；
- 未确认文本不得提交给DeepSeek；
- 空识别、超时、取消和权限失败通过`SharedError`返回；
- 原始儿童录音不得写入日志、提交仓库或长期缓存，除非后续隐私方案明确允许。

### 4.9`QaResult`

```ts
export interface QaResult {
  answer: string;
  requestId?: string;
  safetyAction?: 'allow' | 'redirect' | 'reject';
}
```

规则：

- 问答上下文至少包含当前素材的`assetId`、`nameZh`、`introZh`和`themeId`；
- `answer`应简短、适龄，并能直接展示；
- `safetyAction='redirect'`表示需要提供安全替代回答；
- `safetyAction='reject'`表示不得展示原始模型输出；
- QA失败不得导致素材详情和已有创作内容丢失；
- Provider原始响应不得直接暴露给Renderer。

### 4.10`TtsResult`

```ts
export interface TtsResult {
  audioUrl: string;
  cacheHit: boolean;
  requestId?: string;
}
```

规则：

- 本类型用于动态问答回答语音；
- 固定素材名称和介绍语音使用`AssetAudioRefs`，不重复调用动态TTS；
- 动态TTS由TSH负责接入MiniMax并实现缓存；
- `cacheHit`用于识别是否复用已有结果；
- TTS失败时必须保留文字回答；
- `audioUrl`必须是客户端可安全消费的受控地址，不得包含真实密钥。

### 4.11`SharedError`

```ts
export interface SharedError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

规则：

- 所有跨Service错误统一映射为`SharedError`；
- 页面不得依赖第三方Provider的原始错误结构；
- `message`用于开发日志或安全提示，不应直接把敏感Provider信息展示给儿童；
- `retryable=true`表示调用方可以提供重试入口；
- `details`不得包含API密钥、完整请求头、原始儿童录音或不必要的个人信息；
- 具体错误码由对应Service补充，但不得重复定义同义码。

建议首批错误码命名：

```text
ASSET_NOT_FOUND
ASSET_LOCKED
SCENE_SCHEMA_UNSUPPORTED
SCENE_IMPORT_FAILED
DRAFT_SAVE_FAILED
DRAFT_RESTORE_FAILED
PROJECT_SAVE_FAILED
MIC_PERMISSION_DENIED
RECORDING_EMPTY
ASR_TIMEOUT
ASR_EMPTY_TRANSCRIPT
QA_TIMEOUT
QA_BLOCKED
TTS_TIMEOUT
AUDIO_LOAD_FAILED
```

以上错误码属于本草案建议，需由ZXR、TSH和SXY评审后冻结。

---

## 5.SceneDocument不变量

任何`exportScene`、`importScene`、草稿保存和正式保存实现都必须满足以下不变量：

```text
同一Scene内objectId不重复
每个SceneObject均保留assetId
backgroundAssetId只允许null或背景素材ID
背景不进入普通贴纸编辑链路
对象位置、缩放、角度和层级可往返恢复
SceneDocument与预览图同时生成但职责不同
未知schemaVersion不得静默按当前版本读取
```

### 5.1建议的Schema初始策略

建议正式实现从：

```ts
schemaVersion: 1
```

开始，并采用顺序迁移：

```text
v1→v2→v3
```

不允许直接以“缺字段则随便补默认值”的方式静默修复所有旧数据。每次迁移至少记录：

- 来源版本；
- 目标版本；
- 新增、删除或重命名字段；
- 默认值依据；
- 无法迁移时的错误码；
- 最小测试样例。

### 5.2时间字段建议

`createdAt`和`updatedAt`当前均保留为字符串。建议正式实现统一使用ISO8601格式并明确时区，但该格式需在工程基线和序列化测试中最终确认。

### 5.3层级冲突

当前契约要求保留`zIndex`，但尚未锁定重复`zIndex`的处理方式。正式实现前需在EditorService设计中确定：

- 导出时是否强制重排为连续整数；
- 导入时遇到重复值如何稳定排序；
- 背景与最低贴纸层之间的边界。

在该决策完成前，任何页面不得自行发明不同的层级规则。

---

## 6.资源引用和快照边界

### 6.1内容侧与程序侧

```text
YWN维护飞书总表和统一素材文件夹
→标记ready
→SXY导出并校验
→生成程序Manifest和资源快照
→ZXR、TSH、SXY只消费程序快照
```

程序不得在运行时直接读取飞书表格。

### 6.2路径规则

`imageUrl`、`thumbnailUrl`、`preSplitDataUrl`和音频URL在Contracts中保持字符串，不绑定具体存储Provider。SXY的转换脚本至少校验：

- 文件是否存在；
- 文件名与`assetId`是否一致；
- 路径是否越界或不安全；
- `ready`素材授权是否通过；
- 正式内容是否混入`test_only`；
- 必填图片和固定语音是否符合发布要求。

### 6.3内容版本

`contentVersion`表示素材内容快照版本，不等同于`SceneDocument.schemaVersion`：

```text
contentVersion：某个素材内容发生更新
schemaVersion：SceneDocument结构发生变化
```

二者不得混用。

---

## 7.状态边界

|状态|所属对象|维护方|不得写入|
|---|---|---|---|
|素材内容和发布状态|`AssetRecord`|YWN提供，SXY生成Manifest|用户解锁、收藏、画布变换|
|用户解锁状态|`AssetAccessState`|上游模块|素材主数据|
|收藏状态|SXY本地收藏模型|SXY|`AssetRecord`和`SceneObject`|
|画布实例状态|`SceneObject`|ZXR EditorService|素材Manifest|
|可编辑作品状态|`SceneDocument`|ZXR定义，SXY存储|PNG预览文件|
|草稿状态|`DraftRecord`|SXY|正式项目同步状态|
|正式保存状态|`ProjectRecord`|SXY编排|素材主数据|
|AI调用结果|`AsrResult`、`QaResult`、`TtsResult`|TSH|Scene主数据，除非业务明确保存确认后的文本|

收藏当前不纳入本轮共享Contracts清单，由SXY在Dexie领域模型中维护。若后续多个模块需要直接共享收藏记录，再单独提出`FavoriteRecord`变更PR，不在本草案中提前扩张。

---

## 8.Mock联调样例

以下Mock只用于接口联调和测试，不代表正式内容已通过授权验收。

### 8.1素材Mock

```json
[
  {
    "assetId": "background_moon_001",
    "type": "background",
    "themeId": "theme_mid_autumn",
    "categoryIds": ["festival_background"],
    "nameZh": "月夜背景",
    "nameEn": "Moonlit Night",
    "introZh": "月亮升起时，夜空会变得安静又明亮。你可以把灯笼、兔子和桂花贴在这里，创作自己的中秋月夜。",
    "keywords": ["月亮", "夜晚", "中秋"],
    "imageUrl": "/assets/generated/backgrounds/background_moon_001.png",
    "thumbnailUrl": "/assets/generated/thumbnails/background_moon_001.png",
    "audio": {
      "nameZhUrl": "/assets/generated/fixed-audio/name-zh/background_moon_001.mp3",
      "nameEnUrl": "/assets/generated/fixed-audio/name-en/background_moon_001.mp3",
      "introZhUrl": "/assets/generated/fixed-audio/intro-zh/background_moon_001.mp3"
    },
    "source": "mock_only",
    "license": "test_only",
    "contentVersion": 1,
    "status": "test_only"
  },
  {
    "assetId": "sticker_lantern_001",
    "type": "sticker",
    "themeId": "theme_mid_autumn",
    "categoryIds": ["festival_object", "decoration"],
    "nameZh": "灯笼",
    "nameEn": "Lantern",
    "introZh": "灯笼既可以照明，也常被用作节日装饰。温暖的灯光让夜晚显得更热闹。",
    "keywords": ["灯笼", "节日", "装饰"],
    "imageUrl": "/assets/generated/stickers/sticker_lantern_001.png",
    "thumbnailUrl": "/assets/generated/thumbnails/sticker_lantern_001.png",
    "preSplitDataUrl": "/assets/generated/pre-split/sticker_lantern_001.json",
    "audio": {},
    "source": "mock_only",
    "license": "test_only",
    "contentVersion": 1,
    "status": "test_only"
  }
]
```

### 8.2解锁状态Mock

```json
[
  {
    "userId": "user_demo_001",
    "assetId": "background_moon_001",
    "unlocked": true,
    "unlockSource": "theme_learning_complete",
    "updatedAt": "2026-07-30T05:00:00.000Z"
  },
  {
    "userId": "user_demo_001",
    "assetId": "sticker_lantern_001",
    "unlocked": true,
    "unlockSource": "theme_learning_complete",
    "updatedAt": "2026-07-30T05:00:00.000Z"
  }
]
```

### 8.3SceneMock

```json
{
  "schemaVersion": 1,
  "sceneId": "scene_demo_001",
  "userId": "user_demo_001",
  "workName": "我的中秋月夜",
  "themeId": "theme_mid_autumn",
  "canvas": {
    "width": 1200,
    "height": 800,
    "backgroundColor": "#FFF8E7"
  },
  "backgroundAssetId": "background_moon_001",
  "objects": [
    {
      "objectId": "object_lantern_001",
      "assetId": "sticker_lantern_001",
      "assetType": "sticker",
      "left": 420,
      "top": 260,
      "scaleX": 0.8,
      "scaleY": 0.8,
      "angle": 15,
      "zIndex": 1,
      "visible": true,
      "locked": false
    },
    {
      "objectId": "object_lantern_002",
      "assetId": "sticker_lantern_001",
      "assetType": "sticker",
      "left": 760,
      "top": 280,
      "scaleX": 0.65,
      "scaleY": 0.65,
      "angle": -10,
      "zIndex": 2,
      "visible": true,
      "locked": false
    }
  ],
  "createdAt": "2026-07-30T05:10:00.000Z",
  "updatedAt": "2026-07-30T05:18:00.000Z"
}
```

该样例必须用于验证：

- 同一`assetId`对应多个不同`objectId`；
- 背景独立保存；
- Scene导出后再导入，两个灯笼的位置和变换保持一致；
- 后续模块可通过`assetId`找到原始素材和预拆分数据。

### 8.4草稿与正式项目Mock

```json
{
  "draftId": "draft_demo_001",
  "scene": "<引用上方SceneMock>",
  "updatedAt": "2026-07-30T05:18:00.000Z",
  "status": "draft"
}
```

```json
{
  "projectId": "project_demo_001",
  "projectName": "我的中秋月夜",
  "scene": "<引用上方SceneMock>",
  "previewUrl": "local://previews/project_demo_001.png",
  "syncStatus": "local_only",
  "createdAt": "2026-07-30T05:20:00.000Z",
  "updatedAt": "2026-07-30T05:20:00.000Z"
}
```

文档中的`<引用上方SceneMock>`仅用于阅读简化。正式JSON测试文件必须嵌入完整对象，不能保留字符串占位。

### 8.5AI结果Mock

```json
{
  "transcript": "灯笼为什么是红色的",
  "provider": "qwen_cloud_http",
  "durationMs": 1260,
  "confidence": 0.93,
  "requestId": "asr_req_demo_001"
}
```

```json
{
  "answer": "红色在很多中国节日中代表喜庆和祝福，所以人们常把灯笼做成红色。",
  "requestId": "qa_req_demo_001",
  "safetyAction": "allow"
}
```

```json
{
  "audioUrl": "local://tts/qa_req_demo_001.mp3",
  "cacheHit": false,
  "requestId": "tts_req_demo_001"
}
```

```json
{
  "code": "ASR_TIMEOUT",
  "message": "语音识别暂时没有完成，请稍后重试。",
  "retryable": true,
  "details": {
    "provider": "qwen_cloud_http",
    "requestId": "asr_req_demo_002"
  }
}
```

---

## 9.三方接入规则

### 9.1ZXR

负责：

- 维护共享Contracts；
- 维护`assetId`、`objectId`和Scene规则；
- 实现`EditorService`；
- 实现Scene导入、导出、Schema校验和最小迁移；
- 导出预览图；
- 向后续模块提供结构化Scene样例。

不得：

- 代替SXY维护素材Manifest、Dexie和完整页面；
- 代替TSH接入Qwen、DeepSeek和MiniMax；
- 为解决临时显示问题直接修改YWN内容字段。

### 9.2SXY

负责：

- 从飞书和统一资源文件夹生成程序Manifest；
- 实现素材校验和转换脚本；
- 实现素材页面、收藏、草稿、保存编排和录音交互；
- 使用共享Contracts，不复制另一套类型；
- 在字段变化后按ZXR确认的版本调整脚本。

不得：

- 绕过`EditorService`直接依赖Fabric内部对象；
- 把解锁、收藏或画布状态写入`AssetRecord`；
- 擅自修改YWN文案和授权状态。

### 9.3TSH

负责：

- 实现AI安全服务层和Provider；
- 实现ASR、QA、TTS、AudioService和AnimationService；
- 将Provider响应映射为共享结果类型；
- 将Provider错误映射为`SharedError`；
- 保证密钥不进入Renderer和仓库。

不得：

- 让页面直接消费Provider原始响应；
- 在服务内部复制另一套`AssetRecord`或Scene类型；
- 未经用户确认直接把ASR文本发送给DeepSeek。

### 9.4YWN

负责：

- 按固定字段准备素材内容；
- 保证名称、介绍、标签、来源和授权完整；
- 生成并验收固定语音内容；
- 提供正常、异常和演示测试素材。

不得：

- 手工维护程序Manifest；
- 直接修改共享Contracts；
- 将授权未通过素材标记为`ready`；
- 将`test_only`素材混入正式内容。

---

## 10.变更控制

共享Contracts变更必须使用独立PR，并至少包含：

1.变更原因；
2.受影响类型和字段；
3.是否破坏兼容；
4.Scene迁移方式；
5.Manifest转换脚本需要的修改；
6.TSH服务映射需要的修改；
7.Mock和测试更新；
8.下一位成员的接入步骤。

禁止：

- 在业务PR中顺手重命名共享字段；
- 为修复单页问题复制一套局部类型；
- 删除旧字段但不提供迁移说明；
- 只修改TypeScript接口，不更新Mock、测试和文档；
- 未经评审直接改变`assetId`、`objectId`或`SceneDocument`语义。

建议评审要求：

```text
ZXR提出或维护
→SXY确认Manifest、Dexie和页面影响
→TSH确认Service和错误映射影响
→至少1名非作者成员批准
→合入integration/material-library
```

---

## 11.正式代码化计划

工程基线完成并同步至`integration/material-library`后，由Codex依据真实目录执行最小代码化。逻辑目标如下，实际路径以仓库现状为准：

```text
shared/contracts/
├─asset.ts
├─scene.ts
├─project.ts
├─ai.ts
├─error.ts
└─index.ts

shared/mocks/
├─assets.mock.ts
├─scene.mock.ts
└─ai.mock.ts

tests/shared/
├─scene-roundtrip.test.ts
├─scene-validation.test.ts
└─contracts-smoke.test.ts
```

最低测试：

- 类型检查通过；
- Mock符合接口；
- 同一`assetId`多实例拥有不同`objectId`；
- Scene序列化后反序列化数据一致；
- 背景和对象变换可恢复；
- 未知`schemaVersion`明确失败；
- `AssetRecord`不包含用户解锁和收藏状态；
- AI结果和错误不泄露Provider密钥或原始请求头。

Codex不得在代码化过程中自行增加新的业务字段。发现缺口时应先提交问题说明，由ZXR更新本草案后再实现。

---

## 12.待评审决策

以下事项尚未在执行文档中完全锁定，需要ZXR、TSH和SXY评审：

- [ ] `schemaVersion`是否从`1`开始；
- [ ] 时间字段是否统一为UTC的ISO8601字符串；
- [ ] 导出Scene时是否将`zIndex`重排为连续整数；
- [ ] 重复`zIndex`的稳定排序规则；
- [ ] `previewUrl`在本地阶段使用Blob、DataURL、文件路径还是应用协议URL；
- [ ] `preSplitDataUrl`在当前模块只透传还是增加可用性校验；
- [ ] `SharedError.code`首批枚举是否冻结；
- [ ] 收藏记录是否继续作为SXY本地领域类型，不进入共享Contracts；
- [ ] `ProjectRecord.projectName`与`SceneDocument.workName`的同步责任；
- [ ] Scene迁移失败时是否保留只读预览入口。

在这些事项完成评审前，不阻塞文档讨论和Mock设计；涉及正式实现的部分必须在代码PR前确定。

---

## 13.V0.1验收清单

- [ ] ZXR确认类型和Scene规则符合编辑器需求；
- [ ] SXY确认Manifest、页面、Dexie和保存编排可以消费；
- [ ] TSH确认ASR、QA、TTS和错误结构可以映射；
- [ ] YWN确认`AssetRecord`内容字段与飞书交付字段一致；
- [ ] Mock覆盖背景、同素材多实例、草稿、正式项目和AI链路；
- [ ] 未解锁防绕过规则没有被弱化；
- [ ] Scene主数据和预览图职责明确；
- [ ] 所有待决策项有负责人和结论；
- [ ] 工程基线完成后转为TypeScript接口和测试；
- [ ] 正式代码只保留一套共享Contracts导出入口。

---

## 14.一句话结论

> `AssetRecord`描述素材，`AssetAccessState`描述用户是否可用，`SceneObject`描述素材进入画布后的实例，`SceneDocument`保存完整可编辑作品，`DraftRecord`和`ProjectRecord`分别承载草稿与正式保存，`AsrResult`、`QaResult`、`TtsResult`和`SharedError`统一TSH服务与SXY页面之间的交互；所有模块必须共享同一套契约。