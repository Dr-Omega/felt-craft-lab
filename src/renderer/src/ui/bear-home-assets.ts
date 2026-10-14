import manifest from '../../../../assets/ui/bear-home/manifest.json'
import backgroundBaseUrl from '../../../../assets/ui/bear-home/background-base.png'
import roomDefaultUrl from '../../../../assets/ui/bear-home/room-default.png'
import roomSofaUrl from '../../../../assets/ui/bear-home/room-sofa.png'
import frameOverlayUrl from '../../../../assets/ui/bear-home/frame-overlay.png'

export const BEAR_HOME_DESIGN_WIDTH = manifest.designSize.width
export const BEAR_HOME_DESIGN_HEIGHT = manifest.designSize.height

export const bearHomeSofaHitBox = manifest.sofaHitBox

export const bearHomeAssets = {
  backgroundBase: backgroundBaseUrl,
  roomDefault: roomDefaultUrl,
  roomSofa: roomSofaUrl,
  frameOverlay: frameOverlayUrl
} as const

export const BEAR_ROOM_SOFA_FURNITURE = '沙发款' as const
