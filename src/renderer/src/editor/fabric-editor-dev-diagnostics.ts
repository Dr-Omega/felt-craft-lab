import { fabric } from 'fabric'
import type { EditorSessionState } from './editor-session.types'
import type { FabricCanvasPort, FabricObjectPort, SceneRecoveryIssue } from './fabric-editor-adapter'

const LOG_PREFIX = '[fabric-dev-diag]'

export interface FabricObjectDiagnostic {
  exists: boolean
  objectId?: string
  assetId?: string
  type?: string
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  left?: number
  top?: number
  selectable?: boolean
  evented?: boolean
  visible?: boolean
  angle?: number
  originX?: string
  originY?: string
  imageElement?: ImageElementDiagnostic
}

export interface ImageElementDiagnostic {
  present: boolean
  complete?: boolean
  naturalWidth?: number
  naturalHeight?: number
  currentSrc?: string
  decodeError?: string
}

export interface ResourceFetchDiagnostic {
  ref: string
  ok: boolean
  status?: number
  statusText?: string
  contentType?: string | null
  blobSize?: number
  decode?: ImageElementDiagnostic
  error?: string
}

export interface CanvasLayerDiagnostic {
  selector: string
  found: boolean
  widthAttr?: number
  heightAttr?: number
  styleWidth?: string
  styleHeight?: string
  rectWidth?: number
  rectHeight?: number
  rectLeft?: number
  rectTop?: number
}

export interface CanvasDomDiagnostic {
  hostCanvas: CanvasLayerDiagnostic
  lowerCanvas: CanvasLayerDiagnostic
  upperCanvas: CanvasLayerDiagnostic
  logicWidth: number
  logicHeight: number
  layersMatchLogic: boolean
}

export interface SessionFabricDiagnostic {
  sessionStatus: EditorSessionState['status']
  pendingOperations: number
  recoveryIssues: readonly SceneRecoveryIssue[]
  objectCount: number
  activeObject: FabricObjectDiagnostic
}

export interface FabricDevDiagnosticReport {
  label: string
  timestamp: string
  session: SessionFabricDiagnostic
  canvasDom: CanvasDomDiagnostic
  resource?: ResourceFetchDiagnostic
}

export interface DevDeleteDiagnostic {
  beforeObjectCount: number
  afterObjectCount: number
  error?: string
  stack?: string
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readImageElement(image: fabric.Image | undefined): ImageElementDiagnostic {
  if (!image) return { present: false }
  const element = (image as fabric.Image & { _element?: HTMLImageElement })._element
    ?? (typeof image.getElement === 'function' ? image.getElement() : undefined)
  if (!(element instanceof HTMLImageElement)) return { present: false }
  return {
    present: true,
    complete: element.complete,
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
    currentSrc: element.currentSrc || element.src
  }
}

export function serializeFabricObject(object: FabricObjectPort | fabric.Object | null | undefined): FabricObjectDiagnostic {
  if (!object) return { exists: false }
  const raw = object as FabricObjectPort & fabric.Object
  const diagnostic: FabricObjectDiagnostic = {
    exists: true,
    objectId: raw.objectId,
    assetId: raw.assetId,
    type: raw.type,
    width: finite(raw.width),
    height: finite(raw.height),
    scaleX: finite(raw.scaleX),
    scaleY: finite(raw.scaleY),
    left: finite(raw.left),
    top: finite(raw.top),
    selectable: raw.selectable,
    evented: raw.evented,
    visible: raw.visible,
    angle: finite(raw.angle),
    originX: typeof raw.originX === 'string' ? raw.originX : undefined,
    originY: typeof raw.originY === 'string' ? raw.originY : undefined
  }
  if (raw.type === 'image') diagnostic.imageElement = readImageElement(raw as fabric.Image)
  return diagnostic
}

function readCanvasLayer(element: Element | null | undefined, selector: string): CanvasLayerDiagnostic {
  if (!(element instanceof HTMLCanvasElement)) {
    return { selector, found: false }
  }
  const rect = element.getBoundingClientRect()
  return {
    selector,
    found: true,
    widthAttr: element.width,
    heightAttr: element.height,
    styleWidth: element.style.width,
    styleHeight: element.style.height,
    rectWidth: rect.width,
    rectHeight: rect.height,
    rectLeft: rect.left,
    rectTop: rect.top
  }
}

export function inspectCanvasDom(hostCanvas: HTMLCanvasElement, canvas: FabricCanvasPort): CanvasDomDiagnostic {
  const container = hostCanvas.closest('.canvas-container') ?? hostCanvas.parentElement
  const lower = container?.querySelector('.lower-canvas')
  const upper = container?.querySelector('.upper-canvas')
  const logicWidth = canvas.getWidth()
  const logicHeight = canvas.getHeight()

  const host = readCanvasLayer(hostCanvas, 'host-canvas')
  const lowerLayer = readCanvasLayer(lower, 'lower-canvas')
  const upperLayer = readCanvasLayer(upper, 'upper-canvas')

  const layersMatchLogic =
    host.found &&
    lowerLayer.found &&
    upperLayer.found &&
    host.widthAttr === logicWidth &&
    host.heightAttr === logicHeight &&
    lowerLayer.widthAttr === logicWidth &&
    lowerLayer.heightAttr === logicHeight &&
    upperLayer.widthAttr === logicWidth &&
    upperLayer.heightAttr === logicHeight

  return {
    hostCanvas: host,
    lowerCanvas: lowerLayer,
    upperCanvas: upperLayer,
    logicWidth,
    logicHeight,
    layersMatchLogic
  }
}

async function decodeBlob(blob: Blob): Promise<ImageElementDiagnostic> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      const result: ImageElementDiagnostic = {
        present: true,
        complete: true,
        naturalWidth: bitmap.width,
        naturalHeight: bitmap.height
      }
      bitmap.close()
      return result
    }
  } catch (error) {
    return {
      present: false,
      decodeError: error instanceof Error ? error.message : String(error)
    }
  }

  return await new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      resolve({
        present: true,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        currentSrc: url
      })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve({
        present: false,
        decodeError: 'Image element failed to decode blob.'
      })
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}

export async function inspectFeltResource(ref: string): Promise<ResourceFetchDiagnostic> {
  try {
    const response = await fetch(ref)
    const contentType = response.headers.get('content-type')
    if (!response.ok) {
      return {
        ref,
        ok: false,
        status: response.status,
        statusText: response.statusText,
        contentType,
        error: `HTTP ${response.status} ${response.statusText}`
      }
    }
    const blob = await response.blob()
    const decode = await decodeBlob(blob)
    return {
      ref,
      ok: true,
      status: response.status,
      statusText: response.statusText,
      contentType,
      blobSize: blob.size,
      decode
    }
  } catch (error) {
    return {
      ref,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function logFabricDevDiagnostic(report: FabricDevDiagnosticReport): void {
  console.group(`${LOG_PREFIX} ${report.label}`)
  console.log('timestamp', report.timestamp)
  console.log('session', report.session)
  console.log('canvasDom', report.canvasDom)
  if (report.resource) console.log('resource', report.resource)
  console.groupEnd()
}

export function logDevDeleteDiagnostic(label: string, diagnostic: DevDeleteDiagnostic): void {
  console.group(`${LOG_PREFIX} ${label}`)
  console.log('beforeObjectCount', diagnostic.beforeObjectCount)
  console.log('afterObjectCount', diagnostic.afterObjectCount)
  if (diagnostic.error) console.error('error', diagnostic.error)
  if (diagnostic.stack) console.error('stack', diagnostic.stack)
  console.groupEnd()
}

export function formatDiagnosticSummary(report: FabricDevDiagnosticReport): string {
  const active = report.session.activeObject
  const resource = report.resource
  const dom = report.canvasDom
  const lines = [
    `[${report.label}] active=${active.exists ? 'yes' : 'no'}`,
    active.exists
      ? `object ${active.objectId ?? '?'} type=${active.type ?? '?'} size=${active.width ?? '?'}x${active.height ?? '?'} scale=${active.scaleX ?? '?'}x${active.scaleY ?? '?'}`
      : 'object none',
    `canvas objects=${report.session.objectCount} status=${report.session.sessionStatus} pending=${report.session.pendingOperations}`,
    `dom match=${dom.layersMatchLogic ? 'yes' : 'no'} logic=${dom.logicWidth}x${dom.logicHeight}`,
    resource
      ? `resource ${resource.ok ? 'ok' : 'fail'} status=${resource.status ?? '?'} blob=${resource.blobSize ?? '?'} decode=${resource.decode?.naturalWidth ?? '?'}x${resource.decode?.naturalHeight ?? '?'}`
      : 'resource n/a'
  ]
  return lines.join(' | ')
}
