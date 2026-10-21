import { toSharedError, type SharedError } from '@shared/contracts/error'
import { gatewayJson, type GatewayJsonResult } from '../ai/gateway-client'
import { resolveAiGatewayBaseUrlResult } from '../ai/gateway-config'

function plazaBodyError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'UNKNOWN'
  const record = body as { ok?: unknown; error?: { code?: unknown } }
  if (record.ok === false && typeof record.error?.code === 'string') {
    return record.error.code
  }
  return null
}

export async function plazaRegister(input: {
  username: string
  password: string
  role: string
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  return gatewayJson('/api/plaza/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: input.username, password: input.password, role: input.role }),
    skipAuth: true,
    isPackaged: input.isPackaged
  })
}

export async function plazaLogin(input: {
  username: string
  password: string
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  return gatewayJson('/api/plaza/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: input.username, password: input.password }),
    skipAuth: true,
    isPackaged: input.isPackaged
  })
}

export async function plazaCompleteOnboarding(input: {
  token: string
  version: number
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  return gatewayJson('/api/plaza/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: input.version }),
    plazaUserToken: input.token,
    isPackaged: input.isPackaged
  })
}

export async function plazaListPosts(input: {
  token: string
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  return gatewayJson('/api/plaza/posts', {
    method: 'GET',
    plazaUserToken: input.token,
    isPackaged: input.isPackaged
  })
}

export async function plazaGetPost(input: {
  token: string
  postId: string
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  return gatewayJson(`/api/plaza/posts/${encodeURIComponent(input.postId)}`, {
    method: 'GET',
    plazaUserToken: input.token,
    isPackaged: input.isPackaged
  })
}

export async function plazaMySharedProjectIds(input: {
  token: string
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  return gatewayJson('/api/plaza/posts/mine/project-ids', {
    method: 'GET',
    plazaUserToken: input.token,
    isPackaged: input.isPackaged
  })
}

export async function plazaPublishPost(input: {
  token: string
  projectId: string
  title: string
  previewBytes: Buffer
  outputType?: 'collage' | 'story'
  storyTitle?: string
  storyText?: string
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  const form = new FormData()
  const blob = new Blob([Uint8Array.from(input.previewBytes)], { type: 'image/png' })
  form.append('file', blob, 'preview.png')
  form.append('projectId', input.projectId)
  form.append('title', input.title)
  form.append('outputType', input.outputType ?? 'collage')
  form.append('storyTitle', input.storyTitle ?? '')
  form.append('storyText', input.storyText ?? '')
  return gatewayJson('/api/plaza/posts', {
    method: 'POST',
    body: form,
    plazaUserToken: input.token,
    isPackaged: input.isPackaged
  })
}

export async function plazaWithdrawPost(input: {
  token: string
  projectId: string
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  return gatewayJson(`/api/plaza/posts/by-project/${encodeURIComponent(input.projectId)}`, {
    method: 'DELETE',
    plazaUserToken: input.token,
    isPackaged: input.isPackaged
  })
}

export async function plazaFetchMediaBytes(input: {
  token: string
  previewMediaPath: string
  isPackaged?: boolean
}): Promise<{ ok: true; bytes: Buffer; mimeType: string } | { ok: false; error: SharedError }> {
  // Only fetch actual generated preview filenames, never arbitrary authenticated gateway paths.
  if (!/^\/api\/plaza\/media\/[a-f0-9]{32}\.(png|jpg|bmp)$/.test(input.previewMediaPath)) {
    return { ok: false, error: toSharedError({ code: 'INVALID_ARGUMENT', message: '分享预览路径无效。', retryable: false }, 'INVALID_ARGUMENT') }
  }
  const resolved = resolveAiGatewayBaseUrlResult({ isPackaged: input.isPackaged })
  if (!resolved.ok) {
    return {
      ok: false,
      error: toSharedError(
        { code: 'UNKNOWN', message: '分享广场服务未配置。', retryable: false },
        'UNKNOWN'
      )
    }
  }
  const url = `${resolved.baseUrl}${input.previewMediaPath}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${input.token}` }
    })
    if (!response.ok) {
      return {
        ok: false,
        error: toSharedError(
          { code: 'UNKNOWN', message: '无法加载广场预览图。', retryable: response.status >= 500 },
          'UNKNOWN'
        )
      }
    }
    const mimeType = (response.headers.get('content-type') || 'image/png').split(';', 1)[0].trim()
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) {
      return {
        ok: false,
        error: toSharedError(
          { code: 'INVALID_ARGUMENT', message: '预览图为空。', retryable: false },
          'INVALID_ARGUMENT'
        )
      }
    }
    return { ok: true, bytes, mimeType }
  } catch {
    return {
      ok: false,
      error: toSharedError(
        { code: 'UNKNOWN', message: '无法连接分享广场服务。', retryable: true },
        'UNKNOWN'
      )
    }
  }
}

export { plazaBodyError }
