# Region Core Freeze Reproducibility Repair

Status: `REGION_CORE_FREEZE_REPRODUCIBILITY_REPAIRED`

## R1 — clean-checkout import failure

The original freeze test run imported `representative_details` from an uncommitted change in the source worktree. The frozen commit therefore omitted a deterministic diagnostic interface used by the full Region Core suite, the RC-A determinism validator, and the representative-color benchmark.

The repair adds only that diagnostic wrapper and the existing benchmark-only RC-D medoid branch it exercises. CP-B proposal code is unchanged. Region Core continues to accept only RC-A as its Frozen representative method; RC-B, RC-C, and RC-D remain Benchmark-only.

## R2 — checkout-dependent artifact identity

The original Region Core freeze recorded `Path.stat().st_size` and raw working-tree SHA-256 values. On Windows those values included CRLF checkout conversion, while Git stored canonical LF blobs. A clean checkout with a different `core.autocrlf` policy could therefore invalidate unchanged artifacts.

The repaired identity contract is:

- tracked repository text (`.json`, `.md`, `.py`, `.txt`): `GIT_BLOB_CANONICAL_LF`;
- binary artifacts (`.png`, `.npz`, `.gz`, and other suffixes): `EXACT_BYTES`;
- checkout CRLF/LF representation never changes tracked-text identity.

Every artifact record now declares its identity mode. Region Core size and SHA validation use the same canonical bytes. P0-04C evidence hashing uses the same text canonicalization so its frozen validator is also checkout-independent.

## Frozen-data audit

The repair does not rerun CP-B or vectorization. It does not alter structural or pixel label maps, legacy region records, purified rasters, fixture/GT files, or P0-04C outputs.

- Protected artifact count: 272
- Protected artifact aggregate before: `63bd3eb6b33fc80d6f7e23e9e96642b77a188fff0308c0e9e02f68f213e43b9e`
- Protected artifact aggregate after: `63bd3eb6b33fc80d6f7e23e9e96642b77a188fff0308c0e9e02f68f213e43b9e`
- Primary Regions: 707
- Primary 4-connected components: 1180
- Region/component/adjacency/topology payloads: unchanged

Production integration remains `NOT_INTEGRATED`. Region Repair remains rejected as a Production approach. B2 and B2-V1 are outside this repair.
