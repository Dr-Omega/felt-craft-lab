/** Read-only exact-byte verification; intentionally NOT the portable runtime identity policy. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('docs/fabrication/evidence/m0-original-bytes.json', 'utf8'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
for (const entry of manifest.files) {
  const bytes = readFileSync(entry.path)
  if (bytes.length !== entry.sizeBytes || digest(bytes) !== entry.sha256) throw Error(`Worktree bytes changed: ${entry.path}`)
  const blob = execFileSync('git', ['cat-file', 'blob', entry.gitBlob], { maxBuffer: 128 * 1024 * 1024 })
  if (digest(blob) !== entry.sha256) throw Error(`Protected blob mismatch: ${entry.path}`)
}
for (const entry of manifest.protectedUpstream) {
  if (digest(readFileSync(entry.path)) !== entry.sha256) throw Error(`Frozen upstream changed: ${entry.path}`)
}
console.log(JSON.stringify({ status: 'PASS', originalFiles: manifest.files.length, upstreamFiles: manifest.protectedUpstream.length }))
