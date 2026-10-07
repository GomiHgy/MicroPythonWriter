import type { DeviceState } from '../types'

export interface SupportConfig {
  readonly github: {
    readonly enabled: boolean
    readonly username: string
  }
  readonly stripe: {
    readonly enabled: boolean
    readonly usageConfirmed: boolean
    readonly paymentLinkUrl: string
    readonly commercialDisclosureUrl: string
  }
}

/**
 * 運営者だけが変更する公開設定。秘密鍵・口座情報は置かない。
 * 受付の公開確認がないため、初期状態では両サービスとも無効にする。
 * Stripeは名称ではなく実際の受付内容で利用可能か確認してから有効化する。
 */
export const supportConfig: SupportConfig = Object.freeze({
  github: Object.freeze({ enabled: false, username: 'GomiHgy' }),
  stripe: Object.freeze({
    enabled: false,
    usageConfirmed: false,
    paymentLinkUrl: '',
    commercialDisclosureUrl: '',
  }),
})

export interface ResolvedSupportConfig {
  readonly github: { readonly username: string; readonly url: string } | null
  readonly stripe: { readonly paymentLinkUrl: string; readonly commercialDisclosureUrl: string } | null
  readonly available: boolean
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  try { return (value as Record<string, unknown>)[key] } catch { return undefined }
}

function parseHttpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.includes('\\') || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null
  const input = value.trim()
  if (!/^https:\/\//i.test(input) || /\s/.test(input)) return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port) return null
    return url
  } catch { return null }
}

/** Stripe Payment Linksだけを許可し、空の決済パスは受け付けない。 */
export function validateStripePaymentLink(value: unknown): string | null {
  const url = parseHttpsUrl(value)
  if (!url || url.hostname !== 'buy.stripe.com' || url.pathname === '/') return null
  try {
    if (!decodeURIComponent(url.pathname).replace(/[\s/]/g, '')) return null
  } catch { return null }
  return url.href
}

/** 事業者情報・取引条件は、運営者が実際に公開したHTTPSページを指定する。 */
export function validateCommercialDisclosureUrl(value: unknown): string | null {
  return parseHttpsUrl(value)?.href ?? null
}

export function validGitHubUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(value)
}

/** 設定が不完全でも落とさず、利用できる支援先だけを独立して返す。 */
export function resolveSupportConfig(config: unknown = supportConfig): ResolvedSupportConfig {
  const githubSetting = field(config, 'github')
  const stripeSetting = field(config, 'stripe')
  const username = field(githubSetting, 'username')
  const github = field(githubSetting, 'enabled') === true && validGitHubUsername(username)
    ? { username, url: `https://github.com/sponsors/${username}` }
    : null
  const paymentLinkUrl = validateStripePaymentLink(field(stripeSetting, 'paymentLinkUrl'))
  const commercialDisclosureUrl = validateCommercialDisclosureUrl(field(stripeSetting, 'commercialDisclosureUrl'))
  const stripe = field(stripeSetting, 'enabled') === true && field(stripeSetting, 'usageConfirmed') === true && paymentLinkUrl && commercialDisclosureUrl
    ? { paymentLinkUrl, commercialDisclosureUrl }
    : null
  return { github, stripe, available: github !== null || stripe !== null }
}

const criticalDeviceStates: ReadonlySet<DeviceState> = new Set([
  'reconnecting', 'requesting-port', 'opening', 'interrupting', 'entering-raw-repl',
  'probing', 'uploading', 'verifying', 'starting', 'stopping', 'setting-boot-mode', 'resetting',
])

/** USB/BLE接続済み・作品の実行中だけでは禁止しない。PWAのactiveではなくupdatingを参照する。 */
export function isSupportNavigationBlocked(state: DeviceState, pwaUpdating: boolean): boolean {
  return pwaUpdating || criticalDeviceStates.has(state)
}
