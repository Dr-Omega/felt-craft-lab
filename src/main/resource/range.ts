export type FeltResourceByteRange = {
  start: number
  end: number
}

/** Parses one byte range against a known file size. */
export function parseFeltResourceByteRange(
  value: string | null,
  fileSize: number
): FeltResourceByteRange | undefined | null {
  if (value === null) return undefined
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match) return null

  const [, startText, endText] = match
  if (!startText && !endText) return null

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(fileSize - suffixLength, 0), end: fileSize - 1 }
  }

  const start = Number(startText)
  if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize) return null
  if (!endText) return { start, end: fileSize - 1 }

  const end = Number(endText)
  if (!Number.isSafeInteger(end) || end < start) return null
  return { start, end: Math.min(end, fileSize - 1) }
}
