import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SupportPanel, type SupportPanelProps } from '../components/SupportPanel'
import type { SupportConfig } from '../config/support'
import { setLocale, supportedLocales, translate } from '../i18n'
import componentSource from '../components/SupportPanel.tsx?raw'
import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('../components/SupportPanel.css', import.meta.url), 'utf8')

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, cleanups: [] as (() => void)[] }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useId: () => 'support-test',
  useRef: <T,>(initial: T) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i] },
  useEffect: (run: () => void | (() => void)) => { const cleanup = run(); if (cleanup) h.cleanups.push(cleanup) },
  useSyncExternalStore: (_: unknown, get: () => unknown) => get(),
}))
type Element = ReactElement<Record<string, unknown>>
const config: SupportConfig = { github: { enabled: true, username: 'GomiHgy' }, stripe: { enabled: true, usageConfirmed: true, paymentLinkUrl: 'https://buy.stripe.com/test_localOnly', commercialDisclosureUrl: 'https://example.com/terms' } }
function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : ''
}
function render(props: SupportPanelProps = {}) { h.cursor = 0; return SupportPanel({ config, ...props }) }
function event(node: Element, name: string, arg?: unknown) { (node.props[name] as (arg: unknown) => void)(arg) }
const links = (view: ReactNode) => all(view, node => node.type === 'a')
class FakeElement { isConnected = true; focus = vi.fn() }
function attach(view: ReactNode) {
  const entry = all(view, node => node.props.className === 'support-entry quiet-button')[0]
  const dialog = all(view, node => node.type === 'dialog')[0]
  const closer = all(dialog, node => node.type === 'button')[0]
  const origin = new FakeElement(), closeControl = new FakeElement()
  const modal = { open: false, showModal: vi.fn(() => { modal.open = true }), close: vi.fn(() => { modal.open = false; event(dialog, 'onClose') }), focus: vi.fn(), querySelectorAll: vi.fn(() => [closeControl]) }
  vi.stubGlobal('HTMLElement', FakeElement); vi.stubGlobal('document', { activeElement: origin })
  ;(dialog.props.ref as { current: unknown }).current = modal
  ;(closer.props.ref as { current: unknown }).current = closeControl
  return { entry, dialog, closer, origin, closeControl, modal }
}
beforeEach(() => { h.slots = []; h.cursor = 0; h.cleanups = []; setLocale('ja') })
afterEach(() => { h.cleanups.forEach(cleanup => cleanup()); setLocale('ja'); vi.unstubAllGlobals() })

it('既定値・両方無効・不正な設定では領域ごと非表示', () => {
  h.cursor = 0; expect(SupportPanel({})).toBeNull()
  expect(render({ config: { ...config, github: { ...config.github, enabled: false }, stripe: { ...config.stripe, enabled: false } } })).toBeNull()
  expect(render({ config: null as unknown as SupportConfig })).toBeNull()
})
it.each([
  [true, false, ['https://github.com/sponsors/GomiHgy']],
  [false, true, ['https://buy.stripe.com/test_localOnly', 'https://example.com/terms']],
  [true, true, ['https://buy.stripe.com/test_localOnly', 'https://github.com/sponsors/GomiHgy', 'https://example.com/terms']],
] as const)('GitHub=%s Stripe=%sの有効先だけを表示', (github, stripe, expected) => {
  const view = render({ config: { github: { ...config.github, enabled: github }, stripe: { ...config.stripe, enabled: stripe } } })
  expect(links(view).map(link => link.props.href)).toEqual(expected)
  expect(all(view, node => node.props.className === 'support-entry quiet-button')).toHaveLength(1)
  for (const link of links(view)) { expect(link.props.target).toBe('_blank'); expect(link.props.rel).toBe('noopener noreferrer'); expect(link.props['aria-label']).toContain('新しいタブで開きます') }
})
it('Stripe未確認・不正URLは非表示でもGitHubは利用できる', () => {
  for (const stripe of [{ ...config.stripe, usageConfirmed: false }, { ...config.stripe, paymentLinkUrl: 'https://buy.stripe.com.evil.example/x' }, { ...config.stripe, commercialDisclosureUrl: '' }]) expect(links(render({ config: { ...config, stripe } })).map(link => link.props.href)).toEqual(['https://github.com/sponsors/GomiHgy'])
})
it('明示クリックでのみ開き、閉じる・Escapeでフォーカス復帰', () => {
  const f = attach(render()); expect(f.modal.showModal).not.toHaveBeenCalled()
  event(f.entry, 'onClick'); expect(f.modal.showModal).toHaveBeenCalledOnce(); expect(f.closeControl.focus).toHaveBeenCalledOnce()
  event(f.entry, 'onClick'); expect(f.modal.showModal).toHaveBeenCalledOnce()
  event(f.closer, 'onClick'); expect(f.origin.focus).toHaveBeenCalledOnce()
  event(f.entry, 'onClick'); const preventDefault = vi.fn(); event(f.dialog, 'onCancel', { preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce(); expect(f.origin.focus).toHaveBeenCalledTimes(2); expect(f.modal.open).toBe(false)
  expect(f.dialog.props['aria-labelledby']).toBe('support-test-title'); expect(f.dialog.props['aria-describedby']).toBe('support-test-description')
  for (const button of all(render(), node => node.type === 'button')) expect(button.props.type).toBe('button')
})
it('Tab/Shift+Tabは両端で循環し無効リンクは対象外', () => {
  const f = attach(render()), last = new FakeElement(), preventDefault = vi.fn()
  f.modal.querySelectorAll.mockReturnValue([f.closeControl, last])
  const doc = document as unknown as { activeElement: FakeElement }; doc.activeElement = last
  event(f.dialog, 'onKeyDown', { key: 'Tab', shiftKey: false, currentTarget: f.modal, preventDefault }); expect(f.closeControl.focus).toHaveBeenCalledOnce()
  doc.activeElement = f.closeControl
  event(f.dialog, 'onKeyDown', { key: 'Tab', shiftKey: true, currentTarget: f.modal, preventDefault }); expect(last.focus).toHaveBeenCalledOnce()
  event(f.dialog, 'onKeyDown', { key: 'Enter', currentTarget: f.modal, preventDefault }); expect(preventDefault).toHaveBeenCalledTimes(2)
  expect(f.modal.querySelectorAll).toHaveBeenCalledWith('button:not(:disabled), a[href]')
})
it('処理中はhrefも除去し、開いた画面で処理完了後に復帰', () => {
  const f = attach(render()); event(f.entry, 'onClick')
  const blockedReason = '機器への書き込みや設定変更中は、支援先を開けません。処理が終わるまで、この画面で待ってください。'
  const view = render({ blockedReason }); expect(text(view)).toContain(blockedReason)
  for (const link of links(view)) {
    expect(link.props.href).toBeUndefined(); expect(link.props['aria-disabled']).toBe(true); expect(link.props.tabIndex).toBe(-1)
    const preventDefault = vi.fn(); event(link, 'onClick', { preventDefault }); expect(preventDefault).toHaveBeenCalledOnce()
  }
  expect(links(render()).every(link => typeof link.props.href === 'string')).toBe(true); expect(f.modal.open).toBe(true)
})
it.each(supportedLocales)('$idの言語切替は開いた画面とアクセシビリティ文言に反映', ({ id }) => {
  const f = attach(render()); event(f.entry, 'onClick'); setLocale(id)
  const view = render(); expect(text(view)).toContain(translate(id, '開発を応援する'))
  expect(text(view)).toContain(translate(id, '支援は任意です。支援の有無で、利用できる機能は変わりません。'))
  expect(links(view)[0].props['aria-label']).toContain(translate(id, '新しいタブで開きます')); expect(f.modal.open).toBe(true)
  if (id !== 'ja') expect(text(view)).not.toMatch(/[ぁ-ゖァ-ヺ]/)
})
it('起動・開閉で通信・保存・外部素材を追加しない', () => {
  const fetch = vi.fn(), open = vi.fn(), setItem = vi.fn()
  vi.stubGlobal('fetch', fetch); vi.stubGlobal('window', { open }); vi.stubGlobal('localStorage', { setItem })
  const view = render(), f = attach(view); event(f.entry, 'onClick'); event(f.closer, 'onClick')
  expect(fetch).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled()
  expect(all(view, node => ['iframe', 'img', 'script', 'link'].includes(String(node.type)))).toHaveLength(0)
  expect(componentSource).not.toMatch(/fetch\(|XMLHttpRequest|window\.open|localStorage|sessionStorage|postMessage|\.connect\(|\.disconnect\(|\.stop\(|\.write\(/)
  expect(links(view)[0].props.href).toBe(config.stripe.paymentLinkUrl)
})
it('小画面は通常フローでダークテーマ・長文・小さい高さに対応', () => {
  expect(css).toContain('@media (max-width: 950px), (max-height: 500px)'); expect(css).toContain('.support-entry { position: static;')
  expect(css).toContain(':root[data-theme=dark] .support-dialog'); expect(css).toContain('max-height: calc(100dvh - 28px)'); expect(css).not.toMatch(/url\(|@import/)
})
