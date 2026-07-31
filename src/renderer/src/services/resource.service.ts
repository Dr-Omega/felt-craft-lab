import type { ResourceInspectResult } from '@shared/resource'

/**
 * Renderer-facing resource helper. Boundary rules:
 * - Only pass ResourceRef strings
 * - Never construct absolute filesystem paths
 * - Prefer using the ResourceRef directly as img/audio src when protocol is registered
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
