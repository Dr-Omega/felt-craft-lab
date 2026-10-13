import rolePanel from '../../../../assets/ui/supplied-controls/role-panel.png'
import child from '../../../../assets/ui/supplied-controls/role-child.png'
import parent from '../../../../assets/ui/supplied-controls/role-parent.png'
import artTeacher from '../../../../assets/ui/supplied-controls/role-art-teacher.png'
import chineseTeacher from '../../../../assets/ui/supplied-controls/role-chinese-teacher.png'
import qaPanel from '../../../../assets/ui/supplied-controls/qa-panel.png'
import qaUser from '../../../../assets/ui/supplied-controls/qa-user.png'
import qaAssistant from '../../../../assets/ui/supplied-controls/qa-assistant.png'
import qaInput from '../../../../assets/ui/supplied-controls/qa-input.png'
import qaVoice from '../../../../assets/ui/supplied-controls/qa-voice.png'
import qaEntry from '../../../../assets/ui/supplied-controls/qa-entry.png'
import materialPanel from '../../../../assets/ui/supplied-controls/material-panel.png'
export const suppliedArt = { rolePanel, qaPanel, qaUser, qaAssistant, qaInput, qaVoice, qaEntry, materialPanel }
// Measured alpha bounds of the unchanged source PNGs, in the shared PSD coordinate system.
export const suppliedRoles = [
  { value: 'child', label: '学生', image: child, bounds: [774, 440, 398, 87] },
  { value: 'parent', label: '家长', image: parent, bounds: [774, 554, 398, 87] },
  { value: 'art_teacher', label: '美术老师', image: artTeacher, bounds: [774, 662, 398, 87] },
  { value: 'chinese_teacher', label: '语文老师', image: chineseTeacher, bounds: [774, 766, 398, 87] }
] as const
export function sourceBox(bounds: readonly number[]): Record<string, string> {
  const [x, y, width, height] = bounds
  return { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }
}
