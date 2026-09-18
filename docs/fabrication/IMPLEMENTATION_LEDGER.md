# B2 implementation ledger

Approved product decisions: asset-level fabrication; authoring layers are evidence, not fabrication truth; frozen upstream remains immutable; CPU-first remote Python/Flask with Electron client; no paid mandatory inference fallback; no hidden ordinary-piece underlap; no free polygon editor.

## Required contract corrections

1. Canonical FabricationResult is size-independent. Structural assessment and ManufacturingAssessment are separate versioned records. A result may have many size/profile-specific assessments. Formal SVG/PDF export requires structural PASS and matching current-size manufacturing PASS, not image acceptance.
2. RelationRecord carries explicit fabrication impact and evidence. UNRESOLVED can be BLOCKING or NON_BLOCKING. Absence is NOT_EVALUATED, never implicit NO_RELATION.
3. Coordinate frames and affine transforms distinguish source-native, analysis-raster, fabrication-canonical and physical-mm. PSD/SVG native origins/viewBox, pixel conventions, P0-04C coordinates and physical dimensions remain traceable.
4. Solid splitting records introduced seam count and canonical length. Each manufacturing assessment measures them at its physical scale and includes reviewed seam acceptability. Mathematical coverage alone cannot pass fabrication.

## Milestones and dependencies

| Milestone | Scope / exit evidence | State |
|---|---|---|
| M0 | Protect exact original V0 bytes, retain/correct audit, rerun frozen validators | Protected; verification recorded in M0/M1 reports |
| M1 | Versioned runtime contracts, portable identity, coordinates, explicit relations, canonical/size split, seam metrics, lifecycle and rejection tests | In progress |
| M2 | Team-supplied G02, skin/layered sources, GT versions, reviewer/signature chain; prediction != GT | Pending |
| M3 | Background removal input and evidence adapter; preserve source versions | Pending |
| M4 | CP / semantic gate and frozen Region/Vector runtime adapter; exact ColorSlot identity | Pending |
| M5 | PSD/SVG originals and normalized evidence; unsupported/partial fail-closed; transform provenance | Pending |
| M6 | Visual partial graph, explicit unresolved impact, evidence-based assembly conversion | Pending |
| M7 | Base exposures, conservative solid splitting, seam accounting/review; frozen boundary/global void preservation | Pending |
| M8 | Physical size/profile calibration, independent manufacturing assessments, fail-closed SVG/PDF export | Pending |
| M9 | Remote computation and versioned artifact storage; extend resource contracts without overloading source.png | Pending |
| M10 | Structured user review and independent fabrication lifecycle; current-size gating in export UI | Pending |
| M11 | Signed GT, actual fabrication review, latency/memory benchmark, regression and production freeze | Pending |

No millimetre threshold, SLA, production geometry algorithm or production release is frozen by M1. Existing `sourceImageRef -> source.png`, PersonalAsset versions, Scene z-order and image-acceptance behavior remain unchanged.
