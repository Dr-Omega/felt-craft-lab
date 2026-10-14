import fs from 'node:fs'
import path from 'node:path'

const src = String.raw`C:\Users\xingx\Desktop\lll`
const dest = path.resolve('assets/ui/bear-home')
const lobbyDest = path.resolve('assets/ui/lobby/bear-home-tip.png')

fs.mkdirSync(dest, { recursive: true })

const map = [
  { includes: '大背景', out: 'background-base.png' },
  { exact: '小熊的家1.png', out: 'room-default.png' },
  { includes: '替换小熊', out: 'room-sofa.png' },
  { includes: '背景边框', out: 'frame-overlay.png' },
  { exact: '沙发范围.png', out: 'sofa-hit-reference.png' },
  { exact: '小熊的家按钮.png', out: null, lobby: true }
]

for (const name of fs.readdirSync(src)) {
  if (!name.endsWith('.png')) continue
  for (const rule of map) {
    const hit = rule.exact ? name === rule.exact : name.includes(rule.includes)
    if (!hit) continue
    const from = path.join(src, name)
    if (rule.lobby) fs.copyFileSync(from, lobbyDest)
    else fs.copyFileSync(from, path.join(dest, rule.out))
    console.log('copied', name, '->', rule.out ?? 'lobby tip')
  }
}

function bbox(file) {
  const buf = fs.readFileSync(file)
  if (buf[0] !== 0x89) throw new Error('not png')
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + len
  }
  return { width, height, idatChunks: idat.length }
}

const ref = path.join(dest, 'sofa-hit-reference.png')
if (fs.existsSync(ref)) {
  const { width, height } = bbox(ref)
  console.log('sofa-ref-size', width, height)
}
