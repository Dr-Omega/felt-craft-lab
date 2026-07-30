import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve runtime static assets for both development and packaged Windows builds.
 * Packaged builds place `assets/runtime` under `process.resourcesPath`.
 */
export function resolveRuntimeAssetPath(...segments: string[]): string {
  const candidates = [
    join(process.resourcesPath, 'assets', 'runtime', ...segments),
    join(app.getAppPath(), 'assets', 'runtime', ...segments),
    join(process.cwd(), 'assets', 'runtime', ...segments)
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}
