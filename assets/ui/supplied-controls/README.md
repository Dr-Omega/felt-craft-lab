# Supplied UI controls — original placement

Exact, unchanged 1920×1080 PNG exports from the user-provided ZIPs.
`manifest.json` records source archive/entry, SHA256 and measured alpha bounds
as [left, top, right, bottom]. These are artwork coordinates, not screen coordinates.

- Role selection: `选择ui(1).zip`; archive also in Git commit
  `269457d1d34b6833f170aaa2bdb95e3ac4eaf427`.
- Question panel, bubbles, input, voice and entry: `提问区.zip`.
- Material modal: `ui (3)(1).zip`, `ui/绘画页/素材框弹窗11.png`.

Use one 1920×1080 artboard transform for all layers. Hit targets sit at the
painted bounds; SVG viewBoxes only expose those same pixels, at their original
size and location. No layer has been cropped, repainted or independently scaled.
Conversation turns repeat the original bubble slots inside a scrollable viewport;
long message text scrolls inside the unchanged bubbles.

Source artwork does not supply every dynamic control: send/close, material
search/filter/add, change-role/cancel remain functional text controls. They are
not represented as approved artwork. SourceArtboard is transparent so the
underlying drawing/learning scene remains visible.

The separate creation voice text and supplemental start/pause/resume recording
assets describe different layouts: their original positions overlap when mixed.
They are not combined or repositioned by this change.
