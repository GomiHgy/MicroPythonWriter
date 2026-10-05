import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyLanguageRecoveryButton, SourceLanguageNotice } from '../components/SourceLanguageNotice'
import { pasteMessages } from '../i18n/pasteMessages'
import { workshopPresets } from '../config/workshops'
import { createWorkshopContext, type WorkshopContext } from '../services/prompt/WorkshopRules'
import { buildLanguageRecoveryPrompt } from '../services/prompt/LanguageRecoveryPrompt'

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as { deps?: unknown[]; cleanup?: () => void }[], effectCursor: 0, pending: [] as (() => void)[], locale: 'ja' as 'ja' | 'en' | 'zh', writeText: vi.fn() }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <Value,>(initial: Value) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = initial
    return [hooks.slots[index], (next: Value) => { hooks.slots[index] = next }]
  },
  useRef: <Value,>(initial: Value) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }
    return hooks.slots[index]
  },
  useLayoutEffect: (run: () => void | (() => void), deps?: unknown[]) => {
    const index = hooks.effectCursor++, old = hooks.effects[index]
    if (!old || !deps || deps.some((value, position) => !Object.is(value, old.deps?.[position]))) hooks.pending.push(() => {
      old?.cleanup?.()
      const cleanup = run()
      hooks.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    })
  },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ locale: hooks.locale, t: (key: string) => hooks.locale === 'ja' ? key : pasteMessages[key]?.[hooks.locale] ?? key }) }))

type Element = ReactElement<Record<string, unknown>>
function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
let workshop: WorkshopContext
function render() {
  hooks.cursor = 0; hooks.effectCursor = 0
  const view = CopyLanguageRecoveryButton({ workshop })
  hooks.pending.splice(0).forEach(run => run())
  return view
}
function click() { return (all(render(), node => node.type === 'button')[0].props.onClick as () => Promise<void>)() }

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.effectCursor = 0; hooks.pending = []; hooks.locale = 'ja'
  hooks.writeText.mockReset(); hooks.writeText.mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText: hooks.writeText } })
  workshop = createWorkshopContext({ ...workshopPresets[0].profile, firmwareVersion: 'current-version', ledModel: 'WS2812B', ledCount: 37, maxBrightnessPercent: 20 })
})
afterEach(() => { hooks.effects.forEach(effect => effect.cleanup?.()); vi.unstubAllGlobals() })

describe('Arduino検出後の修正依頼コピー', () => {
  it('通常のPythonには警告を出さず、Arduinoの場合だけコピー導線を示す', () => {
    expect(SourceLanguageNotice({ source: 'print(1)', workshop })).toBeNull()
    const view = SourceLanguageNotice({ source: 'void setup() {}\nvoid loop() {}', workshop })
    expect(text(view)).toContain('Arduino用のC++コードです')
    expect(all(view, node => node.type === CopyLanguageRecoveryButton)).toHaveLength(1)
    expect(hooks.writeText).not.toHaveBeenCalled()
  })
  it.each(['ja', 'en', 'zh'] as const)('%sのコピーは現在設定を含め、成功後の3操作をその場で通知する', async locale => {
    hooks.locale = locale
    await click()
    expect(hooks.writeText).toHaveBeenCalledExactlyOnceWith(buildLanguageRecoveryPrompt(workshop, locale))
    const message = 'コピーしました。コードを作ったAIとの会話に貼って送る → MicroPython版のコードをコピー → 下のコード欄へ貼り付け → 「実行」の順に進めてください。'
    const status = all(render(), node => node.props.role === 'status')
    expect(status).toHaveLength(1)
    expect(text(status[0])).toBe(locale === 'ja' ? message : pasteMessages[message][locale])
  })
  it.each(['rejected', 'unsupported'] as const)('%sの場合は失敗通知と手動コピー欄を開く', async reason => {
    if (reason === 'rejected') hooks.writeText.mockRejectedValue(new Error('private API details'))
    else vi.stubGlobal('navigator', {})
    await click()
    const view = render()
    expect(text(view)).toContain('コピーできませんでした')
    expect(text(view)).not.toContain('private API details')
    expect(all(view, node => node.type === 'details')[0].props.open).toBe(true)
    expect(all(view, node => node.type === 'textarea')[0].props.value).toBe(buildLanguageRecoveryPrompt(workshop, 'ja'))
  })
  it('コピー待ちに設定が変わると古い完了通知を表示しない', async () => {
    let resolve!: () => void
    hooks.writeText.mockReturnValue(new Promise<void>(done => { resolve = done }))
    const pending = click()
    workshop = createWorkshopContext({ ...workshop.profile, ledCount: 50 })
    render(); resolve(); await pending
    expect(all(render(), node => node.props.role === 'status')).toHaveLength(0)
    expect(all(render(), node => node.type === 'textarea')[0].props.value).toContain('LED_COUNT: 50')
  })
})
