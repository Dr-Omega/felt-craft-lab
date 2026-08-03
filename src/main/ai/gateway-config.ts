/**
 * Resolve AI Gateway base URL for Main-process forwarding only.
 * Order: runtime AI_GATEWAY_BASE_URL → build-time FELT_AI_GATEWAY_BASE_URL → dev default.
 * Packaged remote hosts must use HTTPS; loopback may use HTTP.
 */

declare const FELT_AI_GATEWAY_BASE_URL: string | undefined

const DEFAULT_DEV_GATEWAY = 'http://127.0.0.1:8788'

export type GatewayUrlResult =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: 'unconfigured' | 'invalid_scheme' | 'remote_http' }

function buildTimeGateway(): string {
  // electron-vite `define` inlines this in Main builds; vitest may leave it unbound.
  try {
    const value = FELT_AI_GATEWAY_BASE_URL
    return (typeof value === 'string' ? value : '').trim().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

export function resolveAiGatewayBaseUrlResult(options: {
  isPackaged?: boolean
  envUrl?: string
  buildTimeUrl?: string
} = {}): GatewayUrlResult {
  const fromEnv = (options.envUrl ?? process.env.AI_GATEWAY_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '')
  const fromBuild = (options.buildTimeUrl ?? buildTimeGateway()).trim().replace(/\/+$/, '')
  const candidate = fromEnv || fromBuild || (!options.isPackaged ? DEFAULT_DEV_GATEWAY : '')

  if (!candidate) {
    return { ok: false, reason: 'unconfigured' }
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid_scheme' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid_scheme' }
  }

  const loopback = isLoopbackHost(parsed.hostname)
  if (options.isPackaged && !loopback && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'remote_http' }
  }

  return { ok: true, baseUrl: candidate.replace(/\/+$/, '') }
}

/** Convenience string resolver (empty string means unavailable). */
export function resolveAiGatewayBaseUrl(options: { isPackaged?: boolean } = {}): string {
  const result = resolveAiGatewayBaseUrlResult(options)
  return result.ok ? result.baseUrl : ''
}
