/**
 * Dev helper: copy placeholder PNGs for every felt-resource://material/... entry
 * in the bundled snapshot manifest when real YWN pack media is not present.
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const manifestPath = path.join(
  root,
  'src/renderer/src/catalog/snapshots/snapshot_ywn_20260805_112922.manifest.json'
)
const materialRoot = path.join(root, 'assets/generated/material')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const backgroundSource = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Desktop', '1111.png')
const stickerSource = process.argv[3] || backgroundSource

if (!fs.existsSync(backgroundSource)) {
  console.error(`Missing placeholder source: ${backgroundSource}`)
  process.exit(1)
}

const materialRefs = new Set()
for (const asset of manifest.assets) {
  for (const key of ['imageUrl', 'thumbnailUrl', 'preSplitUrl']) {
    const url = asset[key]
    if (typeof url === 'string' && url.startsWith('felt-resource://material/')) {
      materialRefs.add(url.replace('felt-resource://material/', ''))
    }
  }
}

let created = 0
for (const relativePath of materialRefs) {
  const target = path.join(materialRoot, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const source = relativePath.includes('background') ? backgroundSource : stickerSource
  if (!fs.existsSync(target)) created += 1
  fs.copyFileSync(source, target)
}

// Smoke-test fixtures at material root
for (const name of ['mock-background.png', 'mock-sticker.png']) {
  const target = path.join(materialRoot, name)
  if (!fs.existsSync(target)) {
    fs.copyFileSync(backgroundSource, target)
    created += 1
  }
}

console.log(`[seed-dev-material-fixtures] wrote ${materialRefs.size} material file(s); ${created} newly created`)
