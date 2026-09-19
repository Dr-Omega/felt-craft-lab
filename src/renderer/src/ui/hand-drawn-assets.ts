import manifest from '../../../../assets/ui/hand-drawn/manifest.json'
import btnPrimaryUrl from '../../../../assets/ui/hand-drawn/btn-primary.png'
import btnSecondaryUrl from '../../../../assets/ui/hand-drawn/btn-secondary.png'
import btnCloseUrl from '../../../../assets/ui/hand-drawn/btn-close.png'
import btnRoundUndoUrl from '../../../../assets/ui/hand-drawn/btn-round-undo.png'
import btnRoundRedoUrl from '../../../../assets/ui/hand-drawn/btn-round-redo.png'
import btnRoundMaterialUrl from '../../../../assets/ui/hand-drawn/btn-round-material.png'
import btnBackUrl from '../../../../assets/ui/hand-drawn/btn-back.png'
import textBoxUrl from '../../../../assets/ui/hand-drawn/text-box.png'
import textBoxSmallUrl from '../../../../assets/ui/hand-drawn/text-box-small.png'
import materialSheetBgUrl from '../../../../assets/ui/hand-drawn/material-sheet-bg.png'
import backgroundTriggerUrl from '../../../../assets/ui/hand-drawn/background-trigger.png'
import inputFieldUrl from '../../../../assets/ui/hand-drawn/input-field.png'
import qaPanelBgUrl from '../../../../assets/ui/hand-drawn/qa-panel-bg.png'
import qaInputFieldUrl from '../../../../assets/ui/hand-drawn/qa-input-field.png'
import qaBubbleQuestionUrl from '../../../../assets/ui/hand-drawn/qa-bubble-question.png'
import btnSendUrl from '../../../../assets/ui/hand-drawn/btn-send.png'
import btnVoiceUrl from '../../../../assets/ui/hand-drawn/btn-voice.png'

export const handDrawnAssets = {
  btnPrimary: btnPrimaryUrl,
  btnSecondary: btnSecondaryUrl,
  btnClose: btnCloseUrl,
  btnRoundUndo: btnRoundUndoUrl,
  btnRoundRedo: btnRoundRedoUrl,
  btnRoundMaterial: btnRoundMaterialUrl,
  btnBack: btnBackUrl,
  textBox: textBoxUrl,
  textBoxSmall: textBoxSmallUrl,
  materialSheetBg: materialSheetBgUrl,
  backgroundTrigger: backgroundTriggerUrl,
  inputField: inputFieldUrl,
  qaPanelBg: qaPanelBgUrl,
  qaInputField: qaInputFieldUrl,
  qaBubbleQuestion: qaBubbleQuestionUrl,
  btnSend: btnSendUrl,
  btnVoice: btnVoiceUrl
} as const

type HandDrawnEntry = {
  slug: string
  borderSlice?: number
}

function sliceFor(slug: string): number {
  const entry = manifest.assets.find((item) => item.slug === slug) as HandDrawnEntry | undefined
  if (!entry?.borderSlice) return 16
  return entry.borderSlice
}

/** Nine-slice border-image for stretchable hand-drawn panels and buttons. */
export function handDrawnBorderImage(url: string, slug: string): Record<string, string> {
  const slice = sliceFor(slug)
  const borderWidth = Math.max(10, Math.round(slice * 0.55))
  return {
    borderStyle: 'solid',
    borderWidth: `${borderWidth}px`,
    borderColor: 'transparent',
    borderImageSource: `url(${url})`,
    borderImageSlice: `${slice} fill`,
    borderImageWidth: `${borderWidth}px`,
    borderImageRepeat: 'stretch',
    background: 'transparent'
  }
}

export const handDrawnBorderStyles = {
  textBox: handDrawnBorderImage(handDrawnAssets.textBox, 'text-box'),
  textBoxSmall: handDrawnBorderImage(handDrawnAssets.textBoxSmall, 'text-box-small'),
  btnPrimary: handDrawnBorderImage(handDrawnAssets.btnPrimary, 'btn-primary'),
  btnSecondary: handDrawnBorderImage(handDrawnAssets.btnSecondary, 'btn-secondary'),
  inputField: handDrawnBorderImage(handDrawnAssets.inputField, 'input-field'),
  qaInputField: handDrawnBorderImage(handDrawnAssets.qaInputField, 'qa-input-field'),
  qaBubbleQuestion: handDrawnBorderImage(handDrawnAssets.qaBubbleQuestion, 'qa-bubble-question')
} as const
