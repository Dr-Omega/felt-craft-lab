import { createBlankScene } from '../catalog/ywn-catalog'
import { getAppView, openEditor, openLearning, openLobby, openPersonalWorks, openPlaza, openRewards } from '../app-nav'
import type { OnboardingStep } from './onboarding-steps'

export const ONBOARDING_PREPARE_EVENT = 'felt-onboarding-prepare'

/** Navigate only among current child-facing pages. Never open the retired mixed library or maintenance tools. */
export function navigateForOnboardingStep(step: OnboardingStep): void {
  if (step.view === 'lobby') { openLobby(); return }
  if (step.view === 'editor') {
    if (getAppView() !== 'editor') openEditor({ mode: 'new', scene: createBlankScene('指引体验作品'), returnTo: 'lobby' })
    return
  }
  if (step.view === 'plaza') { openPlaza(); return }
  if (step.view === 'learning') { openLearning(); return }
  if (step.view === 'rewards') { openRewards('bear'); return }
  if (step.view === 'profile') {
    openPersonalWorks(step.id === 'profile-story' ? 'story' : 'completed')
    // Initial state is read on mount; this also updates the already-mounted profile on the following step.
    queueMicrotask(() => window.dispatchEvent(new Event(ONBOARDING_PREPARE_EVENT)))
  }
}
