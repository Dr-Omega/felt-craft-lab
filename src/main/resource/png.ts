/** Standard PNG file signature (ISO 15948). */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export type PngBytesCheck =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: 'type' | 'empty' | 'too_large' | 'not_png' }

/**
 * Validate binary PNG bytes before any resource write. The caller supplies the
 * product-specific byte ceiling so Preview and Personal Asset can retain
 * separate limits without duplicating the binary/signature checks.
 */
export function parseTrustedPngBytes(raw: unknown, maxBytes: number): PngBytesCheck {
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
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'not_png' }
  }

  return { ok: true, bytes }
}
