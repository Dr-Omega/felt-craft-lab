# Latest dismantling UI, supplied locally

Source: user-supplied `C:/Users/1/OneDrive/Desktop/拆分页/` (2026-10-01).
These are unchanged 1920×1080 exports, not the older GitHub dismantling design.

| Local file | Original filename |
| --- | --- |
| background-01.png | 大背景01.png |
| background-02.png | 背景02.png |
| background-03.png | 背景03.png |
| background-04.png | 背景04.png |
| panel-05.png | 弹窗05.png |
| layer-06.png | 弹窗里面的弹窗（用来显示拆分）06.png |
| border-07.png | 背景边框07.png |
| back.png | 返回键（放在最顶层）.png |

Background exports are retained as source material but NOT rendered in the
current in-canvas editing workflow. Only panel-05 and layer-06 are used. The
canvas-range guide is documentation only and is never displayed. The movable
panel is explicitly exempt from its original page position per the user's
clarification: choose left/right based on the selected element and viewport.
SVG viewBoxes expose the measured panel/thumbnail/button bounds without changing
PNG bytes. Decorations have no pointer events; full-canvas transparent padding
is never a full-screen clickable button.
