import bigBackground from '../../../../assets/ui/export-v2/big-background.png'
import projectionFrame from '../../../../assets/ui/export-v2/projection-frame.png'
import frameBorder from '../../../../assets/ui/export-v2/frame-border.png'
import btnExport from '../../../../assets/ui/export-v2/btn-export.png'
import btnFinish from '../../../../assets/ui/export-v2/btn-finish.png'
import exportModal from '../../../../assets/ui/export-v2/export-modal.png'
import btnSpecific from '../../../../assets/ui/export-v2/btn-modal-specific.png'
import btnOptional from '../../../../assets/ui/export-v2/btn-modal-optional.png'
import textField from '../../../../assets/ui/export-v2/modal-text-field.png'
import btnBack from '../../../../assets/ui/export-v2/btn-back.png'

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
  modalConfirm: { left: 870, top: 798, width: 300, height: 84 }
} as const
