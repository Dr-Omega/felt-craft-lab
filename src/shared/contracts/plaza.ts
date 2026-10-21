import type { UserRole } from './rewards'

/** First-login tour completion version; legacy accounts are migrated as already complete. */
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
  storyTitle?: string
  storyText?: string
  reviews?: PlazaReview[]
}

export interface PlazaReview { reviewId: string; authorName: string; score: number; comment: string; createdAt: string }

export interface PlazaAuthResult {
  token: string
  user: PlazaUser
  dailyRewardGranted?: boolean
}
