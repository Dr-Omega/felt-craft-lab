import bigBackground from '../../../../assets/ui/explode-v2/大背景（放在最底层）.png'
import frameBackground from '../../../../assets/ui/explode-v2/背景01.png'
import frameBorder from '../../../../assets/ui/explode-v2/背景边框（放在第二高的顶层）.png'
import btnCheck from '../../../../assets/ui/explode-v2/对勾按钮02.png'
import btnCross from '../../../../assets/ui/explode-v2/叉号按钮03.png'
import btnNext from '../../../../assets/ui/explode-v2/下一页按钮04.png'
import btnBack from '../../../../assets/ui/explode-v2/返回键（放在最顶层）.png'

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
