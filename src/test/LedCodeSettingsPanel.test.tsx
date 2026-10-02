import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { LedCodeSettingsPanel } from '../components/LedCodeSettingsPanel'
import { ledCodeMessages } from '../i18n/ledCodeMessages'

const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, locale: 'ja' as 'ja' | 'en' | 'zh' }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useMemo: (run: () => unknown) => run(),
  useState: (initial: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = initial
    return [state.slots[index], (value: unknown) => { state.slots[index] = value }]
  },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ t: (key: string) => state.locale === 'ja' ? key : ledCodeMessages[key]?.[state.locale] ?? key }) }))
type Element = ReactElement<Record<string, unknown>>
function all(node: ReactNode, predicate: (node: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
let source: string
let disabled: boolean
const replace = vi.fn((value: string) => { source = value })
const render = () => { state.cursor = 0; return LedCodeSettingsPanel({ source, onReplace: replace, disabled }) }
const inputs = () => all(render(), node => node.type === 'input')
const buttons = () => all(render(), node => node.type === 'button')
const change = (index: number, value: string) => (inputs()[index].props.onChange as (event: unknown) => void)({ target: { value } })
const click = (index = 0) => (buttons()[index].props.onClick as () => void)()
beforeEach(() => { state.slots = []; state.locale = 'ja'; source = 'LED_COUNT = 10\nMAX_BRIGHTNESS = 0.2\n'; disabled = false; replace.mockClear() })
it('読み取った値を表示し、クリックまでコードを変更しない。反映を通知し取り消せる', () => {
  expect(inputs().map(input => input.props.value)).toEqual(['10', '20'])
  expect(buttons()[0].props.disabled).toBe(true)
  change(0, '37'); change(1, '50')
  expect(replace).not.toHaveBeenCalled()
  click()
  expect(source).toBe('LED_COUNT = 37\nMAX_BRIGHTNESS = 0.5\n')
  expect(all(render(), node => node.props.role === 'status')).toHaveLength(1)
  click(1)
  expect(source).toBe('LED_COUNT = 10\nMAX_BRIGHTNESS = 0.2\n')
})
it('コード変更後は古い入力や取り消しを使わない', () => {
  change(0, '37'); click(); change(0, '50')
  source = 'NUM_LEDS = 15\nMAX_BRIGHTNESS_PERCENT = 30\n'
  expect(inputs().map(input => input.props.value)).toEqual(['15', '30'])
  expect(buttons()).toHaveLength(1)
  expect(buttons()[0].props.disabled).toBe(true)
  source = 'LED_COUNT = 37\nMAX_BRIGHTNESS = 0.2\n'
  expect(inputs()[0].props.value).toBe('37')
})
it.each(['', '0', '-1', '1.5'])('不正な個数%sを反映しない', value => {
  change(0, value); expect(buttons()[0].props.disabled).toBe(true); click(); expect(replace).not.toHaveBeenCalled()
})
it('処理中は入力も反映も無効', () => {
  change(0, '30'); disabled = true
  expect(inputs().every(input => input.props.disabled)).toBe(true)
  click(); expect(replace).not.toHaveBeenCalled()
})
it('非対応の設定は変更せず、読める設定のみ反映する', () => {
  source = 'LED_COUNT = 10\nMAX_BRIGHTNESS = get_limit()'
  expect(inputs()[1].props.disabled).toBe(true)
  change(0, '20'); click()
  expect(source).toBe('LED_COUNT = 20\nMAX_BRIGHTNESS = get_limit()')
})
it.each(['en', 'zh'] as const)('%s のボタンを表示する', locale => {
  state.locale = locale
  expect(buttons()[0].props.children).toBe(ledCodeMessages['コードに反映'][locale])
})
