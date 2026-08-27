# P0-04B Region Core Freeze Candidate

Status: `IMPLEMENTATION_COMPLETE` / `FREEZE_CANDIDATE` / `BLOCKED_DATA_G02_SHADOW`.

This sidecar does not modify the frozen B0 manifest, schemas, fixtures, ground truth, B1 raw maps, or any production code. CP-B is the sole Region Core route; CP-A remains only an existing baseline.

## Gate 1 — Representative Color

External review status: `APPROVED`. The Region Core representative method is frozen to `RC-A`; RC-B, RC-C, and RC-D remain benchmark-only and are rejected as Production-selectable alternatives. The full post-decision deterministic validation is `PASS` across 2,937 regions with three independent RC-A evaluations per region and no byte mismatch.

## Gate 2 — Region Repair

V1 external review status: `REJECT_CURRENT_POLICIES`. The corrected V2 evidence uses fixed, semantically named thresholds and separate `COHERENT_SPLIT_REPAIR` and `TINY_FRAGMENT_REPAIR` routes. It also replaces the ambiguous area-normalized shared-boundary field with bounded `sharedBoundaryCoverage`. V2 status is `PENDING_EXTERNAL_GATE_2_REVIEW_V2`; Repair Apply remains `NOT_EXECUTED`.

See `GATE_2_REVIEW_PACKET_V2.md` for the synthetic direct-edge evidence, project-real adjacent-edge review candidates, complete SAFE/PRESERVE lists, and policy-level results.

## Blocking evidence

The frozen project fixtures do not contain project-real `G02_AI_COLOR_DRIFT` or `INTENTIONAL_SHADOW` evidence. The synthetic RCF-001 and RCF-002 regressions validate mechanics only. Therefore this work must not be labelled `FROZEN` until those project-real sources, relation GT, and human review are supplied.
