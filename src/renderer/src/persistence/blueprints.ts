import type { ProjectRecord } from '@shared/contracts'
import type { SubjectSizeChoice } from '../projection/subject-size'
import { getFeltCraftDatabase, type FeltCraftDatabase } from './db'
import { ProjectStore } from './stores'
import { CUTTING_PRINT_REVISION } from '../projection/print-settings'

/** A local generated artifact, not a new editable project or a cloud sync row. */
export interface BlueprintRecord {
  projectId: string
  userId: string
  sceneSignature: string
  exportedAt: string
  backgroundMode: 'layers' | 'image'
  size: SubjectSizeChoice
  thumbnail: string
  pdf: Blob
  /** Missing on pre-safe-margin exports; keep their history but require re-export. */
  printRevision?: string
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
const sceneText = (work: ProjectRecord) => JSON.stringify(canonical(work.scene))
export async function blueprintSceneSignature(work: ProjectRecord): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sceneText(work)))
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export class BlueprintStore {
  constructor(private readonly db: FeltCraftDatabase = getFeltCraftDatabase()) {}

  async save(work: ProjectRecord, artifact: Pick<BlueprintRecord, 'backgroundMode' | 'size' | 'thumbnail' | 'pdf'>): Promise<BlueprintRecord> {
    if (!artifact.thumbnail.startsWith('data:image/png;base64,') || !artifact.pdf.size || artifact.pdf.type !== 'application/pdf') {
      throw new Error('图纸文件或首张缩略图无效。')
    }
    const captured = sceneText(work)
    const record: BlueprintRecord = { ...artifact, size:structuredClone(artifact.size), projectId:work.projectId,
      userId:work.scene.userId, sceneSignature:await blueprintSceneSignature(work), exportedAt:new Date().toISOString(), printRevision:CUTTING_PRINT_REVISION }
    await this.db.transaction('rw', this.db.projects, this.db.blueprints, async () => {
      const current = await new ProjectStore(this.db).get(work.projectId)
      if (!current || current.scene.userId !== record.userId || sceneText(current) !== captured) {
        throw new Error('作品已更新或不存在，请重新打开作品准备图纸。')
      }
      await this.db.blueprints.put(record)
    })
    return record
  }

  async getForWork(work: ProjectRecord): Promise<BlueprintRecord | undefined> {
    const row = await this.db.blueprints.get(work.projectId)
    return row?.userId === work.scene.userId && row.sceneSignature === await blueprintSceneSignature(work) ? row : undefined
  }

  async listForWorks(userId: string, works: ProjectRecord[]): Promise<BlueprintRecord[]> {
    const rows = await this.db.blueprints.where('userId').equals(userId).toArray()
    const signatures = new Map(await Promise.all(works.filter(work => work.scene.userId === userId)
      .map(async work => [work.projectId, await blueprintSceneSignature(work)] as const)))
    return rows.filter(row => signatures.get(row.projectId) === row.sceneSignature)
  }
}
