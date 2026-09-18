# M0 — original B2 V0 protection

Date: 2026-09-18. Scope: preserve and audit an existing candidate, not declare a production freeze.

- Worktree: `felt-craft-lab-b2`; branch: `feature/fabrication-layer-decomposition/b2-fabrication-decomposition`.
- Starting HEAD: `90a92ae1853ce07308238a70f9301fa148821b66`.
- P0-04C: `4dc782343fbf02836d9cf36a8bd42975eec41d2f`.
- Original snapshot: `cbf278cbc31a6b79ddda7c56408830698712303a`, local ref `refs/tags/b2-v0-original-bytes-m0`.
- 167 previously untracked files, 96,565,881 bytes. Every original file has raw SHA-256, raw Git blob ID and byte length in `evidence/m0-original-bytes.json`.
- 669 pre-existing tracked benchmark files have independently recorded raw SHA-256 values in the same manifest.
- Snapshot creation used raw `hash-object --no-filters`, an isolated index, `commit-tree`, then a protected ref. Normal index and HEAD were unchanged. Every stored blob was read back and compared with original bytes.
- No clean, reset, recomputation of frozen geometry, or modification of original V0 output was used.

## Candidate disposition

| Existing content | Disposition |
|---|---|
| Frozen Region Core / P0-04C | Preserve byte-for-byte; consume provenance, never modify for B2 |
| V0 observed geometry / directed-edge provenance / deterministic fixtures | Retain as benchmark candidate and reference adapter input |
| V0 `unspecifiedRelation=NO_RELATION` | Legacy only; runtime missing relations are `NOT_EVALUATED` |
| V0 observed geometry copied into finalCutGeometry | Observed-only evidence, **not** proof of solid or manufacturable pieces |
| V0 raw text hashes | Preserve original identity; add explicit LF-canonical identities for new derived runtime artifacts |
| V0 FLD-001..008 builder | Benchmark-only; runtime input cannot call fixture-specific builder |
| GT review packs and ZIPs | Preserve original bytes; unanswered predictions are not reviewed/signed GT |

## Checks

The original Region Core freeze validator, P0-04C freeze validator and B2 V0 validator are run without rebuilding outputs. Detailed M1 verification is recorded separately. `node scripts/verify-b2-v0-preservation.mjs` checks both original V0 bytes and all 669 upstream bytes in this worktree.

The protected commit and manifest permit recovery even if the local tag is not transferred: each original blob is also added unchanged to the ordinary implementation branch by the M0 commit. Do not re-run the one-time preservation creator after the baseline advances. This report does not claim remote publication of new implementation commits.
