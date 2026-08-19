import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type BootstrapPingResult } from '@shared/constants/app'
import type { ResourceRef, SharedError } from '@shared/contracts'
import type {
  CreationIntentIpcResult,
  CreationIntentSessionRequest,
  CreationIntentStartRequest,
  CreationIntentSubmitRequest
} from '@shared/creation-intent'
import type {
  PersonalAssetPngIngestRequest,
  PersonalAssetPngIngestResult,
  ResourceInspectResult
} from '@shared/resource'

type PreviewSaveIpcResult = { ok: true; ref: ResourceRef } | { ok: false; error: SharedError }
type PreviewDeleteIpcResult = { ok: true } | { ok: false; error: SharedError }

async function invokePersonalAssetPngIngest(input: PersonalAssetPngIngestRequest): Promise<ResourceRef> {
  const result = (await ipcRenderer.invoke(
    IPC_CHANNELS.PERSONAL_ASSET_RESOURCE_INGEST,
    input
  )) as PersonalAssetPngIngestResult
  if (!result?.ok) {
    const error = result?.error ?? {
      code: 'UNKNOWN' as const,
      message: '个人素材资源写入失败。',
      retryable: true
    }
    throw error
  }
  return result.ref
}

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
   * Persist one immutable Personal Asset Version PNG via Main. The renderer
   * supplies IDs and bytes only; Main derives the destination ResourceRef.
   */
  ingestPersonalAssetPng: (input: PersonalAssetPngIngestRequest): Promise<ResourceRef> =>
    invokePersonalAssetPngIngest(input),
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
  /**
   * AI Gateway proxy (Main→Flask). Renderer must not fetch Flask / set CORS.
   * Dev: Main→localhost; Prod: Main→remote AI_GATEWAY_BASE_URL.
   */
  ai: {
    health: (): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_HEALTH),
    asrTranscribe: (input: {
      audioBase64: string
      mimeType: string
      language?: string
      sessionId?: string
      provider?: string
    }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_ASR_TRANSCRIBE, input),
    qaAsk: (input: {
      question: string
      asset?: Record<string, unknown>
      provider?: string
    }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_QA_ASK, input),
    ttsSynthesize: (input: {
      text: string
      voicePurpose?: string
      provider?: string
    }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_TTS_SYNTHESIZE, input)
  },
  creationIntent: {
    start: (input: CreationIntentStartRequest = {}): Promise<CreationIntentIpcResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.CREATION_INTENT_START, input),
    submitText: (input: CreationIntentSubmitRequest): Promise<CreationIntentIpcResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.CREATION_INTENT_SUBMIT, input),
    confirm: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.CREATION_INTENT_CONFIRM, input),
    decideForMe: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.CREATION_INTENT_DECIDE_FOR_ME, input),
    regenerate: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.CREATION_INTENT_REGENERATE, input),
    snapshot: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.CREATION_INTENT_SNAPSHOT, input),
    accept: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.CREATION_INTENT_ACCEPT, input)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
