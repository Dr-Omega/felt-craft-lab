import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import type { ResourceRef, SharedError } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { buildFeltResourceRef, parseFeltResourceRef } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceRoots } from '@shared/resource'
import { parseTrustedPngBytes } from './png'

export type PreviewSaveResult =
  | { ok: true; ref: ResourceRef }
  | { ok: false; error: SharedError }

export type PreviewDeleteResult = { ok: true } | { ok: false; error: SharedError }

export type PreviewReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: SharedError }

function fail(code: SharedError['code'], message: string, retryable = false): PreviewSaveResult {
  return {
    ok: false,
    error: toSharedError({ code, message, retryable }, code)
  }
}

function failDelete(code: SharedError['code'], message: string, retryable = false): PreviewDeleteResult {
  return {
    ok: false,
    error: toSharedError({ code, message, retryable }, code)
  }
}

function failRead(code: SharedError['code'], message: string, retryable = false): PreviewReadResult {
  return {
    ok: false,
    error: toSharedError({ code, message, retryable }, code)
  }
}

function atomicWritePng(absolutePath: string, bytes: Buffer): void {
  const tmp = `${absolutePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, bytes)
    renameSync(tmp, absolutePath)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // best-effort cleanup of temp
    }
    throw error
  }
}

/**
 * Write a unique preview PNG under userData/previews and return a felt-resource ref.
 * Never returns OS paths. Filename uses crypto.randomUUID() with hyphens stripped as a
 * project naming convention (underscores preferred); the resolver charset still allows `-`.
 */
export function savePreviewPng(rawBytes: unknown, roots: ResourceRoots): PreviewSaveResult {
  const parsed = parseTrustedPngBytes(rawBytes)
  if (!parsed.ok) {
    if (parsed.reason === 'too_large') {
      return fail('INVALID_ARGUMENT', '预览图超过允许的大小上限。')
    }
    if (parsed.reason === 'not_png' || parsed.reason === 'empty') {
      return fail('INVALID_ARGUMENT', '预览图必须是有效的 PNG 文件。')
    }
    return fail('INVALID_ARGUMENT', '预览图数据格式无效。')
  }

  // Prefer underscore-style names; not because the protocol forbids `-`.
  const fileName = `${randomUUID().replaceAll('-', '')}.png`
  const ref = buildFeltResourceRef('preview', fileName)
  if (!ref) {
    return fail('UNKNOWN', '无法生成预览资源引用。', true)
  }

  mkdirSync(roots.previewRoot, { recursive: true })

  const resolved = resolveFeltResourcePath(ref, roots, { requireExists: false })
  if (!resolved.ok) {
    return { ok: false, error: resolved.error }
  }
  if (resolved.kind !== 'preview') {
    return fail('INVALID_ARGUMENT', '预览只能写入 preview 资源空间。')
  }

  try {
    atomicWritePng(resolved.absolutePath, parsed.bytes)
  } catch {
    return fail('PREVIEW_EXPORT_FAILED', '预览图写入失败，请稍后重试。', true)
  }

  return { ok: true, ref }
}

/**
 * Delete a preview file identified only by a felt-resource://preview/... ref.
 * Rejects material/audio and any non-preview path. Never accepts OS paths.
 */
export function deletePreviewPng(rawRef: unknown, roots: ResourceRoots): PreviewDeleteResult {
  if (typeof rawRef !== 'string') {
    return failDelete('INVALID_ARGUMENT', '预览引用必须是字符串。')
  }

  const parsed = parseFeltResourceRef(rawRef)
  if (!parsed || parsed.kind !== 'preview') {
    return failDelete('INVALID_ARGUMENT', '只能删除合法的 felt-resource://preview/... 预览引用。')
  }

  const resolved = resolveFeltResourcePath(parsed.ref, roots, { requireExists: true })
  if (!resolved.ok) {
    return { ok: false, error: resolved.error }
  }
  if (resolved.kind !== 'preview') {
    return failDelete('INVALID_ARGUMENT', '不允许删除非 preview 资源。')
  }

  try {
    unlinkSync(resolved.absolutePath)
  } catch {
    return failDelete('UNKNOWN', '预览删除失败，请稍后重试。', true)
  }

  return { ok: true }
}

/**
 * Read a preview PNG identified only by a felt-resource://preview/... ref.
 * Accept candidates stay in preview space until the user accepts them.
 */
export function readPreviewPng(rawRef: unknown, roots: ResourceRoots): PreviewReadResult {
  if (typeof rawRef !== 'string') {
    return failRead('INVALID_ARGUMENT', '预览引用必须是字符串。')
  }

  const parsed = parseFeltResourceRef(rawRef)
  if (!parsed || parsed.kind !== 'preview') {
    return failRead('INVALID_ARGUMENT', '只能读取合法的 felt-resource://preview/... 预览图。')
  }

  const resolved = resolveFeltResourcePath(parsed.ref, roots, { requireExists: true })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (resolved.kind !== 'preview') {
    return failRead('INVALID_ARGUMENT', '不允许读取非 preview 资源。')
  }

  try {
    return { ok: true, bytes: readFileSync(resolved.absolutePath) }
  } catch {
    return failRead('UNKNOWN', '预览图读取失败，请稍后重试。', true)
  }
}
