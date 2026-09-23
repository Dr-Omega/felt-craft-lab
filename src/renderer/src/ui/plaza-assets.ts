import backgroundUrl from '../../../../assets/ui/plaza/background.png'
import screenBorderDecorUrl from '../../../../assets/ui/plaza/screen-border-decor.png'
import titleBannerUrl from '../../../../assets/ui/plaza/title-banner.png'
import showcaseFrameUrl from '../../../../assets/ui/plaza/showcase-frame.png'
import { PSD160_DESIGN_HEIGHT, PSD160_DESIGN_WIDTH } from './psd160-assets'

export const PLAZA_DESIGN_WIDTH = PSD160_DESIGN_WIDTH
export const PLAZA_DESIGN_HEIGHT = PSD160_DESIGN_HEIGHT

export const plazaAssets = {
  background: backgroundUrl,
  screenBorderDecor: screenBorderDecorUrl,
  titleBanner: titleBannerUrl,
  showcaseFrame: showcaseFrameUrl
} as const
