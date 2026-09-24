# M4—M7 应用效果改进 V1：运行与审核指南

比较基线：`bf1bc12e6d433525f63fdc60e57ce5101ac9e2d4`。
本入口生成可撤回的实验设计，不替换默认路径，不代表用户视觉验收或制造评估。
本文记录实现和运行方法；真实案例是否改善，以对应提交的实际输出、局部图和机器汇总为准，不预填结果。

## 1. 原图、实验设计、实际裁片

- **A 原始分析**：保留 source snapshot、有效原始 RGBA、原 CP-B 标签、原 RC-A 纯化及 metadata。
- **B 实验设计**：独立记录前景清理提议、局部标签归属、新代表色、新共享轮廓及变更原因。
- **C 实际裁片**：M1 → M6 → M7 使用 B 的实际 Region/Component、精确 ColorSlot 和所选边，重新计算 Base、Piece、接缝与关系。

`m4/experimental-design.json` 记录参数、摘要、坐标、旧新映射及各策略启用状态。
其实际字节摘要进入新 `assetVersionId`；M1 的来源、颜色和几何 artifact 绑定实际 B 文件。
现有共享合同中 `frozenRegionArtifactId` / `frozenVectorArtifactId` 为继承的字段名；本路径的 adapter、来源说明和设计记录明确标注实验 B，**不表示冻结文件或人工签核**。

`quality_binding.verify_quality_design()` 从持久化快照重新执行前景归一化、CP-B、清理、选区归属、RC-A、Region/Component、共享图与轮廓策略，比较实际数组、metadata、映射和几何。
这不是 plan ID 的 PASS 缓存。随后继续真实 TypeScript 共享校验、结果身份计算，以及从序列化结果独立回读的最终几何复核和重渲染。

**A→B** 的简化和外观取舍需要视觉评审；**B→C** 的精确覆盖与重渲染不能代替前者。

## 2. 执行入口与开关

使用已配置的项目 Python、Node、TypeScript 和相同依赖。无需新安装依赖或迁移环境。
从仓库根运行；下面的输入路径须替换为实际固定 PNG 快照，每个输出目录必须全新或为空，并与输入隔离。

```powershell
$inputPng = 'C:\path\to\fixed-foreground.png'
$qualityOutput = 'C:\path\to\new-quality-comparison'
foreach ($mode in @('baseline', 'selection', 'contour', 'combined')) {
    python benchmarks/fabrication-layer-decomposition/algorithm-v1/algorithm_runtime.py `
        --input $inputPng --output "$qualityOutput/$mode" `
        --foreground-source 'DEVELOPMENT_FIXED_FOREGROUND: actual source and provenance' `
        --profile aggressive --quality-mode $mode --seam-strategy baseline
    if ($LASTEXITCODE -ne 0) { throw "Run failed: $mode" }
}
```

四条路径使用同一 profile、输入及前景解释，串行执行。不要把失败输出目录直接复用给下一次运行。

| 开关 | 实际行为 |
|---|---|
| `--quality-mode baseline` | 原 CP-B/RC-A、轮廓和 M7 路径；默认值 |
| `--quality-mode selection` | 新局部选区归属；轮廓策略关闭 |
| `--quality-mode contour` | 原标签；新共享轮廓策略 |
| `--quality-mode combined` | 新选区，再基于新标签生成和改善共享轮廓 |
| `--foreground-cleanup` | 另开未确认前景清理提议；只允许非 baseline 设计模式，默认关闭 |
| `--seam-strategy baseline` | 原 M7 排序；默认值 |
| `--seam-strategy compare` | 原排序，增加现有真实候选匿名比较 |
| `--seam-strategy visual-proxy` | 仅对现有有限候选应用实验接缝位置代价，再经过关系硬约束选择 |

要隔离接缝策略，固定 `quality-mode` 与其他参数，分别使用三个 `seam-strategy` 和三个新输出目录。
要隔离清理收益，固定设计模式，分别不带／带 `--foreground-cleanup`；不能把清理去除的输入岛计作内部选区归属收益。

带 alpha 的 PNG 使用默认 embedded-alpha；全不透明输入需要显式 `--whole-image-foreground`。
外部灰度 PNG mask 使用 `--mask`；不接受含非不透明 alpha 的原图再叠加另一 alpha 来源。
本实验设计 V1 只接受 PNG；原 baseline SVG/PSD 有限支持路径保留。
调用方的 `--manual-confirmation` 仅指前景来源解释，不签核新设计，默认 `PENDING_REVIEW`。

服务可直接调用同一公开入口，无须先手动执行安全校验：

```python
from pathlib import Path
import sys

sys.path.insert(0, str(Path("benchmarks/fabrication-layer-decomposition/algorithm-v1").resolve()))
from algorithm_runtime import run_algorithm

report = run_algorithm(
    image_path=Path("C:/path/to/fixed-foreground.png"),
    output_root=Path("C:/path/to/new-quality-run"),
    foreground_source="DEVELOPMENT_FIXED_FOREGROUND: actual source and provenance",
    quality_mode="combined",
    foreground_cleanup=False,
    seam_strategy="compare",
)
```

`run_algorithm()` 和 M4 `run_runtime()` 都保留写入前的 protected path、非空目录、输入输出重叠拒绝。
辅助纯策略不负责目录写入；不要直接使用内部低层函数替代公开编排。

## 3. 碎片与前景提议的边界

`quality_fragments.py` 使用一次同步判定，条件基于原标签，不依靠多轮扩散。
当前参数完整写入运行记录，代码中的 `PARAMETERS` / `CLEANUP_PARAMETERS` 为准：

- 内部分区：面积上限 16 px，实际 4 邻接目标至少 64 px 且至少为原片 8 倍；目标接触占比至少 0.5，不能跨越不连通目标。
- 弱边界多域交汇：Lab 边界差中位数不超过 10、最大值不超过 18，同时要求非外轮廓接触和至少两个相邻域。
- 外轮廓过渡：局部半径 3 px、主体支持至少 0.35、过渡厚度不超过 1.5 px；颜色混合系数 0.1–0.9，RGB 残差不超过 22、色度不超过 36。
- 保护：暗色平均亮度低于 45、长宽比超过 4、真实 alpha 孔洞邻域、完整输入孤岛、缺少过渡证据的细节，均保留。
- 另开的清理提议：紧凑岛面积不超过 9 px、最大边长 5 px、长宽比不超过 2；亮度至少 180、色度不超过 35、距主要主体不超过 6 px，并要求邻接外部背景颜色证据。主要主体面积门槛为 256 px 与最大主体 1% 的较大者，外部 RGB 距离上限为 80。

这些条件不是艺术意图识别，也不等价于“面积小所以无用”。透明区 RGB 可能有编码残留，清理条件只是开发假设。
清理记录包含每个岛的位置、面积、距离、颜色与保留／去除理由；`manualConfirmation=NOT_CONFIRMED`。
清理仅产生派生有效前景，原 alpha 快照不改；不膨胀、不搭桥、不全图同色合并，不重新启用旧 Region Repair 配置。

归属变更后重新分配 fringe，调用原 RC-A 重算代表色，再生成新精确调色板；实验颜色组不是 ColorSlot。
审阅 `selection.componentMappings`、`changedPixelsXY` 和 cleanup 记录，分别追踪输入孤岛与大主体内标签小片。

## 4. 共享轮廓与显示

`quality_contours.py` 复用现有拟合、连续偏差和整体 embedding 校验；同一共享边只定义一份几何，两侧继续使用方向引用。
候选设计偏差预算为 **0.5 / 0.75 / 1.0 px**，拟合预算为各值的 **0.75**。
这是预先声明的设计变化预算，不是放宽数值误差；`validationFlatnessPx` 及原硬检查保持不变。
保留的原边可能使用原批准预算，因此每次试验同时记录 `designBudgetPx` 和 `effectiveMaxBudgetPx`。

完整窄组件最大内接半径不超过 2 px 时，其边界受保护；局部骨架窄分支另以半径 2 px、走廊余量 1 px 保护。
保护段与已有持久尖角作为分段锚点，非保护段才复用拟合。所有方案继续检查整体合法性。
只选择合法且 segment 数减少的候选；没有合法减少就保留原几何。减少 segment 是几何复杂度代理，不自动等于更好看。

记录包含每条改动边的 ID、左右 Region、bbox、前后 segments、实际位移、试验降级原因、薄片／局部分支保护范围。
M7 重新使用选定轮廓，不能在拆片之后独立移动继承边界。

仅 contour / combined 路径启用候选级硬验证拒绝：GEOS 分割若产生哪怕严格来源检查能够检测的微小越界，该 Base/方向候选也被拒绝，并在 `rejectedCandidates` 记录具体原因；其余原有有界候选继续接受同样完整检查。没有合法候选时仍失败。不会放宽正面积相交判断、补写虚假来源或移动切割后边界。默认和 selection 路径的历史 fail-fast 行为不变。

显示请同时查看：

- `shared-edges.svg`：实际 LINE/CUBIC 共享边逐边绘制，用于边界检查；
- `appearance-aa.png`：实际组装投影与精确 ColorSlot，无编号；
- `seams-aa.png`：同样采样的物理接缝标记；
- `references-aa.png`：单独编号参考；不要把编号文字当作图案。

AA 使用统一 3 倍采样与 LANCZOS，透明底；对旧新图使用相同背景和放大倍率。
组装投影仅为显示按 ColorSlot 合并等色投影域，物理 Piece 和接缝记录不合并。
AA 不是轮廓改善证据；最终外观不贴回原图，不用模糊、阴影或羽化掩盖裁片差异。

## 5. 接缝 A/B/C 与可关闭排序

`quality_seams.py` 先复核并重新评分所有实际候选，不信任存储的旧 score。
匿名 **A/B** 优先为同 Base 的真实 X/Y 方案，**C** 为另一精确 Base 方案；不足三种时明确记录缺项，不捏造候选，不先标“最好”。
`quality-seam-comparison.json` 保留全部候选 ID、原排序、实验排序、每个物理接缝的两侧 Piece、坐标及长度；集成层补充真实 M6 关系状态和最终选择 ID。
每种匿名方案输出 appearance、seams、references，以及统一中央窗口的 appearance-detail / seams-detail。
中央窗口来自前景 bbox 的中央 40%，放大 3 倍；它不是自动检测的图案范围。需要其他局部位置时对照真实坐标另行查看。

代理为每个实际可见内部接缝段按长度加权：中央椭圆尺度为 bbox 的 0.30，中央权重 3.0，暗色权重 0.5，以实际折线段中点积分。
来源明确是开发者声明的空间／精确 RGB 假设，**不是用户真值、自动图案识别或布料显著度模型**。
先满足几何与来源硬约束；再按代理、可见接缝量排序，之后才比较 Piece/顶点数量及总长度。真实关系硬约束仍可拒绝方案。

可见接缝用洋红色；被遮盖 BASE 接缝用青色作参考，不表示从正面能看见。
所有物理记录保留，即使投影重合；原图案边界本身不自动成为新增拆分接缝。
不增加 VISIBLE 隐藏搭接，不改变覆盖或全局孔洞。
偏心图案、文字或低对比装饰可能不符合中央／暗色代理；必须保留表现变差的方案，不能假定 Y 更好。

## 6. 回归位置与审核顺序

新增策略与保护反例见：

- `tests/test_quality_fragments.py`：实际邻接、输入孤岛与内部片区、暗细节、孔洞和 fringe；
- `tests/test_quality_contours.py`：实际共享拟合、合法回退、尖角与窄域／局部分支保护；
- `tests/test_quality_seams.py`：完整物理记录、重新评分、元数据拒绝、匿名真实方案与统一采样；
- `tests/test_quality_pipeline.py`：四模式贯通、清理重新入链、实际身份、输出隔离和合法重算摘要后的语义拒绝。
- `tests/test_quality_partition_rejection.py`：实际月饼微小越界复现、非法切割候选拒绝、默认 fail-fast 及全部非法仍失败。

原 `test_solid_plans.py`、`test_seam_completeness.py`、`test_equivalent_performance.py`、关系、M1/result wire 和独立 rerender 回归继续保留。
全量相关回归、六个现行冻结验证器、原 844 文件清单／字节核验和 fresh checkout 实际运行结果由本批验证日志报告，不以本文替代。
旧辅助脚本的已知失败单列，不计入现行门禁通过。

审核顺序：先看 A→B 实际位置和细节是否保留，再看 B 的曲线及降级理由，再匿名比较实际接缝，最后核对 B→C 的身份／几何／回读记录。
片数减少、曲线变圆或重渲染差异为零，均不是单独的质量通过结论。
保护反例属于合成验证，不能称为真实素材泛化结果；已有固定前景不意味着项目没有去背景能力。

默认产品行为、冻结内核及证据、正式 M3/B2、R4/background-removal 均不由本实验策略替换。
不进入 M8—M11、毫米制造评估、材料库、纸样导出或新产品界面。

```text
USER_VISUAL_ACCEPTANCE=PENDING
MANUFACTURING=NOT_EVALUATED
PRODUCTION_EXPORT_ELIGIBLE=NO
M8_STARTED=NO
```
