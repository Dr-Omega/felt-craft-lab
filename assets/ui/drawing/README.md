# Drawing frame exports

Source: user-provided `ui (3)(1).zip`, `ui/绘画页/`. Original PNG bytes and
1920×1080 transparent padding are retained. Uniform artwork scaling surrounds
the existing logical Canvas; interactive controls use measured painted bounds.

| File | Original export |
| --- | --- |
| background.png | 大背景（放在最底层）.png |
| board.png | 蘑菇画板01.png |
| border.png | 背景边框（放在第二高的顶层）.png |
| back.png | 返回键（放在最顶层）.png |
| undo.png | 上一步按钮03.png |
| redo.png | 下一步按钮02.png |
| save.png | 保存按钮04.png |

Decorations ignore pointer events. Editing a layer opens a movable panel over
the original drawing, not a separate background or recoloring page.
