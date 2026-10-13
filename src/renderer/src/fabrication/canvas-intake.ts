import type { PersonalAssetRecord, PersonalAssetVersionRecord } from '@shared/contracts'
import { encodedImageFormat } from '@shared/resource/image-format'
import { getFeltCraftDatabase, PersonalAssetStore, PersonalAssetVersionStore } from '../persistence'

export function validateImageIntake(type: string, bytes: number, width?: number, height?: number): void {
  if (!['image/png', 'image/jpeg'].includes(type)) throw new Error('请选择 PNG 或 JPEG 图片。')
  if (bytes <= 0 || bytes > 10 * 1024 * 1024) throw new Error('图片需要在 10MB 以内，且不能是空文件。')
  if (width !== undefined && height !== undefined && (!(width > 0 && height > 0) || width > 4096 || height > 4096 || width * height > 16_000_000)) {
    throw new Error('图片尺寸过大，请选择不超过 4096 边长、1600 万像素的图片。')
  }
}
/** Decode only to validate. Preserve the uploaded file bytes, including JPEG encoding. */
export async function normalizeCanvasUpload(file: File): Promise<Uint8Array> {
  validateImageIntake(file.type, file.size)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image(); image.src = url
    try { await image.decode() } catch { throw new Error('图片无法解码，请重新选择有效图片。') }
    validateImageIntake(file.type, file.size, image.naturalWidth, image.naturalHeight)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (encodedImageFormat(bytes) !== (file.type === 'image/jpeg' ? 'jpg' : 'png')) throw new Error('图片格式与文件类型不一致。')
    return bytes
  } finally { URL.revokeObjectURL(url) }
}
export async function persistCanvasInput(imageBytes: Uint8Array, name: string, userId: string, sourceType: 'uploaded' | 'ai_generated') {
  const format = encodedImageFormat(imageBytes)
  validateImageIntake(format === 'jpg' ? 'image/jpeg' : format === 'png' ? 'image/png' : '', imageBytes.byteLength)
  const personalAssetId = crypto.randomUUID(), versionId = crypto.randomUUID(), now = new Date().toISOString()
  const sourceImageRef = await window.electronAPI.ingestPersonalAssetImage({ personalAssetId, versionId, imageBytes })
  const version: PersonalAssetVersionRecord = { versionId, personalAssetId, versionNumber: 1, sourceImageRef, parentVersionId: null, createdAt: now }
  const asset: PersonalAssetRecord = { personalAssetId, currentVersionId: versionId, name: name.slice(0, 100) || '我的图片',
    userId, role: 'element', sourceType, createdAt: now, updatedAt: now }
  const db = getFeltCraftDatabase()
  await db.transaction('rw', db.personalAssets, db.personalAssetVersions, async () => {
    await new PersonalAssetVersionStore(db).save(version); await new PersonalAssetStore(db).save(asset)
  })
  return { asset, version }
}
