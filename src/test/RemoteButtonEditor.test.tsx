import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { RemoteButtonEditor } from '../components/RemoteButtonEditor'
import { bluetoothMessages } from '../i18n/bluetoothMessages'
import type { RemoteButton } from '../services/projects/types'

type Element = ReactElement<Record<string, unknown>>
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, locale: 'ja' as 'ja' | 'en' | 'zh' }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [harness.slots[index], (next: Value) => { harness.slots[index] = next }]
  },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ t: (key: string) => harness.locale === 'ja' ? key : bluetoothMessages[key]?.[harness.locale] ?? key }) }))

let value: RemoteButton
let onSave = vi.fn()
function render() { harness.cursor = 0; return RemoteButtonEditor({ value, onSave }) }
function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function find(type: string) { const elements = all(render(), element => element.type === type); expect(elements).toHaveLength(1); return elements[0] }
function event(element: Element, name: string, payload?: unknown) { return (element.props[name] as (payload: unknown) => void)(payload) }
function edit(label: string) { event(find('input'), 'onChange', { target: { value: label } }) }
function submit() { const preventDefault = vi.fn(); event(find('form'), 'onSubmit', { preventDefault }); expect(preventDefault).toHaveBeenCalledTimes(1) }

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.locale = 'ja'
  value = { kind: 'action', id: 'SPARK', label: '変身', icon: 'star' }
  onSave = vi.fn()
})

it('編集だけでは保存せず、保存してもID・種類を変更しない', () => {
  edit('  星空の変身  ')
  event(find('select'), 'onChange', { target: { value: 'heart' } })
  expect(onSave).not.toHaveBeenCalled()
  submit()
  expect(onSave).toHaveBeenCalledWith({ kind: 'action', id: 'SPARK', label: '星空の変身', icon: 'heart' })
  expect(value).toEqual({ kind: 'action', id: 'SPARK', label: '変身', icon: 'star' })
})

it.each(['', '   ', 'a'.repeat(25), '🌈'.repeat(25), 'line\nbreak', 'line\rbreak', 'tab\there', 'bidi\u202Etext', 'join\u200Dtext', 'null\0text', 'sep\u2028text', 'para\u2029text', '\ud800'])('不正な名前%jは無効で、送信イベントからも保存できない', label => {
  edit(label)
  expect(find('button').props.disabled).toBe(true)
  submit()
  expect(onSave).not.toHaveBeenCalled()
})

it.each(['a'.repeat(24), '🌈'.repeat(24), '星空・変身 1', '<script>x</script>'])('有効な名前%jをそのまま文字列として保存する', label => {
  edit(label)
  expect(find('button').props.disabled).toBe(false)
  submit()
  expect(onSave).toHaveBeenLastCalledWith({ ...value, label })
  expect(find('input').props.value).toBe(label)
  expect(all(render(), element => element.props.dangerouslySetInnerHTML !== undefined)).toHaveLength(0)
})

it('未定義のアイコン値を保存しない', () => {
  event(find('select'), 'onChange', { target: { value: 'unknown' } })
  submit()
  expect(onSave).toHaveBeenLastCalledWith(value)
})

it.each([['en', 'Save this button name'], ['zh', '保存此按钮名称']] as const)('%sへ切り替えても編集中の名前・アイコン・操作IDを維持する', (locale, buttonLabel) => {
  edit('銀河の光')
  event(find('select'), 'onChange', { target: { value: 'rainbow' } })
  harness.locale = locale
  expect(find('button').props.children).toBe(buttonLabel)
  expect(find('input').props.value).toBe('銀河の光')
  expect(find('select').props.value).toBe('rainbow')
  expect(onSave).not.toHaveBeenCalled()
  submit()
  expect(onSave).toHaveBeenCalledWith({ ...value, label: '銀河の光', icon: 'rainbow' })
})
