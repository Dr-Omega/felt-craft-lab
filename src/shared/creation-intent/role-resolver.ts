import type { AssetRoleDecision } from '../contracts/generation-spec'
import type { PersonalAssetRole } from '../contracts/personal-asset'

const BACKGROUND_HINT = /背景|庭院|夜空|场景画|整张画布|底图/
const ELEMENT_HINT = /可以自己摆|独立|贴纸|装饰元素|单独的|摆上去/
const SCENE_AMBIGUITY = /场景|画面|中秋|故事/

export function lockAssetRole(role: PersonalAssetRole): AssetRoleDecision {
  return { role, confidence: 'high' }
}

/**
 * Deterministic first-pass role hint for the unified text entry.
 * LLM may later propose a candidate, but this function (not the model)
 * decides whether the flow can continue without asking.
 */
export function resolveAssetRoleFromText(text: string): AssetRoleDecision {
  const value = text.trim()
  if (!value) {
    return { role: null, confidence: 'low', ambiguityReason: 'empty' }
  }

  const wantsBackground = BACKGROUND_HINT.test(value)
  const wantsElement = ELEMENT_HINT.test(value)

  if (wantsBackground && !wantsElement) {
    return { role: 'background', confidence: 'high' }
  }
  if (wantsElement && !wantsBackground) {
    return { role: 'element', confidence: 'high' }
  }
  if (wantsBackground && wantsElement) {
    return { role: null, confidence: 'low', ambiguityReason: 'role_conflict' }
  }
  if (SCENE_AMBIGUITY.test(value) && !/兔子|灯笼|月饼|熊猫|荷花/.test(value)) {
    return { role: null, confidence: 'low', ambiguityReason: 'scene_or_subject' }
  }

  return { role: 'core_pattern', confidence: 'medium' }
}
