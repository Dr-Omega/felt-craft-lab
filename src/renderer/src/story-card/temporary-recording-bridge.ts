import type { ResourceRef } from '@shared/contracts'

function requireTemporaryRecordingApi(): {
  saveTemporaryStoryCardAudio: (audioBytes: ArrayBuffer | Uint8Array, mimeType: string) => Promise<ResourceRef>
  promoteTemporaryStoryCardAudio: (audioRef: string) => Promise<ResourceRef>
  deleteTemporaryStoryCardAudio: (audioRef: string) => Promise<void>
} {
  const api = window.electronAPI
  if (!api?.saveTemporaryStoryCardAudio || !api.promoteTemporaryStoryCardAudio || !api.deleteTemporaryStoryCardAudio) {
    throw new Error('临时录音保存接口不可用，请在 Electron 中打开应用。')
  }
  return api
}

/** Saves a completed full recording without exposing a blob URL or filesystem path. */
export async function saveTemporaryFullRecording(recording: Blob): Promise<ResourceRef> {
  if (!(recording instanceof Blob) || recording.size === 0) {
    throw new TypeError('完整录音必须是非空 Blob。')
  }
  if (!recording.type.toLowerCase().startsWith('audio/webm')) {
    throw new TypeError('完整录音必须使用 audio/webm 格式。')
  }

  return requireTemporaryRecordingApi().saveTemporaryStoryCardAudio(await recording.arrayBuffer(), recording.type)
}

export async function deleteTemporaryStoryCardRecording(audioRef: ResourceRef): Promise<void> {
  return requireTemporaryRecordingApi().deleteTemporaryStoryCardAudio(audioRef)
}

export async function confirmTemporaryFullStoryCardRecording(audioRef: ResourceRef): Promise<ResourceRef> {
  return requireTemporaryRecordingApi().promoteTemporaryStoryCardAudio(audioRef)
}
