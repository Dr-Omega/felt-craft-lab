# 素材库与背景贴纸模块共享Contracts

**版本：**V0.2-reviewed  
**状态：**架构审查完成，待工程实现验证  
**负责人：**ZXR  
**协作输入：**TSH、SXY、YWN  
**关联任务：**Issue#3  
**目标模块：**素材库、背景选择、贴纸拼贴、收藏、草稿、作品保存、文字/语音问答

> 本文件已经完成产品、技术职责、内容规范、契约内部一致性和后续可实现性五层审查。工程基线完成后，Codex只能将本文件映射为TypeScript、运行时校验、Mock和测试，不得自行增加、删除或重命名业务字段。

---

## 1.依据与优先级

本契约依据：

1.《素材库与背景贴纸模块PRD》V1.2：产品行为、用户流程和验收要求；
2.《素材库与背景贴纸模块技术组三人协作与架构执行规范》V2.0：技术职责、共享类型和Service边界；
3.《YWN素材内容生产与质量保障执行规范》V2.0：内容真源、素材字段、授权和开发快照规则。

冲突处理顺序：

```text
产品行为：PRD V1.2优先
技术职责和接口：技术执行规范V2.0优先
内容生产和授权：YWN执行规范V2.0优先
本文件：细化未明确的可实现规则，不改变已锁定业务逻辑
```

不得改变的核心逻辑：

- 未解锁素材不能作为新素材加入画布；
- 同一作品最多使用一个背景；
- 背景固定在最底层，不作为普通贴纸自由编辑；
- 同一贴纸可以多次加入，每个实例必须拥有独立`objectId`；
- `SceneDocument`是作品可编辑状态的唯一真源，预览图不能替代Scene；
- ASR文本未经用户确认不得发送给DeepSeek；
- 飞书素材总表是内容侧真源，程序只读取SXY生成并校验的Manifest与开发快照；
- 共享Contracts只维护一份。

---

## 2.审查后新增的强制决策

V0.2已经替团队完成以下决策，不再作为开放问题：

1.`schemaVersion`从字面量`1`开始；
2.全部时间字段使用UTC的ISO8601格式：`YYYY-MM-DDTHH:mm:ss.sssZ`；
3.生产环境中的`sceneId`、`objectId`、`draftId`、`projectId`使用不包含业务含义的UUID或等价随机ID；
4.背景层隐式为`zIndex=0`，贴纸导出时按`1..N`连续编号；
5.重复、非整数或小于1的贴纸`zIndex`属于无效Scene，不静默猜测顺序；
6.`objects`数组按`zIndex`升序进行规范化导出；
7.`left`、`top`表示画布坐标系中对象中心点，单位为像素，原点为画布左上角；
8.`angle`使用角度制，顺时针为正，导出时规范化到`[-180,180)`；
9.第一期只支持等比例缩放，必须满足`scaleX===scaleY`且大于0；
10.无背景状态由`backgroundAssetId`和`canvas.backgroundColor`共同表达；
11.正式保存成功的`ProjectRecord.previewUrl`必须存在；
12.`ProjectRecord.projectName`是数据库索引字段，必须与`scene.workName`完全一致并原子更新；
13.`previewUrl`是应用管理的稳定资源引用，不允许保存临时`blob:`URL、真实Windows绝对路径或包含密钥的远程URL；
14.收藏继续由SXY本地领域模型维护，V0.2不增加`FavoriteRecord`；
15.Scene迁移失败时，不允许进入编辑模式；若预览图可用，则允许只读查看；
16.素材快照必须有`assetSnapshotId`，Scene必须记录创建或最后保存时使用的快照；
17.所有异步Service以规范化`SharedError`失败，Renderer不得接触Provider原始错误；
18.`setBackground`与`addSticker`都必须在EditorService入口校验素材类型、素材状态、用户和解锁状态。

---

## 3.范围与边界

### 3.1本契约负责

- 运行时素材数据；
- 用户素材解锁状态；
- 画布贴纸实例；
- 可编辑作品Scene；
- 草稿与正式作品包装；
- ASR、QA、TTS结果；
- 跨Service统一错误；
- Scene导入、导出、迁移和恢复的最低不变量。

### 3.2本契约不负责

- Electron、Vue、Vite和测试框架的最终目录；
- Fabric内部JSON格式；
- Dexie表的具体索引实现；
- Qwen、DeepSeek、MiniMax原始HTTP参数；
- 云同步、账号体系和对象存储选型；
- YWN飞书总表的全部审核列；
- 后续图层拆分模块的完整Schema。

### 3.3运行时Contract不是飞书总表的完整复制

YWN飞书表包含审核状态、授权状态、原始链接、TTS文本和返工记录等内容生产字段；`AssetRecord`只是程序运行需要的安全投影。

```text
飞书内容行
→SXY校验授权、状态、文件和字段
→生成AssetRecord
→生成不可变assetSnapshotId
→程序读取Manifest
```

因此：

- `licenseStatus=approved`必须在构建阶段通过校验，但不要求直接暴露给儿童端；
- YWN的`categoryId`可以由SXY规范化为运行时`categoryIds`；
- 内容状态`draft/review/ready/frozen`不直接进入运行时；运行时只保留`ready/test_only`；
- `test_only`永远不能进入正式素材列表。

---

## 4.标识与生命周期

### 4.1`assetId`

`assetId`是素材全项目唯一标识，关联图片、缩略图、名称、介绍、固定语音、主题、类别、收藏、解锁、画布和预拆分数据。

规则：

- 按YWN命名规范生成；
- 进入开发快照后不得擅自修改；
- 图片主文件名必须可与`assetId`校验对应；
- 测试素材也必须拥有唯一`assetId`；
- 不使用`assetId`表达用户状态或画布实例。

### 4.2`objectId`

`objectId`只标识某一Scene中的一个贴纸实例。

规则：

- 同一`assetId`可以对应多个`objectId`；
- 每次加入贴纸必须生成新ID；
- 删除、移动、缩放、旋转、层级、撤销和重做均以`objectId`定位；
- 保存和重载后保持不变；
- 生产ID不得根据素材名称或数组序号生成。

### 4.3其他ID

|字段|作用|生命周期|
|---|---|---|
|`sceneId`|一条可编辑Scene|首次创建草稿时生成，草稿转正式项目时保持不变|
|`draftId`|一条本地草稿记录|草稿创建时生成|
|`projectId`|一份正式作品|首次正式保存时生成|
|`userId`|上游用户标识|本模块只读取|
|`requestId`|一次服务请求追踪|安全服务层或Provider生成|
|`assetSnapshotId`|一次不可变程序素材快照|SXY构建Manifest时生成|

---

## 5.基础类型

```ts
export type JsonPrimitive = string | number | boolean | null;
export type AssetType = 'background' | 'sticker';
export type AssetRuntimeStatus = 'ready' | 'test_only';
export type AsrProvider =
  | 'qwen_cloud_http'
  | 'qwen_cloud_realtime'
  | 'qwen_local';

/**
 * 应用管理的逻辑资源引用。
 * 不等于任意互联网URL，也不等于可直接写入的操作系统绝对路径。
 */
export type ResourceRef = string;
```

`ResourceRef`必须满足：

- 由应用资源解析层统一解析；
- 禁止`../`路径穿越；
- 禁止未经允许的任意`http/https/file`地址；
- 禁止包含令牌、签名密钥或用户隐私参数；
- 测试Mock可使用`mock://`；
- 正式协议名称由工程基线确定，但Contract语义不变。

---

## 6.素材契约

### 6.1`AssetAudioRefs`

```ts
export interface AssetAudioRefs {
  nameZhUrl?: ResourceRef;
  nameEnUrl?: ResourceRef;
  introZhUrl?: ResourceRef;
}
```

正式`ready`素材的固定语音完整性由SXY构建校验器根据发布规则检查；测试素材可以缺失并触发文字降级。

### 6.2`AssetRecord`

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
  imageUrl: ResourceRef;
  thumbnailUrl?: ResourceRef;
  preSplitDataUrl?: ResourceRef;
  audio: AssetAudioRefs;
  source?: string;
  license?: string;
  contentVersion: number;
  status: AssetRuntimeStatus;
}
```

强制校验：

- `assetId`非空且全局唯一；
- `themeId`非空；
- `categoryIds`和`keywords`去重，不保留空字符串；
- `nameZh`、`nameEn`、`introZh`在`ready`素材中非空；
- `contentVersion`是大于等于1的整数；
- `preSplitDataUrl`只允许贴纸使用，背景必须省略；
- 正式列表只加载`ready`；
- `thumbnailUrl`缺失时可以使用安全占位，但构建报告必须记录；
- 解锁、收藏和画布变换不得写入该对象。

### 6.3`AssetAccessState`

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

- 由上游主题学习与素材解锁模块维护；
- 未解锁素材允许查看、收听和收藏，但不能作为新素材加入画布；
- `updatedAt`使用UTC的ISO8601格式；
- `AssetAccessState.assetId`必须与待操作素材一致；
- 当前用户必须与Scene的`userId`一致。

---

## 7.画布与Scene契约

### 7.1`SceneObject`

```ts
export interface SceneObject {
  objectId: string;
  assetId: string;
  assetType: 'sticker';
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

字段语义：

- `left/top`：对象中心点相对画布左上角的像素坐标；
- `scaleX/scaleY`：相对当前素材快照原始尺寸的缩放倍率；
- `angle`：顺时针角度；
- `zIndex`：贴纸层级，背景不占用贴纸层级；
- `visible`：V1正常对象必须为`true`；
- `locked`：编辑交互锁，不等于素材解锁状态。

V1不变量：

- 所有数值必须为有限数；
- `scaleX===scaleY`且大于0；
- `zIndex`为从1开始的唯一连续整数；
- `assetType`固定为`sticker`；
- 正常可编辑贴纸`visible=true`、`locked=false`；
- 仅恢复缺失、已撤销权限或不兼容素材时，允许`locked=true`的受限占位对象；
- 不支持的不透明度、倾斜、翻转等Fabric属性不得静默写入Scene。

### 7.2`SceneDocument`

```ts
export interface SceneDocument {
  schemaVersion: 1;
  sceneId: string;
  userId: string;
  workName: string;
  themeId: string;
  assetSnapshotId: string;
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

### 7.3背景状态编码

不新增另一套背景对象，使用以下规则：

|状态|`backgroundAssetId`|`backgroundColor`|
|---|---|---|
|素材背景|背景素材ID|可选，仅作为加载失败时的安全回退色|
|纯色无素材背景|`null`|合法颜色字符串|
|透明无素材背景|`null`|省略|

背景素材必须满足：

- `AssetRecord.type==='background'`；
- `AssetRecord.status==='ready'`，测试环境除外；
- 当前用户已解锁；
- 对应素材属于Scene记录的`assetSnapshotId`；
- 背景不进入`objects`。

### 7.4Scene不变量

- `SceneDocument`是唯一可编辑真源；
- `canvas.width/height`为大于0的整数像素；
- `sceneId`、`userId`、`themeId`、`assetSnapshotId`非空；
- 草稿阶段`workName`可以使用产品统一的临时名称；正式保存时必须为非空最终名称；
- `objectId`在Scene内唯一；
- `objects`按`zIndex`升序保存；
- 背景隐式位于层级0；
- 导出、序列化、反序列化和重新导入后，ID、数量、背景、位置、缩放、角度和层级保持一致；
- Undo/Redo历史不属于持久化Scene，恢复后从当前状态重新建立历史；
- 未知`schemaVersion`不得按当前版本静默读取。

### 7.5素材快照

`assetSnapshotId`用于阻止旧作品在素材更新后无提示地换成新图片或新预拆分数据。

规则：

- SXY生成每轮Manifest时生成不可变快照ID；
- 同一快照中的`assetId`和`contentVersion`固定；
- Scene保存时记录当前快照ID；
- 读取旧Scene时优先解析原快照；
- 原快照不可用时返回明确导入问题，不得静默使用当前素材覆盖；
- 快照保留或项目打包策略由SXY在存储设计中实现，但不得删除Scene中的快照引用。

### 7.6恢复时的权限与缺失素材

为同时满足防绕过和作品不丢失：

- 新增背景或贴纸必须使用当前`AssetAccessState.unlocked=true`；
- 导入已存在Scene不调用“新增素材”逻辑；
- 若素材当前已锁定、原快照缺失或文件不可用，不删除对象；
- 编辑器使用受限占位恢复其`objectId`、`assetId`和变换，并设置`locked=true`；
- 受限对象不能复制、替换资源或作为新素材再次加入；
- 页面向用户显示恢复警告；
- 若预览图仍可用，可以只读查看；
- 正式再次保存前必须明确处理全部阻塞级导入问题。

---

## 8.草稿与正式作品

### 8.1`DraftRecord`

```ts
export interface DraftRecord {
  draftId: string;
  scene: SceneDocument;
  updatedAt: string;
  status: 'draft';
}
```

规则：

- SXY通过Dexie保存和恢复；
- `updatedAt===scene.updatedAt`；
- 自动保存必须串行或使用等价防旧写覆盖机制；
- 正式保存失败不得删除现有草稿；
- Dexie索引投影属于SXY内部实现，不需要为了索引复制第二套共享类型。

### 8.2`ProjectRecord`

```ts
export interface ProjectRecord {
  projectId: string;
  projectName: string;
  scene: SceneDocument;
  previewUrl: ResourceRef;
  syncStatus: 'local_only' | 'pending_sync' | 'synced' | 'sync_failed';
  createdAt: string;
  updatedAt: string;
}
```

规则：

- 正式保存只有在Scene和预览图均成功持久化后才算成功；
- `projectName===scene.workName`；
- 名称修改必须原子更新两个字段；
- `previewUrl`只用于展示，不能用于恢复编辑；
- `previewUrl`必须是可跨应用重启解析的稳定引用；
- `blob:`URL不能写入持久化记录；
- `createdAt`表示首次正式保存时间，Scene的`createdAt`表示首次创建时间；
- `updatedAt`不得早于`scene.updatedAt`；
- 第一阶段允许`local_only`，不因云端系统未选型阻塞保存。

---

## 9.AI结果契约

### 9.1`AsrResult`

```ts
export interface AsrResult {
  transcript: string;
  provider: AsrProvider;
  durationMs: number;
  audioDurationMs?: number;
  confidence?: number;
  requestId?: string;
}
```

V0.2固定语义：

- `durationMs`表示客户端提交到收到规范化结果的端到端耗时；
- `audioDurationMs`表示录音内容时长，能够可靠取得时再填写；
- `confidence`不是所有Provider都提供，因此保持可选；
- `transcript`返回后必须由SXY页面确认、修改或重新录音；
- 未确认文本不得提交给QA；
- 原始儿童录音、完整问题文本和Provider原始响应默认不得写入持久日志。

### 9.2`QaResult`

```ts
export interface QaResult {
  answer: string;
  requestId?: string;
  safetyAction?: 'allow' | 'redirect' | 'reject';
}
```

规则：

- `answer`永远表示经过安全处理后可交给页面的最终文本，不是Provider原始输出；
- `redirect`时`answer`必须是安全替代回答；
- `reject`时不得展示原始内容，也不得将原始内容发送给TTS；
- QA失败不得改变Scene或清空已有页面状态。

### 9.3`TtsResult`

```ts
export interface TtsResult {
  audioUrl: ResourceRef;
  cacheHit: boolean;
  requestId?: string;
}
```

规则：

- 只用于动态问答回答；
- 固定素材语音使用`AssetAudioRefs`；
- TTS失败必须保留文字回答；
- `audioUrl`不得包含密钥；
- 临时音频引用在过期后必须返回明确错误，不能导致页面崩溃。

---

## 10.统一错误

### 10.1错误码

```ts
export type SharedErrorCode =
  | 'INVALID_ARGUMENT'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_NOT_UNLOCKED'
  | 'ASSET_TYPE_INVALID'
  | 'ASSET_SNAPSHOT_MISMATCH'
  | 'SCENE_SCHEMA_UNSUPPORTED'
  | 'SCENE_VALIDATION_FAILED'
  | 'SCENE_IMPORT_FAILED'
  | 'SCENE_MIGRATION_FAILED'
  | 'DRAFT_SAVE_FAILED'
  | 'DRAFT_RESTORE_FAILED'
  | 'PROJECT_NAME_REQUIRED'
  | 'PREVIEW_EXPORT_FAILED'
  | 'PROJECT_SAVE_FAILED'
  | 'MIC_PERMISSION_DENIED'
  | 'RECORDING_EMPTY'
  | 'REQUEST_CANCELLED'
  | 'ASR_TIMEOUT'
  | 'ASR_EMPTY_TRANSCRIPT'
  | 'QA_TIMEOUT'
  | 'QA_BLOCKED'
  | 'TTS_TIMEOUT'
  | 'AUDIO_LOAD_FAILED'
  | 'UNKNOWN';

export interface SharedError {
  code: SharedErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: Record<string, JsonPrimitive>;
}
```

### 10.2错误传递规则

- 异步Service失败时抛出或拒绝规范化`SharedError`；
- Electron IPC边界只传输可序列化的普通对象；
- 页面通过统一类型守卫识别错误；
- `message`必须是安全、简短、可展示的提示，不包含Provider内部信息；
- Provider原始错误、请求头、密钥、录音和完整儿童问题不得进入`details`；
- `retryable=true`才显示重试入口；
- 用户主动取消使用`REQUEST_CANCELLED`且通常不显示错误弹窗；
- `QA_BLOCKED`只用于无法生成安全替代回答的情况；能够重定向时返回`QaResult`。

---

## 11.EditorService安全边界

技术执行规范中的EditorService在实现时必须收紧为以下语义：

```ts
export interface EditorService {
  setBackground(
    asset: AssetRecord | null,
    access?: AssetAccessState,
  ): Promise<void>;

  addSticker(
    asset: AssetRecord,
    access: AssetAccessState,
  ): Promise<string>;

  removeObject(objectId: string): void;
  bringForward(objectId: string): void;
  sendBackward(objectId: string): void;
  bringToFront(objectId: string): void;
  sendToBack(objectId: string): void;
  undo(): void;
  redo(): void;
  exportScene(meta: {
    sceneId: string;
    userId: string;
    workName: string;
    themeId: string;
    assetSnapshotId: string;
  }): SceneDocument;
  importScene(scene: SceneDocument): Promise<void>;
  exportPreview(): Promise<Blob>;
}
```

`setBackground`规则：

- `asset===null`表示取消素材背景，不需要`access`；
- 非空背景必须提供`access`；
- 必须校验`asset.type==='background'`；
- 必须校验`asset.status==='ready'`，测试环境除外；
- 必须校验`access.assetId===asset.assetId`；
- 必须校验`access.userId===当前Scene.userId`；
- 必须校验`access.unlocked===true`。

`addSticker`规则：

- 必须校验`asset.type==='sticker'`；
- 必须校验素材状态、用户、ID对应关系和解锁状态；
- 调用方传入的`access`不能只因为`unlocked=true`就被盲目信任；
- 同一个素材每次调用都生成新的随机`objectId`。

> `AssetAccessState`在本地客户端不是强安全认证凭证，但EditorService必须进行第二层防误用校验，避免页面、收藏、历史或缓存入口绕过产品规则。

---

## 12.Scene验证、迁移与规范化

### 12.1运行时校验

TypeScript接口不能验证外部JSON。正式实现必须提供运行时解析器，使用工程已有校验能力或最小自有校验器，不得只使用类型断言：

```ts
const scene = raw as SceneDocument; // 禁止作为唯一校验
```

最低校验：

- Schema版本；
- 必填字符串；
- UTC时间格式；
- 画布尺寸；
- 数值有限性；
- 对象ID唯一；
- 贴纸类型；
- 等比例正缩放；
- 连续唯一层级；
- 背景类型；
- 资源快照存在性；
- 资源引用安全性。

### 12.2规范化导出

`exportScene`必须：

1.移除不属于Contract的Fabric内部字段；
2.将坐标转换为中心点语义；
3.规范化角度；
4.按视觉顺序将贴纸重排为`zIndex=1..N`；
5.按`zIndex`升序输出`objects`；
6.生成新的`updatedAt`；
7.保留已有`objectId`和`createdAt`；
8.运行完整Scene校验后返回。

### 12.3迁移

迁移只允许顺序执行：

```text
v1→v2→v3
```

每个迁移必须包含：

- 来源和目标版本；
- 字段变化；
- 默认值依据；
- 无法迁移时的错误码；
- 成功、失败和边界测试。

未知版本或失败迁移：

- 返回`SCENE_SCHEMA_UNSUPPORTED`或`SCENE_MIGRATION_FAILED`；
- 不进入编辑器；
- 不覆盖原始Scene；
- 预览可用时只读展示；
- 允许导出原始数据用于人工恢复。

---

## 13.角色接入规则

### 13.1ZXR

负责：

- 共享Contracts；
- Scene规则、校验和迁移；
- EditorService；
- Fabric对象与标准Scene的双向转换；
- 预览导出；
- 向后续模块提供规范化Scene。

不得：

- 维护飞书导出和Manifest；
- 维护Dexie与完整页面；
- 接入真实AIProvider；
- 为临时显示问题修改YWN内容字段。

### 13.2SXY

负责：

- 飞书导出、资源校验、Manifest和`assetSnapshotId`生成；
- 素材页、收藏、草稿、保存编排和录音交互；
- Dexie存储与预览资源持久化；
- 通过共享Contracts和Service工作，不依赖Fabric内部对象；
- 报告内容问题，不擅自改YWN文案和授权状态。

### 13.3TSH

负责：

- AI安全服务层和Provider；
- ASR、QA、TTS、AudioService和AnimationService；
- Provider结果和错误的规范化；
- 密钥、缓存、限流和隐私边界；
- 不让Renderer消费原始Provider响应。

### 13.4YWN

负责：

- 素材内容、图片加工、名称、介绍、标签、来源和授权；
- 固定语音内容生产与试听；
- 正常、异常和演示素材；
- 不手工维护Manifest；
- 不修改共享Contracts和程序代码。

---

## 14.Mock样例

### 14.1素材

```json
{
  "assetId": "sticker_lantern_001",
  "type": "sticker",
  "themeId": "theme_mid_autumn",
  "categoryIds": ["festival_object", "decoration"],
  "nameZh": "灯笼",
  "nameEn": "Lantern",
  "introZh": "灯笼既可以照明，也常被用作节日装饰。",
  "keywords": ["灯笼", "节日", "装饰"],
  "imageUrl": "mock://assets/sticker_lantern_001.png",
  "thumbnailUrl": "mock://thumbnails/sticker_lantern_001.png",
  "preSplitDataUrl": "mock://pre-split/sticker_lantern_001.json",
  "audio": {},
  "source": "mock_only",
  "license": "test_only",
  "contentVersion": 1,
  "status": "test_only"
}
```

### 14.2Scene

```json
{
  "schemaVersion": 1,
  "sceneId": "7a3435d2-2c2f-4df1-a38c-5b7e32ce91a8",
  "userId": "user_demo_001",
  "workName": "我的中秋月夜",
  "themeId": "theme_mid_autumn",
  "assetSnapshotId": "snapshot_demo_20260730_001",
  "canvas": {
    "width": 1200,
    "height": 800,
    "backgroundColor": "#FFF8E7"
  },
  "backgroundAssetId": "background_moon_001",
  "objects": [
    {
      "objectId": "62d775d8-e6f8-439a-9d04-0934cb03f81f",
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
      "objectId": "ed742af5-5e80-48bb-a507-df80d9031adb",
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

### 14.3正式项目

```json
{
  "projectId": "c3ac4f13-c4be-4ce0-8781-c60b78a21e83",
  "projectName": "我的中秋月夜",
  "scene": "<测试文件中嵌入完整Scene对象>",
  "previewUrl": "mock://previews/c3ac4f13-c4be-4ce0-8781-c60b78a21e83.png",
  "syncStatus": "local_only",
  "createdAt": "2026-07-30T05:20:00.000Z",
  "updatedAt": "2026-07-30T05:20:00.000Z"
}
```

正式JSON测试文件不得保留字符串占位，必须嵌入完整Scene。

### 14.4AI结果

```json
{
  "transcript": "灯笼为什么是红色的",
  "provider": "qwen_cloud_http",
  "durationMs": 1260,
  "audioDurationMs": 3100,
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
  "audioUrl": "mock://tts/qa_req_demo_001.mp3",
  "cacheHit": false,
  "requestId": "tts_req_demo_001"
}
```

---

## 15.正式代码化计划

工程基线同步到`integration/material-library`后，Codex读取真实仓库并进行最小映射。逻辑目标：

```text
shared/contracts/
├─asset.ts
├─scene.ts
├─project.ts
├─ai.ts
├─error.ts
└─index.ts

shared/validation/
├─scene.validation.ts
├─resource-ref.validation.ts
└─error.guard.ts

shared/mocks/
├─assets.mock.ts
├─scene.mock.ts
└─ai.mock.ts

tests/shared/
├─scene-roundtrip.test.ts
├─scene-validation.test.ts
├─scene-migration.test.ts
├─access-guard.test.ts
└─contracts-smoke.test.ts
```

最低测试：

- TypeScript类型检查；
- Mock符合运行时校验；
- 同素材多实例ID不同；
- Scene往返数据一致；
- 坐标和角度规范化；
- 等比例缩放约束；
- 连续唯一层级；
- 背景状态三种编码；
- 未解锁背景和贴纸均无法新增；
- 调用方伪造不匹配`access.assetId`时被拒绝；
- 旧锁定或缺失素材恢复时不静默删除；
- 未知Schema明确失败；
- 正式项目必须有稳定预览引用；
- 项目名称与Scene名称保持一致；
- 资源引用拒绝路径穿越；
- AI错误不泄露密钥、请求头、录音和完整问题。

Codex不得：

- 创建第二套共享类型；
- 用`as SceneDocument`替代运行时校验；
- 因测试不便删除字段或放宽不变量；
- 自行决定新的业务字段；
- 在工程基线未明确前创建第二套应用或依赖体系。

---

## 16.变更控制

任何Contract变更必须使用独立PR，并说明：

1.原因；
2.受影响字段；
3.是否破坏兼容；
4.Scene迁移；
5.Manifest转换影响；
6.Service映射影响；
7.Mock和测试更新；
8.接入步骤。

禁止在业务PR中顺手重命名字段、复制局部类型、删除字段却不提供迁移，或只改接口不更新文档、Mock和测试。

---

## 17.V0.2验收结论

- [x] 产品主链路与PRD V1.2一致；
- [x] 技术职责与执行规范V2.0一致；
- [x] 内容真源、授权和快照边界明确；
- [x] 素材、解锁、画布、草稿、项目和AI状态分离；
- [x] 背景、无背景和透明状态可以无歧义恢复；
- [x] 坐标、缩放、角度和层级语义已冻结；
- [x] 背景和贴纸均具备EditorService防绕过校验；
- [x] 正式保存必须同时包含Scene和稳定预览；
- [x] 项目名称重复字段的一致性责任已确定；
- [x] 资源快照与旧作品恢复策略已确定；
- [x] Schema验证、迁移失败和只读恢复策略已确定；
- [x] ASR耗时字段、QA安全结果、TTS降级和错误传递已明确；
- [x] Mock和代码化最低测试已补齐；
- [ ] 工程基线完成后验证真实目录、依赖和应用资源协议；
- [ ] Codex完成TypeScript、运行时校验和测试；
- [ ] SXY完成Manifest快照ID与预览持久化实现；
- [ ] TSH完成Service Mock与错误映射实现。

---

## 18.结论

> `AssetRecord`描述运行时素材，`AssetAccessState`描述用户当前是否可以新增素材，`SceneObject`描述贴纸实例，`SceneDocument`保存完整可编辑作品和素材快照，`DraftRecord`与`ProjectRecord`分别承载自动保存和正式保存，`AsrResult`、`QaResult`、`TtsResult`与`SharedError`统一客户端与TSH服务之间的边界。正式代码必须只引用这一套Contract。