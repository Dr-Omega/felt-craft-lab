import type { PersonalAssetRole } from '../contracts/personal-asset'
import type { CommonStyleConstraints, RoleConstraints } from '../contracts/generation-spec'

/** Frozen phrase table. Compiler may only look up; it must never invent style prose. */
export const FELT_STYLE_PHRASES: Record<keyof CommonStyleConstraints, string> = {
  renderStyle: '简单可爱卡通平面大色块',
  perspective: '正面低透视',
  texture: '无纹理无毛发质感',
  gradient: '少渐变',
  outline: '清晰外轮廓无线条描边',
  shapeComplexity: '结构极简可剪不织布',
  occlusion: '少遮挡',
  paletteComplexity: '颜色种类少',
  tinyDetails: '少细碎细节',
  sameColorContinuity: '同色尽量连续成片',
  background: '浅灰干净纯色背景（不要纯白，便于抠图并保留白色主体）'
}

export const BASE_NEGATIVE_PHRASES = [
  '写实照片',
  '真实毛发',
  '复杂纹理',
  '强透视',
  '细碎碎片',
  '高细节噪点',
  '文字水印',
  '3D渲染',
  '复杂背景',
  '风景场景',
  '渐变背景',
  '纯白背景吞没白色主体',
  '阴影体积光',
  '超精细图案',
  '真人脸'
] as const

const ROLE_PHRASE_SETS: Record<PersonalAssetRole, string[]> = {
  core_pattern: ['主体完整成组', '儿童贴纸风', '结构简化', '少遮挡', '适合剪成不织布核心图案'],
  element: ['独立可摆放单元', '易分离背景', '不要无关杂物', '结构简化'],
  background: ['满幅场景', '可含场景物件', '预留前景空间', '视觉密度适中']
}

export function stylePhraseList(_style: CommonStyleConstraints): string[] {
  return (Object.keys(FELT_STYLE_PHRASES) as Array<keyof CommonStyleConstraints>).map(
    (key) => FELT_STYLE_PHRASES[key]
  )
}

export function rolePhraseList(role: PersonalAssetRole, _constraints: RoleConstraints): string[] {
  return [...ROLE_PHRASE_SETS[role]]
}
