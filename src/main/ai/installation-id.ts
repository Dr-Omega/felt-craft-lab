import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const FILE_NAME = 'installation-id.json'

export function loadOrCreateInstallationId(aiDir: string): string {
  mkdirSync(aiDir, { recursive: true })
  const path = join(aiDir, FILE_NAME)
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { installationId?: unknown }
      if (typeof raw.installationId === 'string' && isUuid(raw.installationId)) {
        return raw.installationId.toLowerCase()
      }
    } catch {
      // recreate below
    }
  }
  const installationId = randomUUID().toLowerCase()
  writeFileSync(path, JSON.stringify({ installationId }, null, 2), 'utf8')
  return installationId
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  )
}
