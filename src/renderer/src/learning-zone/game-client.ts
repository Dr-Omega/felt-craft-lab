const API_URL = import.meta.env.VITE_LEARNING_ZONE_API_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3000'
const PROGRESS_KEY = 'felt-craft-learning-zone-progress-v1'

export type NarrationAudio = { type: 'nameZh' | 'nameEn' | 'introZh'; assetUrl: string }
export type GameSticker = {
  stickerId: string
  name: string
  stickerAssetUrl: string
  narrationAudio: NarrationAudio[]
  targetArea: { minX: number; minY: number; maxX: number; maxY: number }
  tolerance: number
  placeholder: { x: number; y: number; width: number; height: number; outlineAssetUrl?: string }
  isCompleted: boolean
}

export type GameSession = {
  playSessionId: string
  level: {
    levelId: string
    themeId: string
    backgroundAssetUrl: string
    canvasBounds: { minX: number; minY: number; maxX: number; maxY: number }
    stickers: GameSticker[]
  }
  allFinished: boolean
  celebration: { assetUrl: string } | null
}

type LevelSummary = { levelId: string; themeId: string }
type StoredProgress = { unlockedThemeIds: string[] }

export class LearningZoneApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    message?: string
  ) {
    super(message ?? `学习区服务请求失败：${status}`)
    this.name = 'LearningZoneApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const desktopApi = window.electronAPI?.learningZone
  if (desktopApi) {
    const result = await desktopApi.request(path, {
      method: init?.method === 'POST' ? 'POST' : 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined
    }) as { ok: boolean; status: number; payload: T & { error?: { code?: string; message?: string } } }
    if (!result.ok) {
      throw new LearningZoneApiError(result.status, result.payload?.error?.code, result.payload?.error?.message)
    }
    return result.payload
  }
  const response = await fetch(`${API_URL}${path}`, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    throw new LearningZoneApiError(response.status, payload?.error?.code, payload?.error?.message)
  }
  return response.json() as Promise<T>
}

export async function createGameSession(themeId: string): Promise<GameSession> {
  const { levels } = await request<{ levels: LevelSummary[] }>('/api/levels')
  const level = levels.find((item) => item.themeId === themeId)
  if (!level) throw new Error('当前主题暂未配置解锁关卡。')
  return request<GameSession>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ levelId: level.levelId })
  })
}

export async function submitPlacement(playSessionId: string, stickerId: string, x: number, y: number): Promise<{
  success: boolean
  allFinished: boolean
  justFinished: boolean
  celebration: { assetUrl: string } | null
}> {
  return request(`/api/sessions/${encodeURIComponent(playSessionId)}/placements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stickerId, x, y })
  })
}

export function gameResourceUrl(assetUrl: string): string {
  if (window.electronAPI) {
    if (assetUrl.startsWith('/assets/material/')) {
      return `felt-resource://material/${assetUrl.slice('/assets/material/'.length)}`
    }
    if (assetUrl.startsWith('/assets/audio/')) {
      return `felt-resource://audio/${assetUrl.slice('/assets/audio/'.length)}`
    }
    if (assetUrl.startsWith('/celebrations/')) {
      return `felt-resource://celebration/${assetUrl.slice('/celebrations/'.length)}`
    }
  }
  return assetUrl.startsWith('/') ? `${API_URL}${assetUrl}` : assetUrl
}

export function loadUnlockedThemeIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Partial<StoredProgress>
    return Array.isArray(value.unlockedThemeIds) ? value.unlockedThemeIds : []
  } catch {
    return []
  }
}

export function saveUnlockedThemeId(themeId: string): void {
  const unlockedThemeIds = new Set(loadUnlockedThemeIds())
  unlockedThemeIds.add(themeId)
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({ unlockedThemeIds: [...unlockedThemeIds] } satisfies StoredProgress))
}
