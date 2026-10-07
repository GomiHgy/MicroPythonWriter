import { describe, expect, it } from 'vitest'
import {
  isSupportNavigationBlocked,
  resolveSupportConfig,
  supportConfig,
  validGitHubUsername,
  validateCommercialDisclosureUrl,
  validateStripePaymentLink,
  type SupportConfig,
} from '../config/support'
import type { DeviceState } from '../types'

const enabledConfig: SupportConfig = {
  github: { enabled: true, username: 'GomiHgy' },
  stripe: {
    enabled: true,
    usageConfirmed: true,
    paymentLinkUrl: 'https://buy.stripe.com/test_fixture',
    commercialDisclosureUrl: 'https://example.com/transaction-terms',
  },
}

describe('任意の開発支援の公開設定', () => {
  it('未確認の初期設定では両方を無効にし、入口の表示対象を返さない', () => {
    expect(supportConfig).toEqual({ github: { enabled: false, username: 'GomiHgy' }, stripe: { enabled: false, usageConfirmed: false, paymentLinkUrl: '', commercialDisclosureUrl: '' } })
    expect(resolveSupportConfig()).toEqual({ github: null, stripe: null, available: false })
  })
  it.each([
    [false, false, false], [true, false, true], [false, true, true], [true, true, true],
  ])('Sponsors=%s Stripe=%s の表示条件', (githubEnabled, stripeEnabled, available) => {
    const result = resolveSupportConfig({ ...enabledConfig, github: { ...enabledConfig.github, enabled: githubEnabled }, stripe: { ...enabledConfig.stripe, enabled: stripeEnabled } })
    expect(result.available).toBe(available)
    expect(result.github !== null).toBe(githubEnabled)
    expect(result.stripe !== null).toBe(stripeEnabled)
  })
  it('Sponsors URLを検証済みユーザー名だけから組み立てる', () => {
    expect(resolveSupportConfig(enabledConfig).github).toEqual({ username: 'GomiHgy', url: 'https://github.com/sponsors/GomiHgy' })
  })
  it.each([false, undefined, null, 1, 'true'])('Stripeの実用途の確認がtrue以外なら公開しない: %s', usageConfirmed => {
    const result = resolveSupportConfig({ ...enabledConfig, stripe: { ...enabledConfig.stripe, usageConfirmed } })
    expect(result.stripe).toBeNull()
    expect(result.github).not.toBeNull()
  })
  it.each([undefined, null, false, [], '', 42, { github: null, stripe: [] }])('不正な設定全体でも例外にならない: %s', config => {
    if (config === undefined) expect(resolveSupportConfig(config)).toEqual(resolveSupportConfig())
    else expect(resolveSupportConfig(config)).toEqual({ github: null, stripe: null, available: false })
  })
  it.each([undefined, null, 1, 'true', []])('enabledは真偽値trueのみ許可する: %s', enabled => {
    expect(resolveSupportConfig({ github: { ...enabledConfig.github, enabled }, stripe: { ...enabledConfig.stripe, enabled } }).available).toBe(false)
  })
  it('片方の不正なURL・ユーザー名では他方の受付を隠さない', () => {
    expect(resolveSupportConfig({ ...enabledConfig, github: { enabled: true, username: '../attacker' } })).toMatchObject({ github: null, stripe: { paymentLinkUrl: enabledConfig.stripe.paymentLinkUrl, commercialDisclosureUrl: enabledConfig.stripe.commercialDisclosureUrl }, available: true })
    expect(resolveSupportConfig({ ...enabledConfig, stripe: { ...enabledConfig.stripe, paymentLinkUrl: 'javascript:alert(1)' } })).toMatchObject({ github: { username: 'GomiHgy' }, stripe: null, available: true })
  })
  it('読み取り時に例外を投げる設定でも他方の有効な支援先を保全する', () => {
    const config = { github: enabledConfig.github, get stripe() { throw new Error('bad config') } }
    expect(resolveSupportConfig(config)).toMatchObject({ github: { username: 'GomiHgy' }, stripe: null, available: true })
  })
  it.each(['', 'http://example.com/terms', 'javascript:alert(1)', 'https://user:pass@example.com/terms'])('公開する取引条件URLが不適切ならStripeを隠す: %s', commercialDisclosureUrl => {
    expect(resolveSupportConfig({ ...enabledConfig, stripe: { ...enabledConfig.stripe, commercialDisclosureUrl } })).toMatchObject({ stripe: null, available: true })
  })
  it('支援者の情報や完了状態をURLへ追加せず、設定済みURLを返すだけにする', () => {
    const paymentLinkUrl = 'https://buy.stripe.com/test_fixture?locale=ja#external-page'
    expect(resolveSupportConfig({ ...enabledConfig, stripe: { ...enabledConfig.stripe, paymentLinkUrl } }).stripe?.paymentLinkUrl).toBe(paymentLinkUrl)
  })
})

describe('支援リンクのURL検証', () => {
  it.each(['https://buy.stripe.com/test_fixture', 'https://buy.stripe.com/aBc123', 'https://BUY.STRIPE.COM:443/test_fixture'])('正規のHTTPS Stripeホストを許可する: %s', value => {
    expect(validateStripePaymentLink(value)).toBe(new URL(value).href)
  })
  it.each([
    undefined, null, 12, {}, '', ' ', 'not a URL', 'http://buy.stripe.com/abc', 'javascript:alert(1)',
    'data:text/html,foo', '//buy.stripe.com/abc', 'https:buy.stripe.com/abc',
    'https://buy.stripe.com.evil.example/abc', 'https://buy-stripe.com/abc', 'https://stripe.com/abc',
    'https://buy.stripe.com./abc', 'https://buy.stripe.com@evil.example/abc', 'https://evil.example@buy.stripe.com/abc',
    'https://user:secret@buy.stripe.com/abc', 'https://buy.stripe.com:444/abc', 'https://buy.stripe.com',
    'https://buy.stripe.com/', 'https://buy.stripe.com/?success=true', 'https://buy.stripe.com/#abc',
    'https://buy.stripe.com/%20', 'https://buy.stripe.com/%', 'https://buy.stripe.com/abc\n',
    'https://buy.stripe.com/ab\tc', 'https://buy.stripe.com/ab c', 'https://buy.stripe.com\\@evil.example/abc',
  ])('不正な決済URLを拒否する: %s', value => {
    expect(validateStripePaymentLink(value)).toBeNull()
  })
  it.each(['https://example.com/terms', 'https://example.com', 'https://example.com:443/terms?language=ja'])('公開取引条件のHTTPS URLを許可する: %s', value => {
    expect(validateCommercialDisclosureUrl(value)).toBe(new URL(value).href)
  })
  it.each([null, {}, '', '/terms', 'http://example.com/terms', 'https://user@example.com/terms', 'https://user:pass@example.com/terms', 'https://example.com:444/terms', 'javascript:alert(1)', 'https://example.com/terms\r\n'])('危険な取引条件URLを拒否する: %s', value => {
    expect(validateCommercialDisclosureUrl(value)).toBeNull()
  })
  it.each(['GomiHgy', 'a', 'a-b', 'a'.repeat(39)])('正規のGitHubユーザー名を許可する: %s', value => {
    expect(validGitHubUsername(value)).toBe(true)
  })
  it.each([null, undefined, 1, {}, '', '-user', 'user-', 'a--b', 'a_b', 'a'.repeat(40), '../user', 'user?key=value', 'user@example.com', 'ユーザー'])('URL注入できる不正なGitHubユーザー名を拒否する: %s', value => {
    expect(validGitHubUsername(value)).toBe(false)
  })
})

describe('支援リンクの短時間の処理保護', () => {
  const critical: DeviceState[] = ['reconnecting', 'requesting-port', 'opening', 'interrupting', 'entering-raw-repl', 'probing', 'uploading', 'verifying', 'starting', 'stopping', 'setting-boot-mode', 'resetting']
  const ordinary: DeviceState[] = ['unsupported', 'disconnected', 'connection-lost', 'connected', 'raw-repl-ready', 'running', 'running-no-marker', 'stopped', 'error']
  it.each(critical)('%sは外部リンクを抑止する', state => {
    expect(isSupportNavigationBlocked(state, false)).toBe(true)
  })
  it.each(ordinary)('%sでは接続・実行状態だけを理由に禁止しない', state => {
    expect(isSupportNavigationBlocked(state, false)).toBe(false)
  })
  it.each([...ordinary, ...critical])('%sでもPWA更新の準備中は外部リンクを抑止する', state => {
    expect(isSupportNavigationBlocked(state, true)).toBe(true)
  })
})
