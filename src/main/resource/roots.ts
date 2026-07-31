import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ResourceRoots } from '@shared/resource'

function firstExisting(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

/**
 * Resolve filesystem roots for felt-resource kinds.
 * - material/audio: packaged under process.resourcesPath/assets/generated; dev under cwd
 * - preview: always under Electron userData (writable across installers)
 */
export function createResourceRoots(): ResourceRoots {
  const cwdGenerated = join(process.cwd(), 'assets', 'generated')
  const resourcesGenerated = join(process.resourcesPath, 'assets', 'generated')
  const appGenerated = join(app.getAppPath(), 'assets', 'generated')

  const materialRoot = firstExisting(
    join(resourcesGenerated, 'material'),
    join(appGenerated, 'material'),
    join(cwdGenerated, 'material')
  )
  const audioRoot = firstExisting(
    join(resourcesGenerated, 'audio'),
    join(appGenerated, 'audio'),
    join(cwdGenerated, 'audio')
  )

  const previewRoot = join(app.getPath('userData'), 'previews')
  mkdirSync(previewRoot, { recursive: true })

  return { materialRoot, audioRoot, previewRoot }
}
