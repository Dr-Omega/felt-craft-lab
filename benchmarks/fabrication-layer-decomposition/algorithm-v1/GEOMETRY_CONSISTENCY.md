# Geometry consistency increment

Base: `9e9fe5b493422e16a6d9b18ad29a501ed0c56a72`.

This change is confined to the opt-in layered construction. The legacy solid
planner, all upstream selected domains and all frozen kernels are unchanged.

`coverage_geometry.ordered_coverage` derives positive-area occluders and hidden
material from the same pairwise intersections of actual full pieces. An unrelated
upper union is no longer a new source of occlusion. Empty overlap preserves the
full visible polygon exactly. No positive polygon is removed by an area cutoff.
Generation and persisted validation use this pure operation; the reader still
reconstructs from stored full pieces and actual source artifacts, and compares
stored visible/hidden declarations without repairing them.

`vertex_partition.partition` retains an axis partition only if its cells are
contained, disjoint and reconstruct the exact original domain. Otherwise it
uses constrained-triangulation diagonals as a local common partition: two
inherited-vertex cuts connect a hole to the shell. Shared cuts use the very same
endpoints. There is no grid rounding, source-point movement, new contour fit,
epsilon-area deletion or replacement of the original foreground union. Every
constructed partition must reconstruct its parent topologically. Failure is a
rejection, not repaired external input. This constructor is not called by the
persisted validator. Its bounded process-local cache stores pure partitions,
keyed by the complete immutable polygon and axis, never a contract PASS.

Tests use analytic tiny overlap, true hole, narrow gap and point/line contacts;
inherited slanted ring vertices; and explicitly injected historical axis/union
artifacts. Previously rejected malformed declarations remain rejected after a
forged completion hypothesis. Existing rehashed source/order/hidden/seam and
missing whole-backing tests remain part of regression.

Real experiment: the user JPEG's saved 96-domain M4 is byte-preserved. The new
constructor's six source-colour complements are exactly equal (symmetric
difference and boundary distance zero), versus remote thin residual faces in
both old axis routes. The public saved-M4 run completes persisted validation
and independent rendering (49 pieces, 17 micro-pieces, 8 monochrome work steps,
physical depth 3, zero render difference). These figures are geometry evidence,
not a good fabrication design. Some optional completion proposals still reject
at visible/hidden consistency; their reasons are retained rather than waived.

Raw experiment logs and all outputs live in the separate `geometry-color-evidence`
delivery, not in frozen evidence. Full gates and clean reproduction are reported
there with actual commit identities. User acceptance and independent review
remain pending; manufacturing is not evaluated; production export is disabled.
