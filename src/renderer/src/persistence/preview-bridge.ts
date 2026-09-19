import type { ResourceRef, SharedError } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { asPersistenceError, PersistenceError, persistenceError } from './errors'

function requirePreviewApi(): {
  saveProjectPreview: (pngBytes: ArrayBuffer | Uint8Array) => Promise<ResourceRef>
  deleteProjectPreview: (previewRef: string) => Promise<void>
} {
  const api = window.electronAPI
  if (!api?.saveProjectPreview || !api?.deleteProjectPreview) {
    throw persistenceError(
      'PREVIEW_EXPORT_FAILED',
      '预览持久化接口不可用，请在 Electron 中打开应用。'
    )
  }
  return api
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

/**
 * Renderer bridge: Blob → bytes → Main saveProjectPreview.
 * Does not decide filesystem paths; Main returns felt-resource://preview/<uuid>.png
 */
export async function saveProjectPreviewBytes(previewPng: Blob): Promise<ResourceRef> {
  if (!(previewPng instanceof Blob)) {
    throw persistenceError('INVALID_ARGUMENT', '预览图必须是 Blob。')
  }
  try {
    const bytes = await blobToUint8Array(previewPng)
    return await requirePreviewApi().saveProjectPreview(bytes)
  } catch (error) {
    throw asPersistenceError(error, 'PREVIEW_EXPORT_FAILED')
  }
}

export async function deleteProjectPreviewRef(previewRef: string): Promise<void> {
  try {
    await requirePreviewApi().deleteProjectPreview(previewRef)
  } catch (error) {
    throw asPersistenceError(error, 'UNKNOWN')
  }
}

/** Best-effort cleanup that never throws (used after failed Dexie commits). */
export async function cleanupPreviewRef(previewRef: string | undefined): Promise<void> {
  if (!previewRef) return
  try {
    await deleteProjectPreviewRef(previewRef)
  } catch {
    // intentional swallow — caller already owns the primary failure
  }
}

export function previewBridgeError(error: unknown): SharedError {
  if (error instanceof PersistenceError) return error.shared
  return toSharedError(error, 'PREVIEW_EXPORT_FAILED')
}
