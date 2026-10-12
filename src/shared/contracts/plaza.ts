import type { UserRole } from './rewards'

/** Bump when the step list changes; users below this version see the tour again. */
export const ONBOARDING_VERSION = 1

export interface PlazaUser {
  userId: string
  username: string
  role: UserRole
  onboardingCompletedVersion?: number
}

export interface PlazaPost {
  postId: string
  projectId: string
  title: string
  authorName: string
  previewMediaPath: string
  createdAt: string
  userId: string
  outputType: 'collage' | 'story'
  likeCount: number
  likedByMe: boolean
  reviewCount: number
}

export interface PlazaAuthResult {
  token: string
  user: PlazaUser
  dailyRewardGranted?: boolean
}
