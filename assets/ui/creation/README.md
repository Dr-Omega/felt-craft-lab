# Creation controls — supplied artwork

Original 1920×1080 transparent PNGs; render their painted bounds, do not stretch or repaint button text.

From user `ui (3)(1).zip`, `绘画页/`:
- choose.png: 请选择弹窗05.png
- upload.png: 直接上传图片按钮06.png
- voice.png: 语音输入按钮07.png
- voice-panel.png: 按住发言弹窗08.png
- voice-text.png: 按住发言文本框09.png (rendered at source bounds 638,459,664,333 inside the original panel)
- hold-talk.png: 按住发言按钮10.png (retained source, replaced by explicit recording controls)

From user `补充ui.zip`:
- record-start.png: 开始录音02.png
- record-pause.png: 暂停录音03.png
- record-resume.png: 继续录音06.png
- record-done.png: 完成录音04.png
- record-reset.png: 重新录音05.png

Only reusable recording controls are wired here. Story-card confirmation assets are outside creation Steps 1–2 and are not claimed implemented.

Creation confirmation/retry actions use the existing blank hand-drawn `btn-primary.png`
with live text. These labels and their action row are functional adaptations, not
claims of a supplied finished design. Send uses the existing `btn-send.png` artwork.
The source panel and input frame keep their original shared coordinate system.
