import type { ResourceInspectResult } from '@shared/resource'

/**
 * Renderer-facing resource helper. Boundary rules:
 * - Only pass ResourceRef strings
 * - Never construct absolute filesystem paths
 * - Prefer fetch(ref)→blob for Fabric canvas to avoid tainting
 */
export async function inspectResource(ref: string): Promise<ResourceInspectResult> {
  if (!window.electronAPI?.inspectResource) {
    return {
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: '资源检查接口不可用，请在 Electron 中打开应用。',
        retryable: false
      }
    }
  }
  return window.electronAPI.inspectResource(ref)
}

/** Load a felt-resource image as a same-origin blob URL safe for canvas export. */
export async function loadResourceObjectUrl(ref: string): Promise<string> {
  const response = await fetch(ref)
  if (!response.ok) {
    throw new Error(`资源加载失败（${response.status}）`)
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
