# 彩色裁片与叠放指导 PDF：技术实现说明

版本：V1.1\
日期：2026-10-20\
对应产品文档：`docs/PRD_PDF_EXPORT.md`\
适用代码：当前工作区的本地实现。本文描述导出模块，不代表已经提交或发布。

## 1. 前提与模块边界

**假设上游分层算法已经能够返回可用的图层、颜色、轮廓及层级关系。** 本文不讨论图层如何识别、遮挡如何推断、PSD 如何解析，或上游使用何种素材格式。

导出模块只负责：

1. 将已有分层与保存作品的位置、颜色和顺序对应起来。
2. 计算统一制作比例，生成实际尺寸的彩色裁片页。
3. 逐层累加，生成每个元素的制作指导图。
4. 按保存的整体顺序累加元素，生成最终拼装指导图。
5. 将三部分按顺序写入一个 PDF；UI 仅保留原有裁片预览。

它不调用 AI 生图，不重新分割、不合并同色层、不补全形状，也不修改上游的层级关系。

文中的文件路径均相对于仓库根目录。新增数据契约示例是对输入含义的说明，不表示新增了某个后端 HTTP 接口。

## 2. 总体数据流

```text
已保存作品 + 上游分层结果
  ├─ buildWorkDisplay → 完整元素图 + 整体逐步累计图 WorkDisplay
  └─ prepareWorkCuts  → 场景坐标下的原始裁片 CutPiece[]
                          ├─ planCuttingPages → A4 实际尺寸排版 CuttingPlan
                          │                       └─ CuttingPreview：仅用于 UI
                          └─ buildAssemblyGuide(cuts, display)
                                                  → PDF 专用步骤 AssemblyGuide

exportCuttingPdf(plan, workName, guide)
  → 彩色裁片页 → 各元素制作步骤页 → 整体拼装步骤页 → Blob 下载
```

关键设计：裁片排版和制作指导共同读取原始裁片，但各自计算展示位置。**不能拿已经为省纸而重新排列过的裁片页坐标来叠放元素。**

## 3. 主要代码模块

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| 页面编排 | `src/renderer/src/pages/WorkDisplayPage.vue` | 读取保存作品，管理准备/导出状态，连接背景选项，触发下载 |
| 作品重建 | `src/renderer/src/workflows/work-display.ts` | 统一场景顺序，生成完整元素图与整体累计 PNG |
| 裁片准备 | `src/renderer/src/workflows/work-cutting.ts` | 通过现有接入层取得分层与颜色，校验来源，变换到场景坐标 |
| 背景分支 | `src/renderer/src/workflows/work-background-cutting.ts` | 拆层背景、整图背景、纯色背景与无真实背景的统一处理 |
| 背景识别 | `src/shared/scene-background.ts` | 区分真实作品底色与默认 UI 纸面 |
| 尺寸选择 | `src/renderer/src/projection/subject-size.ts` | 具体尺寸、鸡蛋/苹果/书等大小选项 |
| 裁片布局 | `src/renderer/src/projection/cutting-layout.ts` | 场景变换、编号、共同缩放、同层分组、A4 排版与续页 |
| 指导数据 | `src/renderer/src/projection/assembly-guide.ts` | 生成元素内部的累计步骤与整体拼装步骤 |
| 指导绘制 | `src/renderer/src/projection/assembly-guide-pdf.ts` | 紧凑步骤网格、新增层缩略图、箭头、序号、累计图 |
| PDF 输出 | `src/renderer/src/projection/cutting-pdf.ts` | jsPDF 绘制裁片页，追加指导页，返回 Blob |
| 中文标识 | `src/renderer/src/projection/pdf-text-image.ts` | 将必要的中文标题栅格化，避免 PDF 字体缺字 |
| UI 预览 | `src/renderer/src/components/projection/v2/CuttingPreview.vue` | 在透明横屏区域展示制作层，不展示指导页 |

## 4. 输入契约与顺序归一化

### 4.1 上游需提供的信息

对每个完整元素实例，需要能确定以下数据：

- 对应的作品对象，以及素材/分层结果的固定版本。
- 每个制作层的标识、实色、轮廓与底到顶制作顺序。
- 同层多个离散裁片的归属关系，以及真实孔洞。
- 元素原始尺寸与在作品中的位置、缩放、旋转和可见状态。
- 完整元素在作品中的底到顶顺序，以及完整元素的可合成图像。

导出核心使用的是已排序的 `step` 与场景元素顺序，而不是一张待推断的遮挡关系图。若上游返回的是关系边或偏序，应由接入层先归一化为稳定制作顺序；PDF 核心不负责重新推断或拓扑排序。

层级关系必须区分两个尺度：

- 元素内部：例如底板、衣服、头发、装饰，决定制作步骤。
- 整体场景：例如背景、灯笼、红包、福娃，决定完整元素的拼装步骤。

两者不能混为一组爆炸图图层。

### 4.2 当前中间数据

`CutPiece` 的主要字段如下：

```ts
interface CutPiece {
  id: string
  element: number       // 完整元素实例编号
  step: number          // 元素内部制作顺序
  color: string         // #RRGGBB 实色
  rings: CutPolygon     // 一个裁片的外轮廓及孔洞，场景坐标
  imageUrl?: string     // 仅完整背景彩图等栅格内容使用
  backgroundFrame?: { width: number; height: number }
}
```

一个制作层可以产生多个 `CutPiece`，但它们共用 `element + step`。整图背景使用矩形范围及 `imageUrl`，不为它虚构内部色层。

`WorkDisplay` 包含：

- `layers`：按作品顺序排列的完整元素；其中的 `image` 是该完整元素在全场景坐标中的独立 PNG，`background` 表示是否为真实作品背景。
- `assemblies[i]`：加入第 `i` 个完整元素之后的场景累计 PNG。
- `width / height`：保存作品的画布范围。

`CuttingPlan` 包含：

- `pages`：实际 A4 纸上的裁片与编号位置。
- `scale`：场景坐标到纸张毫米的共同缩放系数。
- `widthMm / heightMm`：实际成品基准范围。
- `pieceCount`：裁片数量，不等于制作步骤数量。

### 4.3 保持两条数据链一致

`prepareWorkCuts` 与 `buildWorkDisplay` 都使用 `displayObjectOrder(scene)`：可见核心图案在前，其余可见普通/个人元素按 `zIndex` 排序；存在真实背景时先放背景。

存在背景时前景元素从 `2` 编号，否则从 `1` 开始。`buildAssemblyGuide` 校验元素分组数量、编号范围、完整元素数量及累计图数量。该结构检查不能替代前置的素材版本和颜色来源校验。

## 5. 坐标、颜色与背景

### 5.1 前景坐标变换

`transformCuts` 将原始局部轮廓变成场景坐标。设原图尺寸为 `W × H`，局部点为 `(px, py)`：

```text
x = (px - W/2) × scaleX
y = (py - H/2) × scaleY

sceneX = left + cos(angle) × x - sin(angle) × y
sceneY = top  + sin(angle) × x + cos(angle) × y
```

负缩放保留镜像效果；无效或零缩放直接失败。变换只改变坐标，不重排轮廓、不改变层序。已保存的换色覆盖原始色，但不写回源素材。

`CutPiece[]` 始终保留为场景空间的原始输入；排版生成新的 `PlacedCut`，不就地移动原始裁片。

### 5.2 背景选项不等于删除背景

```text
includeBackground = true  → backgroundMode = 'layers'
includeBackground = false → backgroundMode = 'image'
```

只要保存作品存在真实背景，两个模式都会导出背景：

- `layers`：返回已有背景制作层，每层附带同一 `backgroundFrame`，并生成内部步骤。
- `image`：返回一张完整背景彩图及全画布矩形；不生成背景内部步骤，但保留整体拼装中的背景步骤。
- 仅有用户明确设置的底色时，可作为一个实色矩形制作层；默认 UI 纸面不进入此链路。
- 没有真实背景时返回空背景列表，不生成占位白纸或空背景编号。

背景在保存作品中如已采用居中 `cover`，导出重建沿用同一画面取景。**这是复现已保存作品的取景，不是为了塞进 A4 再裁掉图像。** A4 适配阶段只做等比例缩放。

## 6. 统一物理尺寸与 A4 上限

### 6.1 基准范围

有背景时使用 `backgroundFrame`，即完整作品画布宽高；无背景时使用全部前景裁片的整体包围盒。不能逐元素分别计算成品比例。

设基准尺寸为 `W × H`：

```text
具体宽高范围 Bw × Bh：requestedScale = min(Bw/W, Bh/H)
仅指定长边 L：        requestedScale = L/max(W,H)

先选择唯一纸张方向；四周 margin = 12 mm，编号空间 = 6 mm
横向可用裁片区域：273 × 180 mm
纵向可用裁片区域：186 × 267 mm
maxW/H = 基准范围与所有制作层组宽高的逐轴最大值
scale = min(requestedScale, 可用宽/maxW, 可用高/maxH)
```

`scale` 单位为毫米/场景单位，所有裁片共用。大于 A4 的请求限制的是整个成品比例，不是某一层的独立尺寸。

### 6.2 当前尺寸选项

- 默认：18 × 18 cm 容纳范围。
- 鸡蛋：目标长边 60 mm；苹果：80 mm。
- 一本书：请求长边 297 mm，但受安全打印区域约束，不再满幅。1302 × 858 的横幅作品实际为 273 × 179.90 mm；正方形最大为 186 × 186 mm。

实际结果以 `CuttingPlan.widthMm / heightMm` 为准。尺寸选项不是打印机的“适合页面”缩放。

## 7. 彩色裁片排版算法

实现采用按制作层分组的 shelf 排版，不是按颜色分组，也不是寻找全局最优的拼版算法。

1. 以 `element-step` 为键分组，按元素号、制作层号排序。
2. 计算每组整体包围盒；所有离散裁片保留组内相对坐标。
3. 应用共同 `scale`，生成毫米单位的 `PlacedCut`；轮廓转换成各裁片自身的局部坐标。
4. 普通图层优先尝试已有纸张的已有行，再尝试该纸张的新行，最后创建新纸张。
5. 行内水平间距为 6 mm；层组高度额外预留 6 mm 给编号，换行再留 6 mm 间隔。极小层组按编号宽度预留最小占位，避免文字相撞。
6. 编号每组只放一次，不给每个离散小配件单独编号。

纸张方向在共同缩放前选定：基准范围为横图，且按请求尺寸有制作层宽度超过 186 mm 时使用横向 A4；其他情况使用纵向 A4。所有裁片页方向一致，不旋转单个裁片。

普通排版从距纸边 12 mm 处开始，底部预留编号空间。这是布局空位，不绘制边框。

已移除 `fullPage` 满幅分支。最大制作层也必须遵守留边；需要缩小时在排版前统一限制整套比例，而非逐页或逐层重新适配。原始轮廓、角度及同层配件相对位置不变。

实色裁片输出采用 `print-settings.ts` 的 0.3 mm 纯黑描边，图纸缩略图同样使用该样式。轮廓中心路径不偏移、不膨胀或重算。PDF 写入 `/ViewerPreferences /PrintScaling /None` 与 `PickTrayByPDFSize`，这是阅读器建议，不强制公共网站遵守。`print-calibration-pdf.ts` 生成独立测试页，不追加到正式图纸。归档记录写入打印版本，旧版文件仍保留，但直接下载前要求重新导出。

为减少纸张，小图层可能排到前面的纸张空位里。因此实际制作顺序必须读取编号，不按纸面左右或页码推断。

## 8. 元素内部的逐层累计图

`buildAssemblyGuide(cuts, display)` 按元素建立 `kind: 'element'` 的组。

```text
对每个元素：
  bounds = 所有制作层的共同包围盒
  accumulated = []
  按 step 升序遍历：
    added = 当前 step 的全部裁片
    accumulated 加入 added
    保存一步：label、added、accumulated 的新数组快照
```

每一步的 `added` 用来绘制新增层缩略图，`pieces` 用来绘制累计效果。创建新数组快照，防止后续累加使之前的步骤也变成最终图。

同一元素的全部步骤固定使用同一 `bounds`，保持视角与比例一致。当前实现沿用保存作品的旋转和镜像，不另外把元素转正。

绘制累计图时按底到顶顺序填充裁片，使用 even-odd 规则保留孔洞。这里绘制的是实色色块轮廓，不是逐步调用 AI，也不是每一步都显示最终成品。

整图背景通过 `imageUrl` 识别并跳过内部制作组；拆层背景则按普通元素累计。

## 9. 整体拼装图

`buildWorkDisplay` 在透明 Canvas 上按场景顺序绘制：先真实背景，再每个完整元素。每加入一个元素保存一次 `assemblies`，与 `layers` 一一对应。

个人素材使用已保存的固定版本合成图。资源经现有资源桥加载，避免直接绘制自定义资源协议导致 Canvas 污染、无法导出 PNG。

`buildAssemblyGuide` 最后追加 `kind: 'scene'` 的组：

- `bounds` 为完整画布。
- 第 `i` 步的累计效果直接使用 `display.assemblies[i]`，保持实际位置和遮挡效果。
- 新增缩略图使用第 `i` 个完整元素的裁片集合；对应编号只写元素号，如 `+ 3`。
- 没有真实背景时直接从首个前景元素开始，不先涂一张 UI 白纸。

内部制作示意以矢量轮廓为主，整体累计图使用保存作品重建的 PNG。这两种数据源都基于同一保存版本，但抗锯齿细节不要求逐像素完全相同；轮廓关系、颜色、顺序和位置应一致。

## 10. 步骤页紧凑排版

`appendAssemblyGuide` 只向 PDF 追加页面，不返回 UI 组件。

当前参数：A4 纵向，页边布局空位 12 mm，列间距 8 mm，步骤行高 62 mm。

- 元素制作组：每行 3 步。
- 整体拼装组：每行 2 步，单独从新页开始。
- 组标题占 9 mm，组间额外间隔 4 mm；空间不足新建页面并重复必要标题。
- 新增层缩略图适配 19 × 10 mm 范围；累计图区域高 43 mm，宽度随列数确定。
- 每步先绘制 `+ 编号` 和新增内容缩略图，再用小箭头指向下方累计效果。
- 各元素示意独立缩放以适合小图区域；这不会改变裁片页的实际物理比例。

必要的中文名称和“整体叠放”通过 Canvas 按已加载字体栅格化，再作为 PNG 嵌入；纯数字编号使用 PDF 文本。当前标题为图片，不是可检索的中文文字层。

## 11. PDF 合成与下载

核心调用关系：

```ts
const plan = planCuttingPages(cuts, sizeChoice)
const guide = buildAssemblyGuide(cuts, display)
const blob = await exportCuttingPdf(plan, work.projectName, guide)
```

`exportCuttingPdf` 使用 jsPDF，以毫米为单位、开启压缩和必要字体输出：

1. 按 `plan.pages` 绘制实际尺寸裁片。
2. 矢量裁片绘制所有 ring，再执行 `fillStrokeEvenOdd()`，以避免镜像或环方向导致孔洞被误填。
3. 整图背景用 `addImage` 按计划毫米尺寸放置，不增加打印边框。
4. 输出每层唯一编号；裁片线宽为 0.2 mm。
5. 调用 `appendAssemblyGuide`，追加各元素步骤及整体步骤；示意轮廓线宽为 0.12 mm，箭头为 0.25 mm。
6. 全部完成后才调用 `doc.output('blob')`。

页面创建临时 Object URL，通过下载锚点保存为 `<作品名>-彩色裁片图纸.pdf`；替换文件名非法字符，并在 30 秒后释放 URL。该方式表示已交给下载机制，不等同于操作系统一定已成功写盘。

在触发下载前，当前页面还会调用 `cuttingPageThumbnail(plan.pages[0])`，按与 PDF 相同的首张排版数据生成 PNG，再由 `persistence/blueprints.ts` 保存 PDF Blob、首张图、尺寸、背景模式及场景内容指纹。Dexie V6 新增本机 `blueprints` 表，V5 的同步备份表保留不变。该表不加入云端 `SYNC_TABLES`。个人中心按账号、作品和指纹读取当前图纸；作品删除时原子清理关联记录，作品改动后不把旧记录展示为新图纸。

底层导出函数的 `guide` 参数为可选，便于独立测试裁片输出；正式页面始终传入指导数据。因此业务调用不能遗漏第三个参数，否则只会生成裁片部分。

## 12. 状态、失效与错误处理

- `preparing` 避免重复准备，`exporting` 避免重复触发生成；状态文字只在处理中或出错时显示。
- 原始 `cuts` 与计算出的 `plan` 分开保存；尺寸变化只重排版，不重新分层。
- 背景选项变化时递增 `preparationGeneration`，清空旧裁片及错误；旧异步请求的成功结果不能覆盖新选择。
- 页面卸载触发 `AbortController.abort()`，供读取与准备流程在检查点取消。
- 校验或绘制失败时不触发下载，显示具体错误；已有保存作品和原始素材不改动。
- 编号数量与累计图数量不一致、空轮廓、非法尺寸、缺失分层或版本不符时应失败，不静默跳过整个元素。

当前 PDF 绘制本身没有完整的中途取消机制，也没有后台导出队列；不能把读取阶段的 AbortSignal 当成整个导出过程都支持即时取消。

## 13. 验证与回归

主要测试入口：

| 测试文件 | 主要覆盖 |
| --- | --- |
| `tests/renderer/assembly-guide.test.ts` | 制作顺序、离散配件、固定范围、整图背景跳过内部步骤、无背景、编号结构校验、UI 不显示指导 |
| `tests/renderer/assembly-guide-pdf.test.ts` | 三部分页序、实际新增编号、步骤续页、单张 A4 整图及无额外边框 |
| `tests/renderer/cutting-layout.test.ts` | 统一尺寸、颜色混排、空位复用、层组相对位置、孔洞、旋转镜像、A4 上限 |
| `tests/renderer/cutting-pdf-color.test.ts` | 彩色填充、even-odd 孔洞、黑白材料及唯一编号 |
| `tests/renderer/work-background-cutting.test.ts` | 两种背景输出、真实图层、版本匹配、UI 纸面排除及取消 |
| `tests/renderer/work-cutting.test.ts`、`tests/renderer/work-display.test.ts` | 保存作品与导出来源、整体顺序和重建 |

基本检查命令：

```text
npm run typecheck
npx vitest run
npm run build
git diff --check
```

PDF 视觉验证必须补充实际浏览器/Electron 导出，再用 Poppler 渲染全部页面检查；仅通过 jsPDF mock 测试不能证明图片实际可解码、中文无缺字、排版无裁切。

已完成一次当前实现的全量 858 项测试及春节作品的两种背景模式端到端导出、逐页渲染检查。这里记录的是该次验证，不代表所有后续素材已验收，也不代表实物手工制作认证。本技术文档新增本身未重新运行功能测试。

## 14. 实现边界与后续注意项

以下是当前实现的技术边界，不展开上游分层算法：

1. 裁片契约为单层实色加轮廓；纹理、渐变、透明材质及混合模式不由这一色块绘制器完整表达。
2. 依据上游已有顺序生成指导，不自动推断更适合手工的粘贴、翻转、缝合或材料厚度工序。
3. shelf 是启发式排版，可能留有空位，不保证纸张数量全局最优；不能用改变单层比例来填空。
4. 默认已留约 12 mm 安全边距，但无法替代实际打印机和第三方网站的设置；需实际大小打印，不能据电子验收宣称实物比例已验证。
5. 上游如果改变轮廓原点、元素坐标锚点、镜像定义或层序方向，必须先修正接入映射，再复用现有导出。
6. 大量全画布 PNG、复杂轮廓和很长的累计步骤会占用渲染进程内存；当前无 Worker、流式写出或大任务分批机制，不能声称支持无限层数。
7. 实际尺寸被 A4 上限限制时，以 `CuttingPlan` 为最终结果；当前页面仍保存用户原始尺寸选项，并未额外增加尺寸修正提示。后续修改交互时应保持选择值与实际结果含义清晰。

整体扩展原则：在上游持续满足输入契约的前提下，更换主题、图层数量、颜色或作品布局不需要重写 PDF 生成器；保持“原始分层数据”“打印排版数据”“指导图数据”三者解耦即可。
