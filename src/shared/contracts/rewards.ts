export type UserRole = 'child' | 'parent' | 'art_teacher' | 'chinese_teacher' | 'admin'
export type Currency = 'coins' | 'diamonds'
export type TeacherLevel = 'ordinary' | 'intermediate' | 'advanced' | 'expert'
export type RewardAction =
  | 'paymentCapabilities' | 'paymentCreate' | 'paymentQuery' | 'paymentCancel'
  | 'dashboard'
  | 'inbox'
  | 'claim'
  | 'like'
  | 'review'
  | 'convert'
  | 'recharge'
  | 'redeem'
  | 'feed'
  | 'saveRoom'
  | 'adminConfig'
  | 'updateAdminConfig'

export interface WalletSnapshot {
  coins: number
  diamonds: number
  updatedAt: string
}

export interface LedgerEntry {
  ledgerId: string
  currency: Currency
  amount: number
  balanceAfter: number
  reason: string
  referenceId: string
  createdAt: string
}

export interface TeacherProgress {
  direction: 'art' | 'chinese'
  reviewCount: number
  level: TeacherLevel
  nextThreshold: number | null
  rewardPerReview: number
}

export interface StoreProduct {
  productId: string
  name: string
  coinPrice: number
  diamondPrice: number
}

export interface BearFood {
  foodId: 'apple' | 'honey' | 'fish'
  name: string
  coinPrice: number
  diamondPrice: number
}

export interface BearRoomSettings {
  character: string
  furniture: string
  revision: number
}

export interface RewardDashboard {
  user: { userId: string; username: string; role: UserRole }
  wallet: WalletSnapshot
  ledger: LedgerEntry[]
  inboxPendingCount: number
  teacher: TeacherProgress | null
  products: StoreProduct[]
  foods: BearFood[]
  room: BearRoomSettings
}

export interface InboxMessage {
  messageId: string
  messageType: 'like' | 'review'
  title: string
  body: string
  rewardCoins: number
  status: 'unread' | 'unclaimed' | 'claimed'
  sourceName: string | null
  postId: string | null
  reviewScore: number | null
  reviewComment: string | null
  createdAt: string
  claimedAt: string | null
}

export interface RewardConfig {
  dailyLoginDiamonds: number
  likeRewardCoins: number
  teacherThresholds: [number, number, number]
  teacherRewards: Record<TeacherLevel, number>
  childScoreRewards: Record<TeacherLevel, [number, number, number]>
}
