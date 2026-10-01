export const STAGE_W = 1920
export const STAGE_H = 1080

/** 3D / 2D preview content (from 范围 PNG, exclusive max edge). */
export const VIEWPORT_BOUNDS = {
  left: 301,
  top: 117,
  width: 1302,
  height: 852
} as const

export function boxStyle(box: { left: number; top: number; width: number; height: number }): Record<string, string> {
  return {
    position: 'absolute',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`
  }
}
