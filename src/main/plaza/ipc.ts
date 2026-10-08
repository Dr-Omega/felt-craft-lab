import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import type { ResourceRoots } from '@shared/resource'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { readPreviewPngBytes } from '../preview/write'
import { materializePlazaPreviewBytes } from './materialize-preview'
import {
  plazaFetchMediaBytes,
  plazaGetPost,
  plazaListPosts,
  plazaLogin,
  plazaMySharedProjectIds,
  plazaPublishPost,
  plazaRegister,
  plazaWithdrawPost
} from './gateway-plaza'
import { plazaRewardAction } from './gateway-rewards'
import type { RewardAction } from '@shared/contracts/rewards'

function deny() {
  return {
    ok: false as const,
    error: toSharedError(
      { code: 'UNKNOWN', message: '请求暂时无法完成，请稍后重试。', retryable: false },
      'UNKNOWN'
    )
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function unwrapResult(body: unknown): unknown {
  if (!body || typeof body !== 'object') return null
  const record = body as { ok?: unknown; result?: unknown }
  if (record.ok !== true) return null
  return record.result ?? null
}

function mapPlazaGatewayFailure(error: ReturnType<typeof toSharedError>): { ok: false; error: ReturnType<typeof toSharedError> } {
  const raw = error.message.trim()
  const plazaish =
    /AI|网关|分享广场/.test(raw) || raw.includes('8788') || raw.includes('backend')
  const message = plazaish ? '分享广场服务未连接，请先启动 backend。' : raw
  return {
    ok: false as const,
    error: toSharedError(
      { code: error.code, message, retryable: error.retryable },
      error.code
    )
  }
}

function mapGatewayBody(result: Awaited<ReturnType<typeof plazaLogin>>) {
  if (!result.ok) return mapPlazaGatewayFailure(result.error)
  const body = result.body
  if (body && typeof body === 'object' && (body as { ok?: unknown }).ok === false) {
    const err = (body as { error?: { code?: string; message?: string; retryable?: boolean } }).error
    return {
      ok: false as const,
      error: toSharedError(
        {
          code: 'INVALID_ARGUMENT',
          message: err?.message || '用户名或密码不正确，请再试一次。',
          retryable: Boolean(err?.retryable)
        },
        'INVALID_ARGUMENT'
      )
    }
  }
  const payload = unwrapResult(body)
  if (!payload) {
    return {
      ok: false as const,
      error: toSharedError(
        { code: 'UNKNOWN', message: '分享广场响应无效。', retryable: true },
        'UNKNOWN'
      )
    }
  }
  return { ok: true as const, result: payload }
}

export function registerPlazaIpc(roots: ResourceRoots): void {
  const packaged = app.isPackaged

  ipcMain.handle(IPC_CHANNELS.PLAZA_AUTH_REGISTER, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const username = typeof input.username === 'string' ? input.username : ''
    const password = typeof input.password === 'string' ? input.password : ''
    const role = typeof input.role === 'string' ? input.role : 'child'
    return mapGatewayBody(await plazaRegister({ username, password, role, isPackaged: packaged }))
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_AUTH_LOGIN, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const username = typeof input.username === 'string' ? input.username : ''
    const password = typeof input.password === 'string' ? input.password : ''
    return mapGatewayBody(await plazaLogin({ username, password, isPackaged: packaged }))
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_LIST_POSTS, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const token = typeof asRecord(raw).token === 'string' ? (asRecord(raw).token as string) : ''
    if (!token.trim()) return deny()
    return mapGatewayBody(await plazaListPosts({ token, isPackaged: packaged }))
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_GET_POST, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const token = typeof input.token === 'string' ? input.token : ''
    const postId = typeof input.postId === 'string' ? input.postId : ''
    if (!token.trim() || !postId.trim()) return deny()
    return mapGatewayBody(await plazaGetPost({ token, postId, isPackaged: packaged }))
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_MY_PROJECT_IDS, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const token = typeof asRecord(raw).token === 'string' ? (asRecord(raw).token as string) : ''
    if (!token.trim()) return deny()
    return mapGatewayBody(await plazaMySharedProjectIds({ token, isPackaged: packaged }))
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_PUBLISH, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const token = typeof input.token === 'string' ? input.token : ''
    const projectId = typeof input.projectId === 'string' ? input.projectId : ''
    const title = typeof input.title === 'string' ? input.title : ''
    const previewRef = typeof input.previewRef === 'string' ? input.previewRef : ''
    const outputType = input.outputType === 'story' ? 'story' : 'collage'
    if (!token.trim() || !projectId.trim() || !title.trim() || !previewRef.trim()) return deny()

    const preview = readPreviewPngBytes(previewRef, roots)
    if (!preview.ok) return { ok: false, error: preview.error }

    const published = await plazaPublishPost({
      token,
      projectId,
      title,
      previewBytes: preview.bytes,
      outputType,
      isPackaged: packaged
    })
    return mapGatewayBody(published)
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_WITHDRAW, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const token = typeof input.token === 'string' ? input.token : ''
    const projectId = typeof input.projectId === 'string' ? input.projectId : ''
    if (!token.trim() || !projectId.trim()) return deny()
    return mapGatewayBody(await plazaWithdrawPost({ token, projectId, isPackaged: packaged }))
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_PREVIEW_BYTES, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const token = typeof input.token === 'string' ? input.token : ''
    const previewMediaPath = typeof input.previewMediaPath === 'string' ? input.previewMediaPath : ''
    if (!token.trim() || !previewMediaPath.trim()) return deny()

    const fetched = await plazaFetchMediaBytes({ token, previewMediaPath, isPackaged: packaged })
    if (!fetched.ok) return mapPlazaGatewayFailure(fetched.error)
    const previewUrl = materializePlazaPreviewBytes(fetched.bytes, roots, fetched.mimeType)
    if (!previewUrl) {
      return {
        ok: false as const,
        error: toSharedError(
          { code: 'UNKNOWN', message: '预览图写入失败。', retryable: true },
          'UNKNOWN'
        )
      }
    }
    return {
      ok: true as const,
      result: { previewUrl }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PLAZA_REWARD_ACTION, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const token = typeof input.token === 'string' ? input.token : ''
    const action = typeof input.action === 'string' ? (input.action as RewardAction) : null
    const payload = asRecord(input.payload)
    const allowed = new Set<RewardAction>([
      'dashboard',
      'inbox',
      'claim',
      'like',
      'review',
      'convert',
      'recharge',
      'redeem',
      'feed',
      'adminConfig',
      'updateAdminConfig'
    ])
    if (!token.trim() || !action || !allowed.has(action)) return deny()
    return mapGatewayBody(await plazaRewardAction({ token, action, payload, isPackaged: packaged }))
  })
}
