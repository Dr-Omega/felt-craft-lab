import type { PlazaUser } from '@shared/contracts/plaza'

const TOKEN_KEY = 'felt.plaza.token'
const USER_KEY = 'felt.plaza.user'

export interface PlazaSession {
  token: string
  user: PlazaUser
}

export function loadPlazaSession(): PlazaSession | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const rawUser = localStorage.getItem(USER_KEY)
    if (!token || !rawUser) return null
    const user = JSON.parse(rawUser) as PlazaUser
    if (!user?.userId || !user?.username) return null
    return { token, user: { ...user, role: user.role ?? 'child' } }
  } catch {
    return null
  }
}

export function savePlazaSession(session: PlazaSession): void {
  localStorage.setItem(TOKEN_KEY, session.token)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
}

export function patchPlazaUser(partial: Partial<PlazaSession['user']>): void {
  const session = loadPlazaSession()
  if (!session) return
  savePlazaSession({ ...session, user: { ...session.user, ...partial } })
}

export function clearPlazaSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/** Legacy local profile is only used outside the authenticated UI (tests/old data). */
export function getCurrentUserId(): string {
  return loadPlazaSession()?.user.userId ?? 'user_demo_001'
}
