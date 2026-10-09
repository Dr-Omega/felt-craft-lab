import manifest from '../../../../assets/ui/auth/manifest.json'
import backgroundUrl from '../../../../assets/ui/auth/background.png'
import splashDecorUrl from '../../../../assets/ui/auth/splash-decor.png'
import loginPanelUrl from '../../../../assets/ui/auth/login-panel.png'
import registerPanelUrl from '../../../../assets/ui/auth/register-panel.png'
import nameInputUrl from '../../../../assets/ui/auth/name-input.png'
import passwordInputUrl from '../../../../assets/ui/auth/password-input.png'
import loginEnterButtonUrl from '../../../../assets/ui/auth/login-enter-button.png'

export const AUTH_DESIGN_WIDTH = manifest.designSize.width
export const AUTH_DESIGN_HEIGHT = manifest.designSize.height

export const authAssets = {
  background: backgroundUrl,
  splashDecor: splashDecorUrl,
  loginPanel: loginPanelUrl,
  registerPanel: registerPanelUrl,
  nameInput: nameInputUrl,
  passwordInput: passwordInputUrl,
  loginEnterButton: loginEnterButtonUrl
} as const

type Bbox = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function bboxFor(slug: string): Bbox {
  const layer = manifest.layers.find((entry) => entry.slug === slug)
  if (!layer) throw new Error(`Missing auth layer bbox for ${slug}`)
  return layer.bbox
}

/** Pixel hit-box for interactive regions on the 1920×1080 artboard. */
export function authHitBoxStyle(slug: string): Record<string, string> {
  const box = bboxFor(slug)
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`
  }
}

/** Full artboard layer — every auth PNG is 1920×1080 at origin, no stretch. */
export const authFullLayerStyle: Record<string, string> = {
  left: '0',
  top: '0',
  width: `${AUTH_DESIGN_WIDTH}px`,
  height: `${AUTH_DESIGN_HEIGHT}px`
}
