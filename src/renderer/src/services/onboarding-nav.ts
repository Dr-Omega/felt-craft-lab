import { listCatalogThemes } from '../catalog/ywn-catalog'
import { prepareNewWorkScene } from '../catalog/library-new-work'
import {
  openCreate,
  openEditor,
  openFabrication,
  openLearning,
  openLibrary,
  openLobby,
  openPersonalCenter,
  openPlaza,
  openRewards
} from '../app-nav'
import type { OnboardingStep } from './onboarding-steps'

export const ONBOARDING_PREPARE_EVENT = 'felt-onboarding-prepare'

export type OnboardingPrepareDetail = {
  profileSection?: 'works' | 'account'
  profileFilter?: 'draft' | 'drawing' | 'story' | 'blueprint' | 'completed'
  rewardsTab?: 'bear'
}

export function navigateForOnboardingStep(step: OnboardingStep): void {
  switch (step.id) {
    case 'lobby-create':
    case 'lobby-learning':
    case 'lobby-share':
    case 'lobby-profile':
      openLobby()
      return
    case 'library-new':
      openLibrary()
      return
    case 'editor-add-image': {
      const prepared = prepareNewWorkScene('指引体验作品', listCatalogThemes()[0] || 'all')
      if (prepared.scene) {
        openEditor({ mode: 'new', scene: prepared.scene })
      } else {
        openLibrary()
      }
      return
    }
    case 'create-asset':
      openCreate()
      return
    case 'fabrication-start':
      openFabrication()
      return
    case 'plaza-public':
      openPlaza()
      return
    case 'learning-guided':
      openLearning()
      return
    case 'rewards-bear':
      openRewards()
      window.dispatchEvent(
        new CustomEvent<OnboardingPrepareDetail>(ONBOARDING_PREPARE_EVENT, {
          detail: { rewardsTab: 'bear' }
        })
      )
      return
    case 'profile-works':
      openPersonalCenter()
      window.dispatchEvent(
        new CustomEvent<OnboardingPrepareDetail>(ONBOARDING_PREPARE_EVENT, {
          detail: { profileSection: 'works' }
        })
      )
      return
    case 'profile-story':
      openPersonalCenter()
      window.dispatchEvent(
        new CustomEvent<OnboardingPrepareDetail>(ONBOARDING_PREPARE_EVENT, {
          detail: { profileSection: 'works', profileFilter: 'story' }
        })
      )
      return
    default:
      break
  }
}
