import type { SharedError } from '../contracts/error'
import type { ResourceRef } from '../contracts/common'
import type { FeltResourceKind } from './constants'

export interface ParsedFeltResourceRef {
  ref: string
  kind: FeltResourceKind
  /** POSIX-style relative path under the kind root (no leading slash). */
  relativePath: string
}

export interface ResourceRoots {
  materialRoot: string
  /** Packaged / repo fixed audio under assets/generated/audio */
  audioRoot: string
  /**
   * Dynamic TTS cache under Electron userData/audio.
   * Paths like felt-resource://audio/dynamic/<hash>.mp3 resolve here.
   */
  audioDynamicRoot: string
  previewRoot: string
  /** User-owned Personal Asset PNGs under Electron userData/personal-assets. */
  personalRoot: string
}

export type FeltResourceResolveSuccess = {
  ok: true
  ref: string
  kind: FeltResourceKind
  relativePath: string
  /** Main-process only. Never send absolute paths across Preload/Renderer. */
  absolutePath: string
  exists: boolean
}

export type FeltResourceResolveFailure = {
  ok: false
  error: SharedError
}

export type FeltResourceResolveResult = FeltResourceResolveSuccess | FeltResourceResolveFailure

/** Renderer-safe inspect payload: never includes OS paths. */
export type ResourceInspectSuccess = {
  ok: true
  ref: string
  kind: FeltResourceKind
  relativePath: string
  exists: boolean
}

export type ResourceInspectFailure = {
  ok: false
  error: SharedError
}

export type ResourceInspectResult = ResourceInspectSuccess | ResourceInspectFailure

export interface PersonalAssetPngIngestRequest {
  personalAssetId: string
  versionId: string
  pngBytes: ArrayBuffer | Uint8Array
}

export type PersonalAssetPngIngestResult =
  | { ok: true; ref: ResourceRef }
  | { ok: false; error: SharedError }
