import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { toSharedError, type SharedError } from '@shared/contracts/error'
import { gatewayJson } from './gateway-client'
import { loadOrCreateInstallationId } from './installation-id'

const CACHE_FILE = 'session-token.json'
const REFRESH_SKEW_SEC = 60

type CachedSession = {
  token: string
  expiresAt: number
  installationId: string
}

let inflight: Promise<CachedSession | { error: SharedError }> | null = null

export function clearSessionTokenCache(aiDir: string): void {
  const path = join(aiDir, CACHE_FILE)
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // ignore
  }
}

function readCache(aiDir: string): CachedSession | null {
  const path = join(aiDir, CACHE_FILE)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<CachedSession>
    if (
      typeof raw.token === 'string' &&
      typeof raw.expiresAt === 'number' &&
      typeof raw.installationId === 'string'
    ) {
      return {
        token: raw.token,
        expiresAt: raw.expiresAt,
        installationId: raw.installationId.toLowerCase()
      }
    }
  } catch {
    return null
  }
  return null
}

function writeCache(aiDir: string, session: CachedSession): void {
  mkdirSync(aiDir, { recursive: true })
  writeFileSync(join(aiDir, CACHE_FILE), JSON.stringify(session, null, 2), 'utf8')
}

async function fetchNewToken(
  aiDir: string,
  isPackaged: boolean
): Promise<CachedSession | { error: SharedError }> {
  const installationId = loadOrCreateInstallationId(aiDir)
  const result = await gatewayJson('/api/session/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId }),
    isPackaged,
    skipAuth: true
  })
  if (!result.ok) return { error: result.error }

  const body = result.body as {
    ok?: unknown
    result?: { token?: unknown; expiresAt?: unknown }
    error?: unknown
  }
  if (body.ok === false) {
    return { error: toSharedError(body.error, 'INVALID_ARGUMENT') }
  }
  const token = body.result?.token
  const expiresAt = body.result?.expiresAt
  if (typeof token !== 'string' || !token.trim() || typeof expiresAt !== 'number') {
    return {
      error: toSharedError(
        { code: 'UNKNOWN', message: '会话签发失败，请稍后重试。', retryable: true },
        'UNKNOWN'
      )
    }
  }
  const session: CachedSession = {
    token,
    expiresAt,
    installationId
  }
  writeCache(aiDir, session)
  return session
}

/**
 * Return a valid short-lived session token, refreshing near expiry.
 * Main-only; Renderer never sees the HMAC secret or raw token lifecycle.
 */
export async function getValidSessionToken(options: {
  aiDir: string
  isPackaged?: boolean
  forceRefresh?: boolean
}): Promise<{ ok: true; session: CachedSession } | { ok: false; error: SharedError }> {
  const { aiDir, isPackaged = false, forceRefresh = false } = options
  mkdirSync(aiDir, { recursive: true })

  if (!forceRefresh) {
    const cached = readCache(aiDir)
    const now = Math.floor(Date.now() / 1000)
    if (cached && cached.expiresAt > now + REFRESH_SKEW_SEC) {
      return { ok: true, session: cached }
    }
  }

  if (!inflight) {
    inflight = fetchNewToken(aiDir, isPackaged).finally(() => {
      inflight = null
    })
  }
  const out = await inflight
  if ('error' in out) return { ok: false, error: out.error }
  return { ok: true, session: out }
}
