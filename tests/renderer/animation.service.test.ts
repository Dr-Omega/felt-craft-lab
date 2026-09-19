import { describe, expect, it, vi } from 'vitest'

vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: vi.fn()
  }
}))

import lottie from 'lottie-web'
import { DEFAULT_LOTTIE_MAP, LottieAnimationService } from '../../src/renderer/src/services/animation.service'

describe('LottieAnimationService', () => {
  it('ships with empty production default map (no remote LottieFiles)', () => {
    expect(DEFAULT_LOTTIE_MAP).toEqual({})
    expect(Object.keys(DEFAULT_LOTTIE_MAP)).toHaveLength(0)
  })

  it('no-ops unknown eventKey without loading remote assets', async () => {
    const service = new LottieAnimationService()
    await service.play('collect')
    expect(lottie.loadAnimation).not.toHaveBeenCalled()
  })
})
