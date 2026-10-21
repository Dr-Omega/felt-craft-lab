import { encodedImageFormat } from '@shared/resource/image-format'

/** Local image bytes, not a network request: connect-src intentionally excludes data:. */
export function decodePngDataUrl(src: string): Uint8Array {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(src)
  if (!match) throw new Error('图片不是有效的 PNG，请重新准备图片。')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(match[1]), value => value.charCodeAt(0)) }
  catch { throw new Error('PNG 图片无法解码，请重新准备图片。') }
  if (encodedImageFormat(bytes) !== 'png') throw new Error('图片内容不是有效的 PNG。')
  return bytes
}
