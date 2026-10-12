import type { PlazaUser } from '@shared/contracts/plaza'
import { ONBOARDING_VERSION } from '@shared/contracts/plaza'
import { getAppView, subscribeAppNav } from '../app-nav'
import { completePlazaOnboarding } from './plaza-api'
import { loadPlazaSession, patchPlazaUser } from './plaza-session'
import { ONBOARDING_STEPS, type OnboardingStep } from './onboarding-steps'

type Listener = () => void

let active = false
let replayMode = false
let stepIndex = 0
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener()
}

function currentRole(): string {
  return loadPlazaSession()?.user.role ?? 'child'
}

function effectiveStepIndex(): number {
  let index = stepIndex
  while (index < ONBOARDING_STEPS.length) {
    const step = ONBOARDING_STEPS[index]
    if (step.skipWhen?.(currentRole())) {
      index += 1
      continue
    }
    break
  }
  return index
}

export function subscribeOnboarding(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isOnboardingActive(): boolean {
  return active
}

export function isOnboardingReplay(): boolean {
  return replayMode
}

export function getOnboardingStepIndex(): number {
  return effectiveStepIndex()
}

export function getOnboardingStep(): OnboardingStep | undefined {
  const index = effectiveStepIndex()
  return ONBOARDING_STEPS[index]
}

export function onboardingViewMatches(): boolean {
  const step = getOnboardingStep()
  if (!step) return false
  return getAppView() === step.view
}

export function maybeStartOnboardingAfterAuth(user: PlazaUser): void {
  if ((user.onboardingCompletedVersion ?? 0) >= ONBOARDING_VERSION) return
  active = true
  replayMode = false
  stepIndex = 0
  notify()
}

export function replayOnboardingTour(): void {
  active = true
  replayMode = true
  stepIndex = 0
  notify()
}

export function stopOnboardingUi(): void {
  active = false
  stepIndex = 0
  replayMode = false
  notify()
}

async function persistOnboardingCompleteIfNeeded(): Promise<void> {
  const session = loadPlazaSession()
  if (!session?.token) return
  if ((session.user.onboardingCompletedVersion ?? 0) >= ONBOARDING_VERSION) return
  try {
    const user = await completePlazaOnboarding(session.token, ONBOARDING_VERSION)
    patchPlazaUser(user)
  } catch {
    /* keep local tour finished even if backend is offline */
  }
}

export async function skipOnboardingTour(): Promise<void> {
  stopOnboardingUi()
  await persistOnboardingCompleteIfNeeded()
}

export async function finishOnboardingTour(): Promise<void> {
  stopOnboardingUi()
  await persistOnboardingCompleteIfNeeded()
}

export function advanceOnboardingAfterTargetClick(): void {
  if (!active) return
  let next = effectiveStepIndex() + 1
  while (next < ONBOARDING_STEPS.length && ONBOARDING_STEPS[next].skipWhen?.(currentRole())) {
    next += 1
  }
  if (next >= ONBOARDING_STEPS.length) {
    void finishOnboardingTour()
    return
  }
  stepIndex = next
  notify()
}

/** Re-render overlay when navigation changes while tour is active. */
export function bindOnboardingNavRefresh(): () => void {
  return subscribeAppNav(() => {
    if (active) notify()
  })
}
