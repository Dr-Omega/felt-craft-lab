import { getCurrentUserId } from '../services/plaza-session'
import { CATALOG_ASSETS, YWN_SNAPSHOT_ID } from '../catalog/ywn-catalog'
import { getFeltCraftDatabase } from '../persistence/db'
import { completedThemes, saveLearningCompletion } from './progress'
import type { LearningCompletion } from '@shared/learning'
import type { SceneDocument } from '@shared/contracts'
const celebrationFiles = import.meta.glob('../assets/learning-zone/celebrations/*.mp4', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

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
  if (!desktopApi) throw new Error('请在桌面程序中打开学习区。')
  const result = await desktopApi.request(path, {
    method: init?.method === 'POST' ? 'POST' : 'GET',
    body: typeof init?.body === 'string' ? init.body : undefined,
    snapshotId: YWN_SNAPSHOT_ID
  }) as { ok: boolean; status: number; payload: T & { error?: { code?: string; message?: string } } }
  if (!result.ok) throw new LearningZoneApiError(result.status, result.payload?.error?.code, result.payload?.error?.message)
  return result.payload
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

export function readGameSession(sessionId: string): Promise<GameSession> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}`)
}

export function submitGuidedStep(sessionId: string, stickerId: string, scene: SceneDocument, narratedAudio: string[]): Promise<{ allFinished: boolean }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/guide-step`, {
    method: 'POST', body: JSON.stringify({ stickerId, scene, narratedAudio })
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
  if (assetUrl.startsWith('/celebrations/')) {
    return celebrationFiles[`../assets/learning-zone/celebrations/${assetUrl.split('/').pop()}`] ?? ''
  }
  return assetUrl
}

export async function loadUnlockedThemeIds(): Promise<string[]> {
  return completedThemes(getFeltCraftDatabase(), getCurrentUserId(), YWN_SNAPSHOT_ID)
}

export async function saveUnlockedThemeId(themeId: string, sessionId: string): Promise<void> {
  const db = getFeltCraftDatabase()
  const receipt = await request<LearningCompletion>(`/api/sessions/${encodeURIComponent(sessionId)}/completion`)
  await saveLearningCompletion(db, receipt, { userId: getCurrentUserId(), themeId, sessionId, assetSnapshotId: YWN_SNAPSHOT_ID }, CATALOG_ASSETS)
}
