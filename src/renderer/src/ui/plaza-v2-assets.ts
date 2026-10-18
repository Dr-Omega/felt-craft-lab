import manifest from '../../../../assets/ui/plaza-v2/manifest.json'
import baseBackgroundUrl from '../../../../assets/ui/plaza-v2/layer-base-background.png'
import publicBackgroundUrl from '../../../../assets/ui/plaza-v2/layer-public-background-01.png'
import showcaseFrameUrl from '../../../../assets/ui/plaza-v2/layer-showcase-frame-03.png'
import titleBannerUrl from '../../../../assets/ui/plaza-v2/layer-title-banner.png'
import backButtonUrl from '../../../../assets/ui/plaza-v2/layer-back-top.png'

export const PLAZA_V2_DESIGN_WIDTH = manifest.designSize.width
export const PLAZA_V2_DESIGN_HEIGHT = manifest.designSize.height

export const plazaV2ContentSlot = manifest.contentSlot

export const plazaV2Assets = {
  baseBackground: baseBackgroundUrl,
  publicBackground: publicBackgroundUrl,
  showcaseFrame: showcaseFrameUrl,
  titleBanner: titleBannerUrl,
  backButton: backButtonUrl
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
  if (!layer) throw new Error(`Missing plaza-v2 layer bbox for ${slug}`)
  return layer.bbox
}

export function plazaV2HitBoxStyle(slug: string): Record<string, string> {
  const box = bboxFor(slug)
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`
  }
}

export const plazaV2FullLayerStyle: Record<string, string> = {
  left: '0',
  top: '0',
  width: `${PLAZA_V2_DESIGN_WIDTH}px`,
  height: `${PLAZA_V2_DESIGN_HEIGHT}px`
}

export const plazaV2ContentSlotStyle: Record<string, string> = {
  left: `${plazaV2ContentSlot.left}px`,
  top: `${plazaV2ContentSlot.top}px`,
  width: `${plazaV2ContentSlot.width}px`,
  height: `${plazaV2ContentSlot.height}px`
}
