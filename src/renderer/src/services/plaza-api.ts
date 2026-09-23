import type { PlazaAuthResult, PlazaPost } from '@shared/contracts/plaza'
import type { SharedError } from '@shared/contracts'

type IpcFail = { ok: false; error: SharedError }

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
  return { token: candidate.token, user: { userId: user.userId, username: user.username } }
}

export async function registerPlazaUser(username: string, password: string): Promise<PlazaAuthResult> {
  const raw = await invoke<unknown>(getPlazaApi().register({ username, password }))
  return parseAuthResult(raw)
}

export async function loginPlazaUser(username: string, password: string): Promise<PlazaAuthResult> {
  const raw = await invoke<unknown>(getPlazaApi().login({ username, password }))
  return parseAuthResult(raw)
}

export async function listPlazaPosts(token: string): Promise<PlazaPost[]> {
  const result = await invoke<{ posts: PlazaPost[] }>(getPlazaApi().listPosts({ token }))
  return result.posts ?? []
}

export async function listMySharedProjectIds(token: string): Promise<string[]> {
  const result = await invoke<{ projectIds: string[] }>(getPlazaApi().mySharedProjectIds({ token }))
  return result.projectIds ?? []
}

export async function publishPlazaPost(input: {
  token: string
  projectId: string
  title: string
  previewRef: string
}): Promise<PlazaPost> {
  const result = await invoke<{ post: PlazaPost }>(getPlazaApi().publish(input))
  return result.post
}

export async function withdrawPlazaPost(token: string, projectId: string): Promise<void> {
  await invoke(getPlazaApi().withdraw({ token, projectId }))
}

export async function loadPlazaPreviewUrl(token: string, previewMediaPath: string): Promise<string> {
  const result = await invoke<{ previewUrl?: string; mimeType?: string; dataBase64?: string }>(
    getPlazaApi().previewBytes({ token, previewMediaPath })
  )
  if (result?.previewUrl) return result.previewUrl
  const mimeType = result?.mimeType || 'image/png'
  const dataBase64 = result?.dataBase64
  if (dataBase64) return `data:${mimeType};base64,${dataBase64}`
  throw { code: 'UNKNOWN', message: '预览图加载失败。', retryable: true }
}
