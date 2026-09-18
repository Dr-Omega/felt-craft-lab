/** M0: protect original untracked B2 bytes using an isolated index and a local Git ref.
 * Does not change HEAD, the normal index, Git configuration, or any source file.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const baseline = '90a92ae1853ce07308238a70f9301fa148821b66'
const ref = 'refs/tags/b2-v0-original-bytes-m0'
const manifestPath = 'docs/fabrication/evidence/m0-original-bytes.json'
const git = (args, options = {}) => execFileSync('git', args, { ...options, maxBuffer: 32 * 1024 * 1024 })
const head = git(['rev-parse', 'HEAD']).toString().trim()
if (head !== baseline) throw new Error('Unexpected HEAD; preservation must start at the audited baseline')
if (git(['diff', '--name-only']).length || git(['diff', '--cached', '--name-only']).length) {
  throw new Error('Tracked changes or staged changes exist; refusing to include them')
}
try { git(['rev-parse', '--verify', ref], { stdio: ['pipe', 'pipe', 'ignore'] }); throw new Error('Snapshot already exists') }
catch (error) { if (error.status !== 128) throw error }
const permitted = path => path.startsWith('benchmarks/fabrication-layer-decomposition/fabrication-decomposition/')
  || ['PROJECT_REAL_B2_GT_REVIEW_PACK_V2.zip', 'build_b2_gt_review_pack.py', 'build_b2_gt_review_pack_v2.py', 'run_b2_v0.py', 'validate_b2_v0.py']
    .some(name => path === name || path === `benchmarks/fabrication-layer-decomposition/tools/${name}`)
const paths = git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(p => p && permitted(p)).sort()
if (!paths.length) throw new Error('No original B2 artifacts found')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const records = paths.map(path => {
  if (/[\t\r\n]/.test(path)) throw new Error('Unsupported path encoding')
  const bytes = readFileSync(path)
  const blob = git(['hash-object', '-w', '--no-filters', '--stdin'], { input: bytes }).toString().trim()
  if (!git(['cat-file', 'blob', blob]).equals(bytes)) throw new Error(`Blob byte mismatch: ${path}`)
  return { path, sizeBytes: bytes.length, sha256: sha256(bytes), gitBlob: blob, identityMode: 'EXACT_BYTES' }
})
const upstream = git(['ls-files', '-z', 'benchmarks/fabrication-layer-decomposition']).toString().split('\0').filter(Boolean).sort()
  .map(path => ({ path, sha256: sha256(readFileSync(path)) }))
const manifest = { schemaVersion: '1.0.0', baselineCommit: baseline, protectionRef: ref,
  scope: 'Original untracked B2 V0, outputs and both unreviewed review packs; not a production freeze',
  fileCount: records.length, totalBytes: records.reduce((n, r) => n + r.sizeBytes, 0), files: records, protectedUpstream: upstream }
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
const manifestBlob = git(['hash-object', '-w', '--no-filters', '--stdin'], { input: manifestBytes }).toString().trim()
const indexDirectory = mkdtempSync(join(tmpdir(), 'b2-m0-index-'))
const env = { ...process.env, GIT_INDEX_FILE: join(indexDirectory, 'index') }
git(['read-tree', baseline], { env })
git(['update-index', '--index-info'], { env, input: [...records.map(r => `100644 ${r.gitBlob}\t${r.path}`), `100644 ${manifestBlob}\t${manifestPath}`].join('\n') + '\n' })
const tree = git(['write-tree'], { env }).toString().trim()
const commit = git(['commit-tree', tree, '-p', baseline], { input: 'preserve: snapshot original B2 V0 exact bytes before M1\n' }).toString().trim()
git(['update-ref', ref, commit, '0000000000000000000000000000000000000000'])
for (const row of records) {
  const snapshot = git(['cat-file', 'blob', `${ref}:${row.path}`])
  if (sha256(snapshot) !== row.sha256 || sha256(readFileSync(row.path)) !== row.sha256) throw new Error(`Preservation mismatch: ${row.path}`)
}
if (git(['rev-parse', 'HEAD']).toString().trim() !== baseline) throw new Error('HEAD unexpectedly changed')
mkdirSync(resolve('docs/fabrication/evidence'), { recursive: true })
writeFileSync(manifestPath, manifestBytes, { flag: 'wx' })
console.log(JSON.stringify({ status: 'EXACT_BYTES_PROTECTED', ref, commit, files: records.length,
  bytes: manifest.totalBytes, upstreamFiles: upstream.length, manifestPath, headUnchanged: true }, null, 2))
