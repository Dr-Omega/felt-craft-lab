import type { SharedError } from '../contracts/error'
import type { FeltResourceKind } from './constants'

export interface ParsedFeltResourceRef {
  ref: string
  kind: FeltResourceKind
  /** POSIX-style relative path under the kind root (no leading slash). */
  relativePath: string
}

export interface ResourceRoots {
  materialRoot: string
  audioRoot: string
  previewRoot: string
}

export type FeltResourceResolveSuccess = {
  ok: true
  ref: string
  kind: FeltResourceKind
  relativePath: string
  absolutePath: string
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
