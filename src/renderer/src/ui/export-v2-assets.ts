import bigBackground from '../../../../assets/ui/export-v2/大背景（放在最底层）.png'
import projectionFrame from '../../../../assets/ui/export-v2/投影屏01.png'
import frameBorder from '../../../../assets/ui/export-v2/背景边框（放在第二高的顶层）.png'
import btnExport from '../../../../assets/ui/export-v2/导出按钮02.png'
import btnFinish from '../../../../assets/ui/export-v2/完成作品按钮03.png'
import exportModal from '../../../../assets/ui/export-v2/导出弹窗04.png'
import btnSpecific from '../../../../assets/ui/export-v2/导出弹窗“具体”按钮05.png'
import btnOptional from '../../../../assets/ui/export-v2/导出弹窗“可选”按钮06.png'
import textField from '../../../../assets/ui/export-v2/导出弹窗里的文本框07.png'
import btnBack from '../../../../assets/ui/export-v2/返回键（放在最顶层）.png'

export const exportV2Assets = {
  bigBackground,
  projectionFrame,
  frameBorder,
  btnExport,
  btnFinish,
  exportModal,
  btnSpecific,
  btnOptional,
  textField,
  btnBack
} as const

export const exportV2HitAreas = {
  back: { left: 39, top: 35, width: 208, height: 112 },
  exportToggle: { left: 1726, top: 431, width: 117, height: 216 },
  finish: { left: 956, top: 938, width: 375, height: 122 },
  modalSpecific: { left: 703, top: 517, width: 150, height: 91 },
  modalOptional: { left: 844, top: 517, width: 150, height: 91 },
  modalField: { left: 701, top: 603, width: 584, height: 199 },
  modalConfirm: { left: 900, top: 808, width: 240, height: 64 }
} as const
