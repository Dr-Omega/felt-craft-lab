import type { UserRole } from './rewards'

export interface PlazaUser {
  userId: string
  username: string
  role: UserRole
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
