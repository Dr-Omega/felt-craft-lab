import type {
  Currency,
  InboxMessage,
  RewardAction,
  RewardConfig,
  RewardDashboard,
  WalletSnapshot
} from '@shared/contracts/rewards'
import type { SharedError } from '@shared/contracts'

type IpcFail = { ok: false; error: SharedError }

const browserRewardsEnabled = (): boolean => !window.electronAPI?.rewards

async function browserRewardAction<T>(token: string, name: RewardAction, payload: Record<string, unknown>): Promise<T> {
  const routes: Record<RewardAction, { path: string; method: 'GET' | 'POST' | 'PUT' }> = {
    dashboard: { path: '/api/rewards/dashboard', method: 'GET' },
    inbox: { path: '/api/rewards/inbox', method: 'GET' },
    claim: { path: `/api/rewards/inbox/${encodeURIComponent(String(payload.messageId ?? ''))}/claim`, method: 'POST' },
    like: { path: `/api/plaza/posts/${encodeURIComponent(String(payload.postId ?? ''))}/like`, method: 'POST' },
    review: { path: `/api/plaza/posts/${encodeURIComponent(String(payload.postId ?? ''))}/reviews`, method: 'POST' },
    convert: { path: '/api/rewards/convert', method: 'POST' },
    recharge: { path: '/api/rewards/recharge', method: 'POST' },
    redeem: { path: '/api/rewards/store/redeem', method: 'POST' },
    feed: { path: '/api/rewards/bear/feed', method: 'POST' },
    adminConfig: { path: '/api/rewards/admin/config', method: 'GET' },
    updateAdminConfig: { path: '/api/rewards/admin/config', method: 'PUT' }
  }
  const route = routes[name]
  const response = await fetch(route.path, {
    method: route.method,
    headers: { Authorization: `Bearer ${token}`, ...(route.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
    ...(route.method !== 'GET' ? { body: JSON.stringify(payload) } : {})
  })
  const body = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; error?: SharedError } | null
  if (!response.ok || body?.ok === false) {
    throw body?.error ?? { code: 'UNKNOWN', message: '激励服务请求失败。', retryable: response.status >= 500 }
  }
  return (body?.result ?? body) as T
}

function getRewardApi(): NonNullable<typeof window.electronAPI.rewards> {
  if (!window.electronAPI?.rewards) {
    throw { code: 'UNKNOWN', message: '激励服务接口不可用。', retryable: false } satisfies SharedError
  }
  return window.electronAPI.rewards
}

async function action<T>(token: string, name: RewardAction, payload: Record<string, unknown> = {}): Promise<T> {
  if (browserRewardsEnabled()) return browserRewardAction<T>(token, name, payload)
  const response = (await getRewardApi().action({ token, action: name, payload })) as
    | { ok: true; result: unknown }
    | IpcFail
  if (!response?.ok) {
    throw response?.error ?? { code: 'UNKNOWN', message: '请求失败。', retryable: true }
  }
  return response.result as T
}

export function loadRewardDashboard(token: string): Promise<RewardDashboard> {
  return action(token, 'dashboard')
}

export async function loadRewardInbox(token: string): Promise<InboxMessage[]> {
  const result = await action<{ messages: InboxMessage[] }>(token, 'inbox')
  return result.messages ?? []
}

export function claimInboxReward(
  token: string,
  messageId: string
): Promise<{ messageId: string; status: 'claimed'; wallet: WalletSnapshot }> {
  return action(token, 'claim', { messageId })
}

export function likePlazaPost(
  token: string,
  postId: string
): Promise<{ likeCount: number; likedByMe: boolean; reviewCount: number }> {
  return action(token, 'like', { postId })
}

export function submitTeacherReview(
  token: string,
  input: { postId: string; score: number; comment: string }
): Promise<{ teacherRewardCoins: number; childRewardCoins: number; wallet: WalletSnapshot }> {
  return action(token, 'review', input)
}

export function convertDiamonds(
  token: string,
  diamonds: number
): Promise<{ wallet: WalletSnapshot; convertedDiamonds: number; receivedCoins: number }> {
  return action(token, 'convert', { diamonds, requestId: crypto.randomUUID() })
}

export function rechargeDiamonds(
  token: string,
  yuan: number
): Promise<{ wallet: WalletSnapshot; diamonds: number; yuan: number }> {
  return action(token, 'recharge', { yuan, requestId: crypto.randomUUID() })
}

export function redeemProduct(
  token: string,
  productId: string,
  currency: Currency
): Promise<{ redemptionId: string; wallet: WalletSnapshot }> {
  return action(token, 'redeem', { productId, currency, requestId: crypto.randomUUID() })
}

export function feedBear(
  token: string,
  foodId: string,
  currency: Currency
): Promise<{ feedingId: string; wallet: WalletSnapshot }> {
  return action(token, 'feed', { foodId, currency, requestId: crypto.randomUUID() })
}

export async function loadRewardConfig(token: string): Promise<RewardConfig> {
  const result = await action<{ config: RewardConfig }>(token, 'adminConfig')
  return result.config
}

export async function saveRewardConfig(token: string, config: RewardConfig): Promise<RewardConfig> {
  const result = await action<{ config: RewardConfig }>(
    token,
    'updateAdminConfig',
    config as unknown as Record<string, unknown>
  )
  return result.config
}
