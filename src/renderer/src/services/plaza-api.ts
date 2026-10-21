import type { PlazaAuthResult, PlazaPost, PlazaUser } from '@shared/contracts/plaza'
import { ONBOARDING_VERSION } from '@shared/contracts/plaza'
import type { UserRole } from '@shared/contracts/rewards'
import type { SharedError } from '@shared/contracts'

type IpcFail = { ok: false; error: SharedError }

const browserPlazaEnabled = (): boolean => !window.electronAPI?.plaza

async function browserPlazaRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init)
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: T; error?: SharedError }
    | null
  if (!response.ok || body?.ok === false) {
    throw body?.error ?? { code: 'UNKNOWN', message: '分享广场服务请求失败。', retryable: response.status >= 500 }
  }
  return (body?.result ?? body) as T
}

function getPlazaApi(): NonNullable<typeof window.electronAPI.plaza> {
  if (!window.electronAPI?.plaza) {
    throw { code: 'UNKNOWN', message: '分享广场接口不可用。', retryable: false } satisfies SharedError
  }
  return window.electronAPI.plaza
}

async function invoke<T>(call: Promise<{ ok: true; result: unknown } | IpcFail>): Promise<T> {
  const result = await call
  if (!result?.ok) {
    throw result?.error ?? { code: 'UNKNOWN', message: '分享广场请求失败。', retryable: true }
  }
  return result.result as T
}

function parseAuthResult(raw: unknown): PlazaAuthResult {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const candidate =
    record && typeof record.token === 'string' && record.user
      ? record
      : record?.result && typeof record.result === 'object'
        ? (record.result as Record<string, unknown>)
        : null
  if (!candidate || typeof candidate.token !== 'string') {
    throw {
      code: 'UNKNOWN',
      message: '无法连接账号服务，请先启动 backend（8788 端口）。',
      retryable: true
    } satisfies SharedError
  }
  const userRaw = candidate.user
  if (!userRaw || typeof userRaw !== 'object') {
    throw { code: 'UNKNOWN', message: '账号服务返回无效。', retryable: false } satisfies SharedError
  }
  const user = userRaw as Record<string, unknown>
  if (typeof user.userId !== 'string' || typeof user.username !== 'string') {
    throw { code: 'UNKNOWN', message: '账号服务返回无效。', retryable: false } satisfies SharedError
  }
  const roles = new Set<UserRole>(['child', 'parent', 'art_teacher', 'chinese_teacher', 'admin'])
  const role = roles.has(user.role as UserRole) ? (user.role as UserRole) : 'child'
  const onboardingRaw = user.onboardingCompletedVersion
  const onboardingCompletedVersion =
    typeof onboardingRaw === 'number' && Number.isFinite(onboardingRaw) ? Math.max(0, Math.floor(onboardingRaw)) : ONBOARDING_VERSION
  return {
    token: candidate.token,
    user: { userId: user.userId, username: user.username, role, onboardingCompletedVersion },
    dailyRewardGranted: candidate.dailyRewardGranted === true
  }
}

function parseUserResult(raw: unknown): PlazaUser {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const userRaw =
    record?.user && typeof record.user === 'object'
      ? (record.user as Record<string, unknown>)
      : record?.result && typeof record.result === 'object' && (record.result as Record<string, unknown>).user
        ? ((record.result as Record<string, unknown>).user as Record<string, unknown>)
        : null
  if (!userRaw || typeof userRaw.userId !== 'string' || typeof userRaw.username !== 'string') {
    throw { code: 'UNKNOWN', message: '账号服务返回无效。', retryable: false } satisfies SharedError
  }
  const roles = new Set<UserRole>(['child', 'parent', 'art_teacher', 'chinese_teacher', 'admin'])
  const role = roles.has(userRaw.role as UserRole) ? (userRaw.role as UserRole) : 'child'
  const onboardingRaw = userRaw.onboardingCompletedVersion
  const onboardingCompletedVersion =
    typeof onboardingRaw === 'number' && Number.isFinite(onboardingRaw) ? Math.max(0, Math.floor(onboardingRaw)) : 0
  return {
    userId: userRaw.userId,
    username: userRaw.username,
    role,
    onboardingCompletedVersion
  }
}

export async function completePlazaOnboarding(token: string, version: number = ONBOARDING_VERSION): Promise<PlazaUser> {
  if (browserPlazaEnabled()) {
    const raw = await browserPlazaRequest<unknown>('/api/plaza/onboarding/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version })
    })
    return parseUserResult(raw)
  }
  const raw = await invoke<{ user?: PlazaUser } | PlazaUser>(getPlazaApi().completeOnboarding({ token, version }))
  return parseUserResult(raw)
}

export async function registerPlazaUser(
  username: string,
  password: string,
  role: UserRole
): Promise<PlazaAuthResult> {
  if (browserPlazaEnabled()) {
    const raw = await browserPlazaRequest<unknown>('/api/plaza/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    })
    return parseAuthResult(raw)
  }
  const raw = await invoke<unknown>(getPlazaApi().register({ username, password, role }))
  return parseAuthResult(raw)
}

export async function loginPlazaUser(username: string, password: string): Promise<PlazaAuthResult> {
  if (browserPlazaEnabled()) {
    const raw = await browserPlazaRequest<unknown>('/api/plaza/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    return parseAuthResult(raw)
  }
  const raw = await invoke<unknown>(getPlazaApi().login({ username, password }))
  return parseAuthResult(raw)
}

export async function listPlazaPosts(token: string): Promise<PlazaPost[]> {
  if (browserPlazaEnabled()) {
    const result = await browserPlazaRequest<{ posts: PlazaPost[] }>('/api/plaza/posts', {
      headers: { Authorization: `Bearer ${token}` }
    })
    return result.posts ?? []
  }
  const result = await invoke<{ posts: PlazaPost[] }>(getPlazaApi().listPosts({ token }))
  return result.posts ?? []
}

export async function listMySharedProjectIds(token: string): Promise<string[]> {
  if (browserPlazaEnabled()) {
    const result = await browserPlazaRequest<{ projectIds: string[] }>('/api/plaza/posts/mine/project-ids', {
      headers: { Authorization: `Bearer ${token}` }
    })
    return result.projectIds ?? []
  }
  const result = await invoke<{ projectIds: string[] }>(getPlazaApi().mySharedProjectIds({ token }))
  return result.projectIds ?? []
}

export async function getPlazaPost(token: string, postId: string): Promise<PlazaPost> {
  const result = browserPlazaEnabled()
    ? await browserPlazaRequest<{ post: PlazaPost }>(`/api/plaza/posts/${encodeURIComponent(postId)}`, { headers: { Authorization: `Bearer ${token}` } })
    : await invoke<{ post: PlazaPost }>(getPlazaApi().getPost({ token, postId }))
  return result.post
}

export async function publishPlazaPost(input: {
  token: string
  projectId: string
  title: string
  previewRef: string
  outputType?: 'collage' | 'story'
  storyTitle?: string
  storyText?: string
}): Promise<PlazaPost> {
  if (browserPlazaEnabled()) {
    throw { code: 'UNKNOWN', message: '浏览器预览暂不支持发布作品，请使用桌面应用。', retryable: false } satisfies SharedError
  }
  const result = await invoke<{ post: PlazaPost }>(getPlazaApi().publish(input))
  return result.post
}

export async function withdrawPlazaPost(token: string, projectId: string): Promise<void> {
  if (browserPlazaEnabled()) {
    await browserPlazaRequest(`/api/plaza/posts/by-project/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    return
  }
  await invoke(getPlazaApi().withdraw({ token, projectId }))
}

export async function loadPlazaPreviewUrl(token: string, previewMediaPath: string): Promise<string> {
  if (browserPlazaEnabled()) {
    const path = previewMediaPath.startsWith('/') ? previewMediaPath : `/${previewMediaPath}`
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) {
      throw { code: 'UNKNOWN', message: '预览图加载失败。', retryable: response.status >= 500 } satisfies SharedError
    }
    return URL.createObjectURL(await response.blob())
  }
  const result = await invoke<{ previewUrl?: string; mimeType?: string; dataBase64?: string }>(
    getPlazaApi().previewBytes({ token, previewMediaPath })
  )
  if (result?.previewUrl) return result.previewUrl
  const mimeType = result?.mimeType || 'image/png'
  const dataBase64 = result?.dataBase64
  if (dataBase64) return `data:${mimeType};base64,${dataBase64}`
  throw { code: 'UNKNOWN', message: '预览图加载失败。', retryable: true }
}
