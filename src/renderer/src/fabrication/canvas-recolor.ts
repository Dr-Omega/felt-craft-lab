import type { PersonalAssetRecord, PersonalAssetVersionRecord } from '@shared/contracts'
import type { LayerColors, SceneBinding } from '@shared/fabrication-colors'
import { getFeltCraftDatabase, PersonalAssetStore, PersonalAssetVersionStore } from '../persistence'

export interface CanvasRecolorLink {
  versionId: string; jobId: string; sourceSha256: string; binding: SceneBinding | null; colors: LayerColors; ownerUserId: string
}
export function readCanvasRecolorLink(versionId: string): CanvasRecolorLink | undefined {
  const raw = localStorage.getItem(`felt-recolor-version:${versionId}`)
  if (!raw) return
  const link = JSON.parse(raw) as CanvasRecolorLink
  if (link.versionId !== versionId || !link.jobId || !link.sourceSha256 || !link.ownerUserId || !link.colors) throw new Error('已保存的图层关联不完整。')
  return link
}
/** Reuse existing immutable Personal Asset ingestion and Scene version pins. Never overwrite catalog images. */
export async function persistCanvasRecolor(png: string, link: Omit<CanvasRecolorLink, 'versionId'>, role: 'element' | 'core_pattern') {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(png)
  if (!match) throw new Error('换色结果必须为 PNG。')
  const personalAssetId = crypto.randomUUID(), versionId = crypto.randomUUID(), now = new Date().toISOString()
  const pngBytes = Uint8Array.from(atob(match[1]), value => value.charCodeAt(0))
  const sourceImageRef = await window.electronAPI.ingestPersonalAssetPng({ personalAssetId, versionId, pngBytes })
  const version: PersonalAssetVersionRecord = { versionId, personalAssetId, versionNumber: 1, sourceImageRef, parentVersionId: null, createdAt: now }
  const asset: PersonalAssetRecord = { personalAssetId, currentVersionId: versionId, userId: link.ownerUserId,
    role, sourceType: 'hand_drawn', name: '图层换色', createdAt: now, updatedAt: now }
  const db = getFeltCraftDatabase()
  await db.transaction('rw', db.personalAssets, db.personalAssetVersions, async () => {
    await new PersonalAssetVersionStore(db).save(version)
    await new PersonalAssetStore(db).save(asset)
  })
  // Link is keyed by immutable version, not object ID or current scene order. Undo pins the older version.
  localStorage.setItem(`felt-recolor-version:${versionId}`, JSON.stringify({ ...link, versionId }))
  return { asset, version }
}
