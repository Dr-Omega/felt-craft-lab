import bigBackground from '../../../../assets/ui/explode-v2/big-background.png'
import frameBackground from '../../../../assets/ui/explode-v2/frame-background.png'
import frameBorder from '../../../../assets/ui/explode-v2/frame-border.png'
import btnCheck from '../../../../assets/ui/explode-v2/btn-check.png'
import btnCross from '../../../../assets/ui/explode-v2/btn-cross.png'
import btnNext from '../../../../assets/ui/explode-v2/btn-next.png'
import btnBack from '../../../../assets/ui/explode-v2/btn-back.png'

export const explodeV2Assets = {
  bigBackground,
  frameBackground,
  frameBorder,
  btnCheck,
  btnCross,
  btnNext,
  btnBack
} as const

export const explodeV2HitAreas = {
  back: { left: 39, top: 35, width: 208, height: 112 },
  next: { left: 49, top: 354, width: 150, height: 263 },
  check: { left: 1753, top: 511, width: 91, height: 92 },
  cross: { left: 1753, top: 624, width: 91, height: 92 }
} as const
