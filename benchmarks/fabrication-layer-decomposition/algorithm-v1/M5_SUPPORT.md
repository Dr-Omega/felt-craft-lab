# M5 finite layered evidence v1

`layered_sources.parse_layered(path, selected_ids)` is a read-only parser. Pass
explicit object IDs, an SVG group ID, or `["*"]` to explicitly choose every
pixel object. No selection returns inspected evidence with `selectionStatus =
UNRESOLVED` and no normalized image. Background-like colors are never removed.
`PARTIAL`/`UNSUPPORTED` also return no image to the fabrication runtime; any
retained layers are diagnostic only. Source order is evidence, not assembly order.

Supported SVG: UTF-8 SVG-namespace root with integral width/height, viewBox (`none` or
default xMidYMid meet), groups, rect, circle, ellipse, polygon, explicitly closed
straight-line M/L/H/V/Z paths; affine matrix/translate/scale/rotate; inherited
solid named or hex RGB fill, nonzero/evenodd, fill-opacity, object opacity,
display and visibility. Raster normalization evaluates inverse-transformed pixel
centres (no antialiasing); ellipse membership is analytic. This finite sampling
rule is documented evidence normalization, not a claim to implement every SVG
renderer. Nested SVG viewports and root viewport transforms are explicitly
unsupported; supported affine transforms belong to groups or individual shapes.
Group opacity other than 1, curves, strokes, filters, gradients, masks,
clips, text, nested resources, CSS stylesheets and unknown attributes are rejected.
Scripts, DTD/entity declarations, image/use references and external stylesheets
are rejected. The parser reads only the provided file's bytes and has no resource
resolver; parsing cannot fetch external files or network resources.

Supported PSD: real PSD v1 RGB 8-bit documents with ordinary RGB(A) pixel layer
records, integer layer positions (including canvas clipping), visibility,
opacity, normal source-over blend, raw or PackBits RLE channels. Name and optional
native layer ID are retained. PSD groups, masks, special blending, clipped layers,
smart objects, effects, adjustments, color-management image resources and unknown
tagged information are detected and unsupported. Plain supported layers have
parentId null; grouped sources are not falsely flattened into supported evidence.
Merged preview is checked for structural presence but never used instead of layer
channel data. PSD channel samples are interpreted as unprofiled RGB; files carrying
color profiles are outside this finite scope.

No parsing dependency was added: Python standard library, existing NumPy and
Pillow provide binary/XML parsing, arrays and color literals. Implementation was
checked against [Adobe's official PSD file format specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)
and [W3C SVG 2 fill rules](https://www.w3.org/TR/SVG2/painting.html).
Finite bounds: 32 MiB input, 4 million canvas pixels, 256 source objects,
16 million aggregate layer pixels (native bounds and normalized canvases).

Evidence includes exact source SHA/length, source IDs and parents, bottom-to-top
order, native bounds and accumulated source-to-analysis transform, visibility,
opacity, canvas RGBA and alpha mask per object. `opaqueVisibleMask` and the
`opaqueOwnerIndex` array describe only uniquely opaque visible pixels after the
explicit selection. Blended pixels have owner -1; they cannot prove opaque
occlusion. The selected normalized raster receives a SHA of its RGBA bytes.
Consumers must restrict overlap reasoning to selected layers and supported status.
Fractional source opacity/fill-opacity never establishes an opaque owner even
when 8-bit normalization rounds its effective alpha to 255.
`sourceBytes` is the exact in-memory source snapshot that was parsed; orchestration
must persist this snapshot rather than reread a potentially changed source path.
Exclude bytes and NumPy arrays from JSON and persist them as separate artifacts.

`generate_layered_examples.py OUTPUT` writes legal synthetic DEVELOPMENT SVG and
PSD files with matching red-back/blue-front rectangles, plus rejected filter and
special-blend samples. These are not project-real layered artwork, GT or human
signed evidence. Tests independently open the PSD preview with Pillow and compare
the separately decoded layer composition against known pixels and the SVG.
