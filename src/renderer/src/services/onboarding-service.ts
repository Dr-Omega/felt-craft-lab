import type { PlazaUser } from '@shared/contracts/plaza'
import { ONBOARDING_VERSION } from '@shared/contracts/plaza'
import { getAppView, openLobby, subscribeAppNav } from '../app-nav'
import { completePlazaOnboarding } from './plaza-api'
import { loadPlazaSession, patchPlazaUser, type PlazaSession } from './plaza-session'
import { navigateForOnboardingStep } from './onboarding-nav'
import { ONBOARDING_STEPS, type OnboardingStep } from './onboarding-steps'

type Listener = () => void
let active = false
let replayMode = false
let stepIndex = 0
let owner: PlazaSession | null = null
let startTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<Listener>()
const key = (id: string) => 'felt.onboarding.completed.' + id
function locallyComplete(id: string): boolean {
  try { return Number(localStorage.getItem(key(id))) >= ONBOARDING_VERSION } catch { return false }
}
function notify(): void { for (const listener of listeners) listener() }
function sameAccount(session: PlazaSession): boolean {
  const current = loadPlazaSession()
  return current?.user.userId === session.user.userId && current.token === session.token
}
function effectiveStepIndex(): number {
  let index = stepIndex
  while (index < ONBOARDING_STEPS.length && ONBOARDING_STEPS[index].skipWhen?.(owner?.user.role ?? 'child')) index++
  return index
}
export function subscribeOnboarding(listener: Listener): () => void { listeners.add(listener); return () => listeners.delete(listener) }
export function isOnboardingActive(): boolean { return active }
export function isOnboardingReplay(): boolean { return replayMode }
export function getOnboardingStepIndex(): number { return effectiveStepIndex() }
export function getOnboardingStep(): OnboardingStep | undefined { return ONBOARDING_STEPS[effectiveStepIndex()] }
export function getOnboardingProgress(): string {
  const available = ONBOARDING_STEPS.filter(step => !step.skipWhen?.(owner?.user.role ?? 'child'))
  return (available.findIndex(step => step === getOnboardingStep()) + 1) + ' / ' + available.length
}
export function onboardingViewMatches(): boolean { return getAppView() === getOnboardingStep()?.view }

async function persistComplete(session: PlazaSession): Promise<void> {
  if ((session.user.onboardingCompletedVersion ?? ONBOARDING_VERSION) >= ONBOARDING_VERSION) return
  try {
    const user = await completePlazaOnboarding(session.token, ONBOARDING_VERSION)
    if (sameAccount(session) && user.userId === session.user.userId) patchPlazaUser(user)
  } catch {
    // Per-account local completion prevents replay on this device; login retries the authenticated server write.
  }
}
export function maybeStartOnboardingAfterAuth(user: PlazaUser): void {
  stopOnboardingUi()
  const session = loadPlazaSession()
  if (!session || session.user.userId !== user.userId || (user.onboardingCompletedVersion ?? ONBOARDING_VERSION) >= ONBOARDING_VERSION) return
  if (locallyComplete(user.userId)) { void persistComplete(session); return }
  startTimer = setTimeout(() => {
    startTimer = undefined
    if (!sameAccount(session) || getAppView() !== 'lobby') return
    owner = session; active = true; replayMode = false; stepIndex = 0
    navigateForOnboardingStep(getOnboardingStep()!)
    notify()
  }, 400)
}
export function replayOnboardingTour(): void {
  stopOnboardingUi()
  owner = loadPlazaSession()
  if (!owner) return
  active = true; replayMode = true; stepIndex = 0
  navigateForOnboardingStep(getOnboardingStep()!)
  notify()
}
export function stopOnboardingUi(): void {
  if (startTimer) clearTimeout(startTimer)
  startTimer = undefined; active = false; stepIndex = 0; replayMode = false; owner = null
  notify()
}
async function completeTour(): Promise<void> {
  const session = owner
  if (!session || !sameAccount(session)) { stopOnboardingUi(); return }
  try { localStorage.setItem(key(session.user.userId), String(ONBOARDING_VERSION)) } catch { /* private storage unavailable */ }
  stopOnboardingUi()
  openLobby()
  await persistComplete(session)
}
export async function skipOnboardingTour(): Promise<void> { await completeTour() }
export async function finishOnboardingTour(): Promise<void> { await completeTour() }
export function advanceOnboardingStep(): void {
  if (!active || !owner || !sameAccount(owner)) { stopOnboardingUi(); return }
  let next = effectiveStepIndex() + 1
  while (next < ONBOARDING_STEPS.length && ONBOARDING_STEPS[next].skipWhen?.(owner.user.role)) next++
  if (next >= ONBOARDING_STEPS.length) { void finishOnboardingTour(); return }
  stepIndex = next
  navigateForOnboardingStep(getOnboardingStep()!)
  notify()
}
export function bindOnboardingNavRefresh(): () => void {
  return subscribeAppNav(() => {
    if (active && (!owner || !sameAccount(owner) || ['login','splash'].includes(getAppView()))) stopOnboardingUi()
    else if (active) notify()
  })
}
