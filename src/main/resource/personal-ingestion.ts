import { randomUUID } from 'node:crypto'
import { nativeImage } from 'electron'
import { encodedImageFormat } from '@shared/resource/image-format'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import type { SharedError } from '@shared/contracts'
import {
  buildPersonalAssetSourceRef,
  type PersonalAssetPngIngestRequest,
  type PersonalAssetPngIngestResult,
  type ResourceRoots
} from '@shared/resource'
import { toSharedError } from '@shared/contracts/error'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import { parseTrustedPngBytes } from './png'

export const MAX_PERSONAL_ASSET_PNG_BYTES = 16 * 1024 * 1024

function fail(code: SharedError['code'], message: string, retryable = false): PersonalAssetPngIngestResult {
  return { ok: false, error: toSharedError({ code, message, retryable }, code) }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIngestRequest(value: unknown): value is PersonalAssetPngIngestRequest {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === 3
    && keys[0] === 'personalAssetId'
    && keys[1] === 'pngBytes'
    && keys[2] === 'versionId'
    && typeof value.personalAssetId === 'string'
    && typeof value.versionId === 'string'
}

function sameBytes(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false
  return createHash('sha256').update(left).digest('hex') === createHash('sha256').update(right).digest('hex')
}

function atomicCreateImmutableFile(absolutePath: string, bytes: Buffer): 'created' | 'same' {
  if (existsSync(absolutePath)) {
    const current = readFileSync(absolutePath)
    if (sameBytes(current, bytes)) return 'same'
    throw new Error('immutable resource conflict')
  }

  const tempPath = join(dirname(absolutePath), `.source.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tempPath, bytes, { flag: 'wx' })
    // The destination is checked immediately before the atomic install. A
    // pre-existing destination is never intentionally overwritten.
    if (existsSync(absolutePath)) {
      const current = readFileSync(absolutePath)
      if (sameBytes(current, bytes)) return 'same'
      throw new Error('immutable resource conflict')
    }
    renameSync(tempPath, absolutePath)
    return 'created'
  } finally {
    try {
      unlinkSync(tempPath)
    } catch {
      // best-effort cleanup of a failed or already-renamed temp file
    }
  }
}

/** Opt-in original-image ingestion. The existing PNG-only API stays unchanged. */
export function ingestPersonalAssetImage(raw: unknown, roots: ResourceRoots): PersonalAssetPngIngestResult {
  if (!isPlainObject(raw) || Object.keys(raw).sort().join(',') !== 'imageBytes,personalAssetId,versionId' ||
      typeof raw.personalAssetId !== 'string' || typeof raw.versionId !== 'string') {
    return fail('INVALID_ARGUMENT', '原图写入参数无效。')
  }
  const input = raw.imageBytes
  const bytes = input instanceof ArrayBuffer ? Buffer.from(input)
    : input instanceof Uint8Array ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : undefined
  if (!bytes || !bytes.length || bytes.length > 10 * 1024 * 1024) return fail('INVALID_ARGUMENT', '原图必须为 10MB 以内的 PNG/JPEG 二进制。')
  const format = encodedImageFormat(bytes)
  if (!format) return fail('INVALID_ARGUMENT', '原图必须是 PNG 或 JPEG。')
  const ref = buildPersonalAssetSourceRef(raw.personalAssetId, raw.versionId, format)
  if (!ref) return fail('INVALID_ARGUMENT', '原图版本必须使用合法 UUID。')
  try {
    const decoded = nativeImage.createFromBuffer(bytes), { width, height } = decoded.getSize()
    if (decoded.isEmpty() || width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 16_000_000) {
      return fail('INVALID_ARGUMENT', '原图无法解码或尺寸超限。')
    }
  } catch { return fail('INVALID_ARGUMENT', '原图无法解码。') }
  // Decoding is validation only. Persist the exact encoded bytes, not decoded pixels.
  return persistSource(ref, bytes, roots)
}

/**
 * Main-only write plane for confirmed Personal Asset Version PNGs. The
 * resource is intentionally allowed to become orphaned if a later Dexie
 * transaction fails; deletion belongs to future reference-aware GC.
 */
export function ingestPersonalAssetPng(
  rawRequest: unknown,
  roots: ResourceRoots
): PersonalAssetPngIngestResult {
  if (!isIngestRequest(rawRequest)) {
    return fail('INVALID_ARGUMENT', '个人素材资源写入参数无效：只允许 personalAssetId、versionId 和二进制 pngBytes。')
  }

  const ref = buildPersonalAssetSourceRef(rawRequest.personalAssetId, rawRequest.versionId)
  if (!ref) return fail('INVALID_ARGUMENT', '个人素材资源写入参数必须使用合法 UUID。')

  const parsed = parseTrustedPngBytes(rawRequest.pngBytes, MAX_PERSONAL_ASSET_PNG_BYTES)
  if (!parsed.ok) {
    if (parsed.reason === 'too_large') return fail('INVALID_ARGUMENT', '个人素材 PNG 超过 16MB 大小上限。')
    if (parsed.reason === 'empty' || parsed.reason === 'not_png') return fail('INVALID_ARGUMENT', '个人素材资源必须是有效的 PNG 二进制数据。')
    return fail('INVALID_ARGUMENT', '个人素材资源必须通过二进制 pngBytes 传入。')
  }

  return persistSource(ref, parsed.bytes, roots)
}

function persistSource(ref: string, bytes: Buffer, roots: ResourceRoots): PersonalAssetPngIngestResult {
  try {
    mkdirSync(roots.personalRoot, { recursive: true })

    // Validate the unresolved destination before creating any descendant
    // directory. The resolver checks the nearest existing ancestor via
    // realpath, so symlink/junction escapes are rejected without mutation.
    const unresolved = resolveFeltResourcePath(ref, roots, { requireExists: false })
    if (!unresolved.ok) return { ok: false, error: unresolved.error }
    if (unresolved.kind !== 'personal') return fail('INVALID_ARGUMENT', '个人素材只能写入 personal 资源空间。')

    // Only create the parent path approved by the resolver; do not reconstruct
    // a descendant path from renderer-provided IDs after this point.
    mkdirSync(dirname(unresolved.absolutePath), { recursive: true })

    // Re-resolve after directory creation so the final parent remains inside
    // the trusted personal root before the atomic write.
    const confirmed = resolveFeltResourcePath(ref, roots, { requireExists: false })
    if (!confirmed.ok) return { ok: false, error: confirmed.error }
    if (confirmed.kind !== 'personal') return fail('INVALID_ARGUMENT', '个人素材只能写入 personal 资源空间。')

    // One immutable version cannot acquire a second source in another encoding.
    const otherPath = join(dirname(confirmed.absolutePath), ref.endsWith('.jpg') ? 'source.png' : 'source.jpg')
    if (existsSync(otherPath)) throw new Error('immutable resource conflict')
    atomicCreateImmutableFile(confirmed.absolutePath, bytes)
    return { ok: true, ref }
  } catch (error) {
    if (error instanceof Error && error.message === 'immutable resource conflict') {
      return fail('INVALID_ARGUMENT', 'Personal Asset Resource immutable conflict：同一版本的原图已存在且内容不同。')
    }
    return fail('UNKNOWN', '个人素材资源写入暂时无法完成，请稍后重试。', true)
  }
}
