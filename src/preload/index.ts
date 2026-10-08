import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type BootstrapPingResult } from '@shared/constants/app'
import type { ResourceRef, SharedError } from '@shared/contracts'
import type { QaAskInput } from '@shared/contracts/ai'
import type { RewardAction, UserRole } from '@shared/contracts/rewards'
import type { ResourceInspectResult } from '@shared/resource'

type PreviewSaveIpcResult = { ok: true; ref: ResourceRef } | { ok: false; error: SharedError }
type PreviewDeleteIpcResult = { ok: true } | { ok: false; error: SharedError }
type PlazaIpcResult<T> = { ok: true; result: T } | { ok: false; error: SharedError }

async function invokePreviewSave(pngBytes: ArrayBuffer | Uint8Array): Promise<ResourceRef> {
  const result = (await ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_SAVE, pngBytes)) as PreviewSaveIpcResult
  if (!result?.ok) {
    const error = result?.error ?? {
      code: 'PREVIEW_EXPORT_FAILED' as const,
      message: '预览图写入失败。',
      retryable: true
    }
    throw error
  }
  return result.ref
}

async function invokePreviewDelete(previewRef: string): Promise<void> {
  const result = (await ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_DELETE, previewRef)) as PreviewDeleteIpcResult
  if (!result?.ok) {
    const error = result?.error ?? {
      code: 'UNKNOWN' as const,
      message: '预览删除失败。',
      retryable: true
    }
    throw error
  }
}

const electronAPI = {
  ping: (): Promise<BootstrapPingResult> => ipcRenderer.invoke(IPC_CHANNELS.PING),
  /**
   * Renderer-safe resource inspection. Never returns OS paths.
   * Media tags should use the ResourceRef string directly as `felt-resource://...`.
   */
  inspectResource: (ref: string): Promise<ResourceInspectResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.RESOURCE_INSPECT, ref),
  /**
   * Persist a project preview PNG via Main. Pass bytes only — never OS paths.
   * Returns felt-resource://preview/<uuid>.png
   */
  saveProjectPreview: (pngBytes: ArrayBuffer | Uint8Array): Promise<ResourceRef> =>
    invokePreviewSave(pngBytes),
  /**
   * Delete a previously saved preview by felt-resource://preview/... ref only.
   */
  deleteProjectPreview: (previewRef: string): Promise<void> => invokePreviewDelete(previewRef),
  uploadImage: (input: {
    imageBase64: string
    mimeType: string
    fileName: string
  }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_UPLOAD, input),
  /**
   * AI Gateway proxy (Main→Flask). Renderer must not fetch Flask / set CORS.
   * Dev: Main→localhost; Prod: Main→remote AI_GATEWAY_BASE_URL.
   */
  plaza: {
    register: (input: { username: string; password: string; role: UserRole }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_AUTH_REGISTER, input),
    login: (input: { username: string; password: string }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_AUTH_LOGIN, input),
    listPosts: (input: { token: string }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_LIST_POSTS, input),
    mySharedProjectIds: (input: { token: string }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_MY_PROJECT_IDS, input),
    publish: (input: {
      token: string
      projectId: string
      title: string
      previewRef: string
      outputType?: 'collage' | 'story'
    }): Promise<PlazaIpcResult<unknown>> => ipcRenderer.invoke(IPC_CHANNELS.PLAZA_PUBLISH, input),
    withdraw: (input: { token: string; projectId: string }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_WITHDRAW, input),
    previewBytes: (input: { token: string; previewMediaPath: string }): Promise<
      PlazaIpcResult<{ previewUrl: string }>
    > => ipcRenderer.invoke(IPC_CHANNELS.PLAZA_PREVIEW_BYTES, input)
  },
  rewards: {
    action: (input: {
      token: string
      action: RewardAction
      payload?: Record<string, unknown>
    }): Promise<PlazaIpcResult<unknown>> => ipcRenderer.invoke(IPC_CHANNELS.PLAZA_REWARD_ACTION, input)
  },
  ai: {
    health: (): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_HEALTH),
    asrTranscribe: (input: {
      audioBase64: string
      mimeType: string
      language?: string
      sessionId?: string
      provider?: string
    }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_ASR_TRANSCRIBE, input),
    qaAsk: (input: QaAskInput): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_QA_ASK, input),
    ttsSynthesize: (input: {
      text: string
      voicePurpose?: string
      provider?: string
    }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_TTS_SYNTHESIZE, input)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
