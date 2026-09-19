/** Hard ceiling for a single project preview PNG (decoded bytes). */
export const MAX_PROJECT_PREVIEW_PNG_BYTES = 8 * 1024 * 1024

/** Standard PNG file signature (ISO 15948). */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export type PngBytesCheck =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: 'type' | 'empty' | 'too_large' | 'not_png' }

/**
 * Accept only ArrayBuffer / ArrayBufferView payloads from trusted Renderer IPC.
 * Rejects non-PNG signatures and oversized bodies before any disk write.
 */
export function parseTrustedPngBytes(raw: unknown): PngBytesCheck {
  let bytes: Buffer | undefined

  if (raw instanceof ArrayBuffer) {
    bytes = Buffer.from(raw)
  } else if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView
    bytes = Buffer.from(view.buffer, view.byteOffset, view.byteLength)
  } else if (Buffer.isBuffer(raw)) {
    bytes = raw
  }

  if (!bytes) return { ok: false, reason: 'type' }
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > MAX_PROJECT_PREVIEW_PNG_BYTES) return { ok: false, reason: 'too_large' }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'not_png' }
  }

  return { ok: true, bytes }
}
