# M4–M7 algorithm V1 integration batch

Task base: bd375d0f2c4c5d9fbe64a603af4132f23ef14388.
Branch: audit/fabrication-m4-m7-algorithm-v1.

| Module | Reused implementation | New adapter / output |
|---|---|---|
| M4 | CP-B, RC-A, existing aggressive/balanced profiles, Region Core 4-components, selected V2→V1→V0 edges | independent alpha/label check; snapshot provenance; actual selected-edge polygons/preview; M1 input |
| M5 | Pillow/NumPy, Python standard XML and binary readers | finite SVG and PSD layer evidence, explicit selection, retained unsupported features |
| M6 | actual shared geometry plus selected source-layer alpha | Region visual evidence then final Piece support/independence partial graph |
| M7 | selected-vector directed rings; GEOS polygon operations | finite Base alternatives, conservative visible domains, hole splitting, explicit seams, conservation and comparison |
| Integration | actual b2.input/1, b2.result/1 and b2.structure/1 shared validators | independent final artifact geometry rendering, pending review assessment, diagnostic CLI/page |

New strategy choices belong to this experimental batch, not previous approval.
Polygon operations use Shapely 2.1.2 (BSD-3-Clause), GEOS (LGPL-2.1).
Official sources checked: https://shapely.readthedocs.io/en/2.1.2/ and
https://shapely.readthedocs.io/en/latest/installation.html .
Selected curves are flattened by the existing P0-04C validationFlatnessPx rule,
with exact selected segments and directed references retained as provenance.
M7 conservation is measured against that fixed selected-vector polyline domain;
it receives no additional permission to move boundaries or fill global holes.

The existing backend image_postprocess alpha issue and M8 physical-size floating
point issue are out-of-scope observations. This batch's explicit foreground path
does not depend on either. M8–M11, millimetre assessment and production export are
not implemented. Human quality is pending; no artificial GT or signature.

All original frozen inputs/code/evidence and R4 worktrees are read-only.
