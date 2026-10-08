import type { RewardAction } from '@shared/contracts/rewards'
import { gatewayJson, type GatewayJsonResult } from '../ai/gateway-client'

type RewardPayload = Record<string, unknown>

function jsonRequest(
  path: string,
  method: 'POST' | 'PUT',
  token: string,
  payload: RewardPayload,
  isPackaged?: boolean
): Promise<GatewayJsonResult> {
  return gatewayJson(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    plazaUserToken: token,
    isPackaged
  })
}

export async function plazaRewardAction(input: {
  token: string
  action: RewardAction
  payload: RewardPayload
  isPackaged?: boolean
}): Promise<GatewayJsonResult> {
  const { token, action, payload, isPackaged } = input
  if (action === 'dashboard') {
    return gatewayJson('/api/rewards/dashboard', { method: 'GET', plazaUserToken: token, isPackaged })
  }
  if (action === 'inbox') {
    return gatewayJson('/api/rewards/inbox', { method: 'GET', plazaUserToken: token, isPackaged })
  }
  if (action === 'adminConfig') {
    return gatewayJson('/api/rewards/admin/config', { method: 'GET', plazaUserToken: token, isPackaged })
  }
  if (action === 'claim') {
    return jsonRequest(
      `/api/rewards/inbox/${encodeURIComponent(String(payload.messageId || ''))}/claim`,
      'POST',
      token,
      {},
      isPackaged
    )
  }
  if (action === 'like') {
    return jsonRequest(
      `/api/plaza/posts/${encodeURIComponent(String(payload.postId || ''))}/like`,
      'POST',
      token,
      {},
      isPackaged
    )
  }
  if (action === 'review') {
    return jsonRequest(
      `/api/plaza/posts/${encodeURIComponent(String(payload.postId || ''))}/reviews`,
      'POST',
      token,
      { score: payload.score, comment: payload.comment },
      isPackaged
    )
  }
  if (action === 'convert') {
    return jsonRequest('/api/rewards/convert', 'POST', token, payload, isPackaged)
  }
  if (action === 'recharge') {
    return jsonRequest('/api/rewards/recharge', 'POST', token, payload, isPackaged)
  }
  if (action === 'redeem') {
    return jsonRequest('/api/rewards/store/redeem', 'POST', token, payload, isPackaged)
  }
  if (action === 'feed') {
    return jsonRequest('/api/rewards/bear/feed', 'POST', token, payload, isPackaged)
  }
  if (action === 'updateAdminConfig') {
    return jsonRequest('/api/rewards/admin/config', 'PUT', token, payload, isPackaged)
  }
  return Promise.resolve({
    ok: false,
    error: { code: 'INVALID_ARGUMENT', message: '不支持的奖励操作。', retryable: false }
  })
}
