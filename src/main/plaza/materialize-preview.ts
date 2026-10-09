import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFeltResourceRef } from '@shared/resource'
import type { ResourceRoots } from '@shared/resource'

/** Cache plaza media bytes under userData/previews/plaza-cache and return a felt-resource ref. */
export function materializePlazaPreviewBytes(
  bytes: Buffer,
  roots: ResourceRoots,
  mimeType: string
): string | undefined {
  const ext =
    mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/bmp' ? '.bmp' : '.png'
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
  const relativePath = `plaza-cache/${hash}${ext}`
  const cacheDir = join(roots.previewRoot, 'plaza-cache')
  mkdirSync(cacheDir, { recursive: true })
  const absolutePath = join(roots.previewRoot, ...relativePath.split('/'))
  if (!existsSync(absolutePath)) {
    writeFileSync(absolutePath, bytes)
  }
  return buildFeltResourceRef('preview', relativePath)
}
