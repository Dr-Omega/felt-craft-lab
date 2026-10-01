import { loginPlazaUser } from './plaza-api'
import { loadPlazaSession, savePlazaSession } from './plaza-session'

const DEV_USERNAME = '111'
const DEV_PASSWORD = '111'

/** Dev-only auto login for share-plaza UI v2 standalone entry. */
export async function ensureDevPlazaSession(): Promise<boolean> {
  if (!import.meta.env.DEV) return Boolean(loadPlazaSession()?.token)
  if (loadPlazaSession()?.token) return true
  try {
    const auth = await loginPlazaUser(DEV_USERNAME, DEV_PASSWORD)
    savePlazaSession({ token: auth.token, user: auth.user })
    return true
  } catch {
    return false
  }
}
