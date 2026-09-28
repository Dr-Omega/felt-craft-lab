# M4–M7 algorithm initial candidate

This is an experimental, size-independent algorithm batch, not a production
release or an accepted fabrication plan. It reuses frozen CP-B / RC-A,
Region Core and the selected P0-04C V2 → V1 → V0 result. Original inputs,
frozen evidence and R4 worktrees remain read-only.

## Public processing entry

`algorithm_runtime.run_algorithm(...)` owns output protection before every
processing write, including failure diagnostics. Output must be absent/empty,
outside protected paths and isolated from input. `m4_runtime.run_runtime` keeps
its own guard as an independently reusable M4-only entry. Internal writer
helpers are private. No caller must remember to invoke a separate safety gate.

```python
from pathlib import Path
from algorithm_runtime import run_algorithm

report = run_algorithm(
    image_path=Path("explicit-foreground.png"),
    output_root=Path("new-isolated-output"),
    foreground_source="Caller-supplied embedded alpha; no inferred background",
    manual_confirmation="PENDING_REVIEW",
    profile="aggressive",
)
```

Single-frame PNG is the flat input boundary. Non-identity EXIF orientations
are rejected. Fully opaque PNG requires `whole_image_foreground=True`.
An external mask uses `mode="external-mask", mask_path=Path(...)` and must be
single-frame 8-bit L PNG with matching dimensions; dual alpha sources reject.
SVG/PSD require explicit `selected_layer_ids=["*"]` (all supported pixel/shape
layers) or actual IDs. This does not authorize guessing/deleting a background.
See [M5_SUPPORT.md](M5_SUPPORT.md) for the finite real parser support matrix.

## Rebuild

Keep the repository's benchmark requirements/unittest workflow. Install
[requirements.txt](requirements.txt) into a separate environment, never into
backend/R4/another worktree's environment. The tested interpreter is Python
3.12. Node and TypeScript must already be available; set `TYPESCRIPT_TSC` to
`node_modules/typescript/lib/tsc.js` if needed. The adapter compiles and calls
the actual shared TypeScript validator; it never installs dependencies itself.

From the repository root (replace `PYTHON` with the isolated interpreter):

```text
PYTHON benchmarks/fabrication-layer-decomposition/algorithm-v1/algorithm_runtime.py --input explicit-foreground.png --output new-output --foreground-source caller-explicit-alpha
PYTHON benchmarks/fabrication-layer-decomposition/algorithm-v1/algorithm_runtime.py --input supported.svg --select-layer explicit-foreground --output new-layered-output --foreground-source development-layer-selection
PYTHON benchmarks/fabrication-layer-decomposition/algorithm-v1/run_examples.py --output new-example-directory
PYTHON -m unittest discover -s benchmarks/fabrication-layer-decomposition/algorithm-v1/tests -v
```

`run_examples.py` reads three original project development snapshots (crescent,
envelope, mooncake) without loading GT or tuning profiles. It separately
generates clearly labeled, genuine development SVG/PSD sources and targeted
ring, tradeoff, diagonal/fringe and unsupported-blend cases. It records source
hashes before/after, actual failures and output locators in `examples.json`.
New runs do not use the frozen FLD ID namespace or overwrite existing outputs.

## Actual outputs for the next algorithm

- `fabrication-input.json`: real **b2.input/1**, exact RC-A ColorSlots, observed
  Component provenance and source → analysis → P0-04C → canonical transforms.
- `fabrication-result.json`: shared **b2.result/1**, actual hole-free BASE and
  VISIBLE geometries, exposures, split groups, measured seams and final relations.
- `artifact-locations.json`: portable artifact-ID → relative-file lookup. Verify
  each file against the corresponding identity before consuming it.
- `fabrication-geometry.json`: actual GeoJSON objects keyed by Piece ID,
  `exposure:<index>`, Seam ID, and `source:<SplitGroup ID>`. Geometry inherits
  selected vector segments using P0-04C's existing flattening rule.
- `relation-evidence.json`: measured contact/overlap, actual source-layer
  visibility witnesses, final source mappings/support and seam measurements.
- `candidate-comparison.json`: every retained alternative and hard rejection,
  actual Base colors, exposed/interior seam proxy, piece/vertex counts and reasons.
- `geometry-checks.json`: independent reread, conservation, topology and final
  Piece render measurements. A failed/unbound record cannot yield passing checks.
- `structural-assessment.json`: **b2.structure/1** tied to result SHA. Geometry
  checks may pass; purification/source semantics and aggregate remain
  `REVIEW_REQUIRED`. Manufacturing is `NOT_EVALUATED`; production export is NO.
- `index.html`: actual input/purified/observed, Base/exposure, pieces, seams,
  independent rerender, differences and located unresolved Region diagnostics.
- `algorithm-recipe.json`: effective configuration, implementation LF-byte
  hashes and dependency versions. `execution.json` alone holds local paths/time.
- `m4/`: actual source snapshot, effective alpha, arrays, selected-vector graph,
  M4-only diagnostics and stable algorithm identity. New runs are not frozen GT.

Failure leaves `failure.json` with the real error, completed stages and residual
files; no final complete report is published before all required outputs exist.
This is exception handling, not a power-loss atomic transaction. Residual
intermediate JSON does not constitute a completed/accepted algorithm run.

## Decision and numerical semantics

See [M6_STRATEGY.md](M6_STRATEGY.md) and [M7_STRATEGY.md](M7_STRATEGY.md).
Source layers provide located visual evidence, not automatic assembly order.
The finite Base/solid alternatives are reviewed again against final Piece IDs.
Missing visual evidence is UNRESOLVED; independently proven final non-overlap
can make it NON_BLOCKING. Unspecified pairs remain NOT_EVALUATED.

No ordinary VISIBLE hidden completion, global same-color merge, Region Repair,
bridge, hole fill, pixel-contour fallback, buffer or boundary repair is enabled.
Area/length numerical residual limits verify the inherited geometry; they do
not license an additional M7 boundary displacement. All small positive pieces
remain present, even when they are clearly impractical and require review.

The final render uses actual persisted Piece geometry/ColorSlots and topological
support order, not labels. Pixel centers exactly on an original color boundary
may belong to either adjacent color; raw differences and those exact ties are
reported separately. Interior mismatches still fail. New split-seam centers
must not erase foreground. Original alpha voids, threshold voids and a Region's
inner ring filled by another Region are not conflated.

RGB change counts and geometric agreement are not human quality ratings.
`falseMerge`, `falseSplit`, manual acceptability and physical cutting thresholds
are not invented. No M8–M11, sizing, material model, export or product UI is added.

See [VERIFICATION.md](VERIFICATION.md) for the executable evidence map and clean
checkout commands, and [VISUAL_REVIEW.md](VISUAL_REVIEW.md) for located agent
observations and explicit human-quality limitations.

## Explicit practical-auto selection V2

`--quality-mode practical-auto` uses `practical-seeded-design/2` and
`local-ownership-candidates/2`; the default, design-colors and layered paths are
not replaced. This is an experimental design proposal, not visual acceptance.
The existing completion, fallback, ranking and persisted geometry gates remain.

The selector compares source-supported KEEP/MERGE hypotheses using continuous
multi-radius raw boundaries, local plateaus, actual perimeter burden and adjacent
face mixing evidence. Diffuse near-ink interfaces may merge; a transitive merge
cannot erase a sharp interface or exceed the bounded color span. Up to two
structure-loss feedback rounds restore evidenced spatial cores, not merely a
color somewhere in the frame. Up to eight missing-ink proposals require a
continuous sharply bounded mark with a supported surround; one exact outlier
alone is insufficient. No palette numbering supplies confidence. Reference
palettes are not silently augmented. All effective parameters, comparisons and
feedback are persisted in the design descriptor and independently replayed.

`practical-visible-exterior-residue/2` separately considers tiny external residue
from visible local boundary samples. An isolated matching RGB sample elsewhere
does not prove a supported material color: that veto requires a coherent 2x2
interior patch. Existing body, extended-detail, alpha-hole and independent-motif
guards remain. RGB under alpha zero is never evidence. This cleanup is a derived
proposal, never a human-confirmed foreground. Remaining ambiguous details and
known poor visual results must be reported separately from geometric validity.
# 单色制作步骤与覆盖优先增量（显式启用）

`--quality-mode practical-auto --fabrication-policy monochrome-supported-cover/1`
启用统一单色制作步骤和有界凹口覆盖比较；不改变未指定该参数的默认路径、
选区 V2、冻结核或任何正式分支。对已生成、可独立复核的 practical layered
结果可执行：

```powershell
python benchmarks/fabrication-layer-decomposition/algorithm-v1/monochrome_runtime.py --source-run OLD_RUN --output NEW_EMPTY_OUTPUT
```

该入口复制已有 M4 产物到新目录，复核原输入、设计回放、Component 双射、
共享边和原实际裁片。已有实际完整片作为同设计保底，不信任缓存 PASS；
新候选仍走共享合同、落盘独立回读和重绘。原证据只读，不能把旧目录作为输出。

每个制作步骤仅一个精确 ColorSlot，可包含多块实际完整几何互不叠压的裁片。
实际遮挡依赖优先，同色可在后续步骤再出现。`monochrome-policy.json` 被结果
输入的 artifact SHA 绑定，回读时从完整几何重算，而不是仅校验哈希。
`monochromeWorkLayerCount` 是单色制作步骤数；`actualGeometricOverlapDepth`
是具有正面积的同一位置最多覆盖的完整裁片数；`occlusionDependencyDepth`
另记依赖最长链，不能混称物理深度。仅改变步骤分组不增加材料。

比较保留所有合法候选，先通过可见颜色、域、来源、隐藏覆盖、透明洞及接缝
硬门禁，再依碎片风险、实际外露同色切缝＋异色拼边、零件及材料负担比较。
不同色的可见相邻边仅在两片完整几何都止于该边时才计为拼边；覆盖边不是拼边。
这些量是实验性装配负担代理，不是人工制作质量真值。

新凹口候选仅沿现有相邻前景域补全：邻片超过半周长贴着拟补全下片、补全缩短
下片轮廓、总隐藏面积不超过其可见支撑面积；不得新增透明域材料、孔洞、细桥、
零件或无用隐藏片。每轮最多六次候选验证，每个既有方案只增加一次局部补全，
最多增加一级实际材料深度。失败保留已验证同设计保底。没有合适的覆盖候选仍
可能保留异色拼边，应在结果中披露，不能为了零拼边生成满铺底板。

输出 `work-layer-*.png` 为完整片逐步叠贴，`complete-pieces.svg` 紫色表示实际
隐藏材料。`monochromeFabrication` 同时列出每层颜色、片号、三个不同层数指标。
制造未评估、用户及独立审核仍待完成，生产导出不允许。

### 整图轮廓承托底板（独立显式规则）

原图公开入口 `algorithm_runtime.py --quality-mode practical-auto
--fabrication-policy whole-silhouette-base/1`，或已绑定选区入口：

```powershell
python benchmarks/fabrication-layer-decomposition/algorithm-v1/monochrome_runtime.py --source-run OLD_PRACTICAL_RUN --output NEW_EMPTY_OUTPUT --whole-silhouette-base
```

两个入口均可追加 `--base-color-slot EXISTING_SLOT_ID`；未指定则沿用实际有限
调色板、两种合法孔洞拆分方向及现有单色覆盖排序。已有方案的底板若已完整，
直接复用全部几何，不再加一层。旧默认、未启用该规则的单色路径保持原行为。

对更早模式的、已经完成 Component 绑定的选区可用
`whole_silhouette_runtime.py --m4-root SAVED_BOUND_M4 --output NEW_EMPTY_OUTPUT
--base-color-slot EXISTING_SLOT_ID`。此入口只消费保存选区，不再选择颜色或平滑；
仍从原输入独立回放设计作验证。未绑定旧产物不能自动获得新版 PASS。

规则以绑定后的全部选区几何并集 F 为目标；底板实际完整支撑域必须等于 F，
同时检验缺失域、额外域及边界，不采用凸包、包围框或填孔外环。连通无孔主体
必须单片；分离主体/真孔洞使用合法的底板组，绝不跨透明域连接。整个底板组
先于上层，单色制作步骤与真实材料叠压深度分列。

这是生成、候选筛选、独立落盘回读的硬要求，不允许评分选择缺支撑保底。
`fabrication-result.json` 的版本化 recipe 和 `wholeSilhouetteBase` 绑定所选
底色、实际完整/可见/推断隐藏域；回读从重新绑定的选区重算 F 和最低支撑，
不信任声明或缓存。外部要求该规则时，`verify_layered_result` 应指定
`required_base_rule=True` 及 `requested_base_color`，连删除规则声明也会拒绝。

仅明确承托底板免于局部补全隐藏/可见面积比例上限；上层复用现有补全或精确
可见域，未扩大上层授权。底板隐含的异色下方材料不是同色原始 Component 来源，
来源仍只绑定可见域。**现有 layered-result/1 禁止完全隐藏、没有可见来源的片**：
若某个分离主体完全不含指定底色，或孔洞拆分产生无可见来源的底板成员，候选
明确拒绝并记原因。不会偷偷修改合同、伪造来源、填洞或连接主体以取得 PASS。

新增 `whole-base.png` 为实际底板/底板组；展开图、隐藏域和每步叠贴均来自
独立核验后的完整裁片。几何及外观相等不是人工质量验收，仍停在审核候选。
# Whole-base / intermediate-completion integration

The opt-in `whole-silhouette-base/1` rule uses orchestration version
`whole-base-completion-integration/1`. Raw `algorithm_runtime.py`, bound-M4
`whole_silhouette_runtime.py`, and saved-result `monochrome_runtime.py` all call
the existing practical supervisor. A geometry-validated whole-support fallback
is checkpointed first; the existing bounded hole/bridge search (six proposals)
and concave-pocket cover search (six proposals) then run in its disposable worker.
The existing whole-run 420-second search deadline reserves 180 seconds for final
validation. Search failure retains only a compliant same-design whole base.

Completion candidates receive actual whole support and are revalidated before
cover-priority selection. Bottom-visible pieces of the chosen colour provide the
base's observed source; same-colour pieces above other material remain upstairs.
Fully hidden source-less base members, transparent bridges, filled true holes,
and unsupported layered contracts remain rejected. No selection, palette,
cleanup, frozen kernel, or default-path policy is changed.

`practical-baseline.json`, `practical-search.json`, child stderr/events, and
`practical-selection.json` preserve the fallback, proposal failures, deadline
outcome, and actual ranking. A legal whole base is not proof of useful middle
completion: regression tests separately require actual hidden middle material,
three/four-layer nesting, repeated base colours, and all three guarded entries.
