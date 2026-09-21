# M4 / M5 to M1 input adapter

`m1_adapter.build_input(runtime_dir, layered_evidence=None)` creates a real
`b2.input/1` from the completed runtime's source snapshot, effective foreground,
purified RGBA, Region records, boundary graph and selected vector artifact.
It does not create any Piece, `solid` declaration, calibration or assessment.

Exact representative RGB values define `RGB-RRGGBB` ColorSlots. The adapter
does not use CP-B's experimental approximate color-group IDs as color identity.
The persisted `m1-palette.json` records each actual palette entry and source
Region IDs. Separate Regions with equal RGB share a color identity but retain
their own Region and Component identities and geometry.

`m1-geometry.json.objects[R00001]` retains the actual graph Component rings,
edge directions and selected vector edge segment objects for that Region.
The adapter rejects missing Region, Component or selected edge references.
Every geometry reference uses that actual artifact and object ID, with
`frameId=canonical`. Geometry reconstruction and geometric validity are checked
by the runtime and integrated algorithm, separately from wire validation.

Flat source, analysis, P0-04C and canonical frames retain the same canvas;
one canonical unit equals one source pixel. `m1-coordinates.json` documents
this identity mapping. A layered adapter supplies its native `sourceFrame`
(`bounds`, `matrixToAnalysis`, `sampleConvention`); SVG viewBox offsets/scales
are preserved. The affine map must keep the native canvas within the normalized
runtime raster, including the actual empty margins of SVG meet letterboxing.
Other rotated/sheared root frame contracts are rejected by
this initial adapter; object-local transforms remain in M5 evidence.

Layered evidence supplies `sourceArtifact={path,mediaType,sha256}` pointing at
the exact saved original snapshot, plus `status` and portable layer evidence.
Only the local locator is removed; exact original bytes, normalized layer
evidence, its native transform and source identity remain bound. Flat inputs
have `normalizedLayerEvidenceId=null`. New runtime artifacts never claim to
be frozen fixture acceptance evidence, despite legacy M1 field names
`frozenRegionArtifactId` / `frozenVectorArtifactId`.

`validateFabricationInput` is exported by the actual shared TypeScript
validator. Result validation calls that same validator and retains all prior
input rules, with nested error paths. RGB range and global Component identity
uniqueness are also enforced. Python `run_shared_validation(input=None,
result=None, assessment=None, sign_result=False)` compiles and calls these
shared validators; it does not approximate them in Python. With `sign_result`
it returns `signedResult` using the contract's JavaScript canonical number
serialization. Signing never implies validity: an empty Piece list still
fails. The caller should bind StructuralAssessment to the signed hash, then
validate the result and assessment together.

No dependency is installed automatically. Node and TypeScript are required;
set `TYPESCRIPT_TSC` to an existing `typescript/lib/tsc.js` if neither current
nor sibling checkout supplies it. Compiled validator JS is cached outside
the repository by exact validator-source digest. The bridge uses
`--noEmitOnError`; compilation failures remain failures.
