# M4 runtime reuse map

| Stage | Existing implementation called | Existing limitation | M4 adapter responsibility |
|---|---|---|---|
| Color proposal | `get_candidate("CP-B").propose` | Fixture runner enumerates FLD cases | Accept normalized caller foreground without fixture IDs |
| Representative color | `apply_representatives(..., "RC-A", ...)` and `metrics_for_run(..., ground_truth_approx_region_count=None)` | Existing runner assumes benchmark paths and optional GT | Preserve alpha, retain no-GT semantics, record provenance |
| Region/Core | `four_connected_components`, `perimeter_and_adjacency`, `void_topology` | Frozen contract builder only accepts FLD-001..008 | Build a separate runtime envelope without changing frozen objects |
| Shared boundaries | `build_boundary_graph` | Evidence runner reads frozen outputs | Supply this run's structural labels and effective alpha |
| Vector | existing `fit_chain`, `simplify_chain`, validation and fail-closed helpers | Evidence runner fixes cases/output directories | Apply the existing V2 → V1 → V0 ladder at 0.5 source px |
| Observed candidates | existing boundary graph component/ring identity rules | B2 V0 requires frozen Region Core evidence | Emit observed-only candidates with no final cut geometry or production eligibility |
| QC view | existing label/vector data | Existing reports are fixture-oriented | Render this run's input, output, labels, components, vectors, warnings and timing |

The runtime reads profile values from the existing color and vector configuration files. It does not select new algorithms, perform background removal, infer hidden contours, choose a base, infer layer order, or authorize manufacturing/export.

`m4_runtime.run_runtime(...)` is the only public processing entry. It normalizes caller input, validates output isolation, then calls the underscore-prefixed writer; the CLI uses the same API.
