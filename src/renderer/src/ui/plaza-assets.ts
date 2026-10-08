import backgroundUrl from '../../../../assets/ui/plaza/user-public/base-background.png'
import publicSpaceUrl from '../../../../assets/ui/plaza/user-public/public-space.png'
import personalSpaceUrl from '../../../../assets/ui/plaza/user-public/personal-space.png'
import showcaseFrameUrl from '../../../../assets/ui/plaza/user-public/showcase-frame.png'
import backButtonUrl from '../../../../assets/ui/plaza/user-public/back-button.png'
import publicButtonUrl from '../../../../assets/ui/plaza/user-public/public-button.png'
import personalButtonUrl from '../../../../assets/ui/plaza/user-public/personal-button.png'
import childAvatarOneUrl from '../../../../assets/ui/avatars/child-1.png'
import childAvatarTwoUrl from '../../../../assets/ui/avatars/child-2.png'
import childAvatarThreeUrl from '../../../../assets/ui/avatars/child-3.png'
import parentAvatarOneUrl from '../../../../assets/ui/avatars/parent-1.png'
import parentAvatarTwoUrl from '../../../../assets/ui/avatars/parent-2.png'
import teacherAvatarOneUrl from '../../../../assets/ui/avatars/teacher-1.png'
import teacherAvatarTwoUrl from '../../../../assets/ui/avatars/teacher-2.png'
import type { UserRole } from '@shared/contracts/rewards'
import { PSD160_DESIGN_HEIGHT, PSD160_DESIGN_WIDTH } from './psd160-assets'

export const PLAZA_DESIGN_WIDTH = PSD160_DESIGN_WIDTH
export const PLAZA_DESIGN_HEIGHT = PSD160_DESIGN_HEIGHT

export const plazaAssets = {
  background: backgroundUrl,
  publicSpace: publicSpaceUrl,
  personalSpace: personalSpaceUrl,
  showcaseFrame: showcaseFrameUrl,
  backButton: backButtonUrl,
  publicButton: publicButtonUrl,
  personalButton: personalButtonUrl,
  avatars: {
    childOne: childAvatarOneUrl,
    childTwo: childAvatarTwoUrl,
    childThree: childAvatarThreeUrl,
    parentOne: parentAvatarOneUrl,
    parentTwo: parentAvatarTwoUrl,
    teacherOne: teacherAvatarOneUrl,
    teacherTwo: teacherAvatarTwoUrl
  }
} as const

export function plazaAvatarForRole(role: UserRole): string {
  if (role === 'parent') return plazaAssets.avatars.parentOne
  if (role === 'art_teacher') return plazaAssets.avatars.teacherOne
  if (role === 'chinese_teacher') return plazaAssets.avatars.teacherTwo
  if (role === 'admin') return plazaAssets.avatars.parentTwo
  return plazaAssets.avatars.childOne
}
