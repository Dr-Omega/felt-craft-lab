/**
 * Renderer-only, read-only projection of the adapter's runtime history.
 *
 * `revision` is an in-memory identity for the current Scene history entry.
 * It is deliberately not a SceneDocument field, persistence revision, or
 * project version.
 */
export interface EditorHistoryProjection {
  revision: number
  canUndo: boolean
  canRedo: boolean
}

export type EditorHistoryListener = (state: EditorHistoryProjection) => void
