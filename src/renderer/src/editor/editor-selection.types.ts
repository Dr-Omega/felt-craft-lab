/**
 * Renderer-only, read-only selection projection. This deliberately contains
 * plain logical Canvas data and never exposes Fabric, DOM, Scene, or resource
 * references across the application boundary.
 */
export interface EditorSelectionBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface EditorSelectionProjection {
  objectId: string
  bounds: EditorSelectionBounds
}

export type EditorSelectionEvent =
  | { type: 'selected'; selection: EditorSelectionProjection }
  | { type: 'geometry'; selection: EditorSelectionProjection }
  | { type: 'double-click'; selection: EditorSelectionProjection }
  | { type: 'cleared'; selection: null }

export type EditorSelectionListener = (event: EditorSelectionEvent) => void
