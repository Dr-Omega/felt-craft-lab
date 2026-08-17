/** Hard ceiling for a single project preview PNG (decoded bytes). */
export const MAX_PROJECT_PREVIEW_PNG_BYTES = 8 * 1024 * 1024

import { parseTrustedPngBytes as parsePngBytes, PNG_SIGNATURE, type PngBytesCheck } from '../resource/png'

export { PNG_SIGNATURE }
export type { PngBytesCheck }

/**
 * Accept only ArrayBuffer / ArrayBufferView payloads from trusted Renderer IPC.
 * Rejects non-PNG signatures and oversized bodies before any disk write.
 */
export function parseTrustedPngBytes(raw: unknown): PngBytesCheck {
  return parsePngBytes(raw, MAX_PROJECT_PREVIEW_PNG_BYTES)
}
