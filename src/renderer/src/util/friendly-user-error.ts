function isSharedError(error: unknown): error is { message?: string; code?: string } {
  return Boolean(error && typeof error === 'object' && 'message' in error)
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim()
  }
  if (isSharedError(error) && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

/** True for IndexedDB / Dexie glitches that often clear on a quick retry. */
export function isTransientDbError(error: unknown): boolean {
  const text = errorText(error).toLowerCase()
  return /unknownerror|internal error|database/i.test(text)
    || (error instanceof DOMException && error.name === 'UnknownError')
}

/**
 * Map runtime failures to child-friendly copy. Never surface raw IndexedDB /
 * Dexie / provider internals in the UI.
 */
export function friendlyUserError(error: unknown): string {
  if (isSharedError(error) && typeof error.message === 'string' && error.message.trim()) {
    const shared = error.message.trim()
    if (shared.length < 120 && !/\[object object\]/i.test(shared)) {
      return shared
    }
  }
  const text = errorText(error)
  const combined = text.toLowerCase()

  if (isTransientDbError(error)) {
    return '本地存储暂时有点忙，请稍后再试。'
  }
  if (/quota|storage full|disk full/i.test(combined)) {
    return '存储空间不太够了，请清理一些旧作品后再试。'
  }
  if (/snapshot|registry|assetsnapshot|asset_snapshot/i.test(combined)) {
    return '有些以前用过的素材暂时找不到啦，这件作品先不能继续保存。'
  }
  if (/locked|unlock|解锁/i.test(combined)) {
    return '这个素材还没有解锁，先看看别的吧。'
  }
  if (/save|draft|project|preview|project_save|draft_save/i.test(combined)) {
    return '这次还没有收好作品，请稍后再试。'
  }

  const trimmed = text.trim()
  if (
    trimmed.length > 0
    && trimmed.length < 80
    && !/error|unknown|internal|exception|failed|invalid|dexie|indexeddb|database/i.test(trimmed.toLowerCase())
  ) {
    return trimmed
  }

  return '刚刚遇到一点小问题，请稍后再试。'
}

/** Retry once when IndexedDB throws a transient UnknownError. */
export async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!isTransientDbError(error)) throw error
    await new Promise((resolve) => window.setTimeout(resolve, 150))
    return operation()
  }
}
