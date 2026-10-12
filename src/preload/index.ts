import type { UserRole, RewardAction } from '@shared/contracts/rewards'
type PlazaIpcResult<T> = { ok: true; result: T } | { ok: false; error: SharedError }
import { contextBridge, ipcRenderer } from 'electron'
import { WORKSPACE_SYNC_CHANNEL, type SyncRequest, type SyncResponse } from '@shared/workspace-sync'
import { LEARNING_CHANNEL } from '@shared/learning'
import { FABRICATION_CHANNELS, type FabricationJob, type ForegroundMode } from '@shared/fabrication-desktop'
import type { LayerColors, SceneBinding } from '@shared/fabrication-colors'
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

type StoryCardAudioSaveIpcResult = { ok: true; ref: ResourceRef } | { ok: false; error: SharedError }
type StoryCardAudioPromoteIpcResult = { ok: true; ref: ResourceRef } | { ok: false; error: SharedError }
type StoryCardAudioDeleteIpcResult = { ok: true } | { ok: false; error: SharedError }
type StoryCardAudioReadIpcResult =
  | { ok: true; audioBase64: string; mimeType: 'audio/webm' }
  | { ok: false; error: SharedError }

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

async function invokeStoryCardAudioSave(audioBytes: ArrayBuffer | Uint8Array, mimeType: string): Promise<ResourceRef> {
  const result = (await ipcRenderer.invoke(IPC_CHANNELS.STORY_CARD_AUDIO_SAVE, {
    audioBytes,
    mimeType
  })) as StoryCardAudioSaveIpcResult
  if (!result?.ok) {
    throw result?.error ?? {
      code: 'UNKNOWN' as const,
      message: '临时录音写入失败。',
      retryable: true
    }
  }
  return result.ref
}

async function invokeStoryCardAudioRead(audioRef: string): Promise<{ audioBase64: string; mimeType: 'audio/webm' }> {
  const result = (await ipcRenderer.invoke(IPC_CHANNELS.STORY_CARD_AUDIO_READ, audioRef)) as StoryCardAudioReadIpcResult
  if (!result?.ok) {
    throw result?.error ?? {
      code: 'UNKNOWN' as const,
      message: '临时录音读取失败。',
      retryable: true
    }
  }
  return { audioBase64: result.audioBase64, mimeType: result.mimeType }
}

async function invokeStoryCardAudioDelete(audioRef: string): Promise<void> {
  const result = (await ipcRenderer.invoke(IPC_CHANNELS.STORY_CARD_AUDIO_DELETE, audioRef)) as StoryCardAudioDeleteIpcResult
  if (!result?.ok) {
    throw result?.error ?? {
      code: 'UNKNOWN' as const,
      message: '临时录音删除失败。',
      retryable: true
    }
  }
}

async function invokeStoryCardAudioPromote(audioRef: string): Promise<ResourceRef> {
  const result = (await ipcRenderer.invoke(IPC_CHANNELS.STORY_CARD_AUDIO_PROMOTE, audioRef)) as StoryCardAudioPromoteIpcResult
  if (!result?.ok) {
    throw result?.error ?? {
      code: 'UNKNOWN' as const,
      message: '完整录音确认失败。',
      retryable: true
    }
  }
  return result.ref
}

const electronAPI = {
  workspaceSync: (input: SyncRequest): Promise<SyncResponse> => ipcRenderer.invoke(WORKSPACE_SYNC_CHANNEL, input),
  plaza: {
    logout: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.PLAZA_LOGOUT),
    register: (input: { username: string; password: string; role: UserRole }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_AUTH_REGISTER, input),
    login: (input: { username: string; password: string }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_AUTH_LOGIN, input),
    completeOnboarding: (input: { token: string; version: number }): Promise<PlazaIpcResult<unknown>> =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAZA_ONBOARDING_COMPLETE, input),
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

  learningZone: {
    request: (path: string, input: { method: 'GET' | 'POST'; body?: string; snapshotId: string }): Promise<unknown> =>
      ipcRenderer.invoke(LEARNING_CHANNEL, { path, ...input })
  },
  fabrication: {
    list: (): Promise<FabricationJob[]> => ipcRenderer.invoke(FABRICATION_CHANNELS.list),
    retry: (id: string): Promise<FabricationJob> => ipcRenderer.invoke(FABRICATION_CHANNELS.retry, id),
    availability: (): Promise<{ available: boolean; message: string }> => ipcRenderer.invoke(FABRICATION_CHANNELS.availability),
    start: (bytes: Uint8Array, mode: ForegroundMode, binding?: SceneBinding): Promise<FabricationJob> =>
      ipcRenderer.invoke(FABRICATION_CHANNELS.start, bytes, mode, binding),
    colors: (id: string): Promise<LayerColors> => ipcRenderer.invoke(FABRICATION_CHANNELS.colors, id),
    saveColors: (id: string, colors: LayerColors): Promise<LayerColors> => ipcRenderer.invoke(FABRICATION_CHANNELS.saveColors, id, colors),
    resume: (id: string): Promise<FabricationJob> => ipcRenderer.invoke(FABRICATION_CHANNELS.resume, id),
    status: (id: string): Promise<FabricationJob> => ipcRenderer.invoke(FABRICATION_CHANNELS.status, id),
    asset: (id: string, key: string): Promise<{ bytes: Uint8Array; mime: string }> =>
      ipcRenderer.invoke(FABRICATION_CHANNELS.asset, id, key)
  },
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
  saveTemporaryStoryCardAudio: invokeStoryCardAudioSave,
  readTemporaryStoryCardAudio: invokeStoryCardAudioRead,
  promoteTemporaryStoryCardAudio: invokeStoryCardAudioPromote,
  deleteTemporaryStoryCardAudio: invokeStoryCardAudioDelete,
  ai: {
    storyRewrite: (input: { workId: string; text: string; context: Record<string, unknown> }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_STORY_REWRITE, input),
    health: (): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_HEALTH),
    asrTranscribe: (input: {
      audioBase64: string
      mimeType: string
      language?: string
      sessionId?: string
      provider?: string
    }): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.AI_ASR_TRANSCRIBE, input),
    qaAsk: (input: {
      history?: readonly import('@shared/qa-history').QaHistoryMessage[]
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
