/** Determine the encoded format; never infer RGB/alpha semantics from pixel values. */
export function encodedImageFormat(bytes: Uint8Array): 'png' | 'jpg' | undefined {
  const png = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length >= png.length && png.every((byte, i) => bytes[i] === byte)) return 'png'
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  return undefined
}
