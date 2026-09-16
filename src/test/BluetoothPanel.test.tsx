import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BluetoothPanel } from '../components/BluetoothPanel'
import type { BluetoothSnapshot } from '../services/bluetooth/BluetoothController'
import { bluetoothMessages } from '../i18n/bluetoothMessages'
import type { Locale } from '../i18n/types'
import panelSource from '../components/BluetoothPanel.tsx?raw'
import controllerSource from '../services/bluetooth/BluetoothController.ts?raw'
import protocolSource from '../services/bluetooth/protocol.ts?raw'
import ts from 'typescript'

type Element = ReactElement<Record<string, unknown>>
type Scope = { slots: unknown[]; cleanups: Map<number, () => void> }

const harness = vi.hoisted(() => ({
  scopes: new Map<string, Scope>(), scope: '', cursor: 0,
  sliderKeys: new Map<string, string | null>(),
  effects: [] as Array<() => void>,
  snapshot: {} as BluetoothSnapshot,
  connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(),
  instances: 0,
  locale: 'ja' as Locale,
}))

vi.mock('../i18n', () => ({
  useLocale: () => ({
    locale: harness.locale,
    t: (text: string, params: Record<string, string | number> = {}) => {
      const translated = harness.locale === 'ja' ? text : bluetoothMessages[text]?.[harness.locale] ?? text
      return translated.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match))
    },
  }),
}))

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <Value,>(initial: Value | (() => Value)) => {
    const scope = harness.scopes.get(harness.scope)!
    const index = harness.cursor++
    if (!(index in scope.slots)) scope.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [scope.slots[index], (next: Value | ((previous: Value) => Value)) => {
      scope.slots[index] = typeof next === 'function' ? (next as (previous: Value) => Value)(scope.slots[index] as Value) : next
    }]
  },
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const scope = harness.scopes.get(harness.scope)!
    const index = harness.cursor++
    const previous = scope.slots[index] as unknown[] | undefined
    if (!previous || dependencies.some((dependency, position) => !Object.is(dependency, previous[position]))) {
      harness.effects.push(() => {
        scope.cleanups.get(index)?.()
        const cleanup = effect()
        if (cleanup) scope.cleanups.set(index, cleanup)
        else scope.cleanups.delete(index)
      })
    }
    scope.slots[index] = dependencies
  },
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => BluetoothSnapshot) => getSnapshot(),
}))

vi.mock('../services/bluetooth/BluetoothController', () => ({
  BluetoothController: class {
    constructor() { harness.instances++ }
    subscribe = vi.fn()
    getSnapshot = () => harness.snapshot
    connect = harness.connect
    disconnect = harness.disconnect
    send = harness.send
  },
}))

function renderInScope(name: string, render: () => ReactNode): ReactNode {
  harness.scope = name; harness.cursor = 0
  if (!harness.scopes.has(name)) harness.scopes.set(name, { slots: [], cleanups: new Map() })
  const node = render()
  harness.effects.splice(0).forEach(effect => effect())
  return node
}

function panel(onOpenProgram = vi.fn()): ReactNode {
  return renderInScope('panel', () => BluetoothPanel({ onOpenProgram }))
}

function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}

function content(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(content).join('')
  if (isValidElement<Record<string, unknown>>(node)) return content(node.props.children as ReactNode)
  return String(node)
}

function find(node: ReactNode, predicate: (element: Element) => boolean): Element {
  const found = all(node, predicate)
  expect(found).toHaveLength(1)
  return found[0]
}

function button(node: ReactNode, label: string): Element {
  return find(node, element => element.type === 'button' && content(element.props.children as ReactNode).includes(label))
}

function event(element: Element, name: string, value: unknown = undefined) {
  const handler = element.props[name]
  expect(handler).toBeTypeOf('function')
  return (handler as (event: unknown) => unknown)(value)
}

function sliderView(command: 'BRIGHTNESS' | 'SPEED') {
  const component = find(panel(), element => typeof element.type === 'function' && element.props.command === command)
  if (harness.sliderKeys.get(command) !== component.key) harness.scopes.delete(command)
  harness.sliderKeys.set(command, component.key)
  return renderInScope(command, () => (component.type as (props: Record<string, unknown>) => ReactNode)(component.props))
}

function slider(command: 'BRIGHTNESS' | 'SPEED') {
  return find(sliderView(command), element => element.type === 'input' && element.props.type === 'range')
}

function connected(patch: Partial<BluetoothSnapshot> = {}) {
  harness.snapshot = {
    phase: 'connected', deviceName: 'NanoLED-07', receivedAt: Date.now(), error: null, sending: false,
    status: { v: 1, mode: 'PINK', brightness: 80, speed: 20, pixels: '800020000000001040' },
    ...patch,
  }
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-15T10:00:00Z'))
  vi.stubGlobal('window', { setInterval, clearInterval })
  harness.scopes.clear(); harness.sliderKeys.clear(); harness.effects = []; harness.instances = 0
  harness.locale = 'ja'
  harness.connect.mockReset(); harness.disconnect.mockReset(); harness.send.mockReset().mockResolvedValue(true)
  harness.snapshot = { phase: 'disconnected', deviceName: null, receivedAt: null, status: null, error: null, sending: false }
})

afterEach(() => {
  for (const scope of harness.scopes.values()) for (const cleanup of scope.cleanups.values()) cleanup()
  vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('Bluetoothコントローラの接続と受信状態', () => {
  it('未接続では操作できず、ユーザーのクリックでだけ接続する', () => {
    const view = panel()
    expect(harness.connect).not.toHaveBeenCalled()
    expect(button(view, 'Bluetoothでつなぐ').props.disabled).toBe(false)
    expect(button(view, 'ピンク').props.disabled).toBe(true)
    expect(button(view, 'ライトを消す').props.disabled).toBe(true)
    expect(slider('BRIGHTNESS').props.disabled).toBe(true)
    event(button(view, 'Bluetoothでつなぐ'), 'onClick')
    expect(harness.connect).toHaveBeenCalledTimes(1)
  })

  it('未対応環境では接続を無効にして対応環境を案内する', () => {
    harness.snapshot = { ...harness.snapshot, phase: 'unsupported' }
    const view = panel()
    expect(button(view, 'Bluetoothでつなぐ').props.disabled).toBe(true)
    expect(content(view)).toContain('HTTPS')
    expect(content(view)).toContain('iPhone・iPad')
  })

  it('接続途中では二重接続を防ぎ、キャンセルできる', () => {
    harness.snapshot = { ...harness.snapshot, phase: 'connecting' }
    const view = panel()
    expect(button(view, 'Bluetoothでつなぐ').props.disabled).toBe(true)
    event(button(view, 'キャンセル'), 'onClick')
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
  })

  it('接続だけでは通常操作を許可せず、受信待ちと安全な消灯を表示する', () => {
    connected({ status: null, receivedAt: null })
    const view = panel()
    expect(content(view)).toContain('LEDの状態を待っています')
    expect(button(view, 'ピンク').props.disabled).toBe(true)
    expect(slider('SPEED').props.disabled).toBe(true)
    expect(button(view, 'ライトを消す').props.disabled).toBe(false)
    event(button(view, 'ライトを消す'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('OFF')
  })

  it('接続済みなら選択した機器名を示し、切断できる', () => {
    connected()
    const view = panel()
    expect(content(view)).toContain('NanoLED-07 とつながっています')
    expect(button(view, 'Bluetoothでつなぐ').props.disabled).toBe(true)
    event(button(view, '接続を切る'), 'onClick')
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
  })

  it.each([['ピンク', 'PINK'], ['ブルー', 'BLUE'], ['マジック', 'MAGIC'], ['にじいろ', 'RAINBOW']])('%sボタンが対応するコマンドを送る', (label, command) => {
    connected()
    const selected = button(panel(), label)
    expect(selected.props.disabled).toBe(false)
    event(selected, 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith(command)
  })

  it('LEDは受信した出力色を表示し、送信だけで色や選択を変えない', () => {
    connected()
    let view = panel()
    event(button(view, 'ブルー'), 'onClick')
    view = panel()
    const dots = all(view, element => String(element.props.className).split(' ').includes('led-dot'))
    expect(dots.map(dot => (dot.props.style as { backgroundColor: string }).backgroundColor)).toEqual(['#800020', '#000000', '#001040'])
    expect(content(view)).toContain('3個のうち2個が点灯')
    expect(button(view, 'ピンク').props['aria-pressed']).toBe(true)
    expect(button(view, 'ブルー').props['aria-pressed']).toBe(false)
  })

  it('消灯モードでもフェード中の実際の出力色を黒に置き換えない', () => {
    connected({ status: { v: 1, mode: 'OFF', brightness: 80, speed: 20, pixels: '010200000000' } })
    const view = panel()
    expect(content(view)).toContain('2個のうち1個が点灯')
    expect(find(view, element => element.props.title === 'LED 1: #010200').props.style).toMatchObject({ backgroundColor: '#010200' })
  })

  it('受信が5秒を超えて止まったら通常操作を無効にし、消灯と再受信を残す', () => {
    connected()
    panel()
    vi.advanceTimersByTime(5000)
    expect(button(panel(), 'ピンク').props.disabled).toBe(false)
    vi.advanceTimersByTime(1000)
    const view = panel()
    expect(button(view, 'ピンク').props.disabled).toBe(true)
    expect(slider('BRIGHTNESS').props.disabled).toBe(true)
    expect(button(view, 'ライトを消す').props.disabled).toBe(false)
    expect(button(view, '状態をもう一度受け取る').props.disabled).toBe(false)
    expect(content(view)).toContain('最後に届いた状態')
    expect(content(view)).toContain('5秒以上、新しい状態が届いていません')
    connected()
    expect(button(panel(), 'ピンク').props.disabled).toBe(false)
  })

  it('再受信はSTATUSだけを送り、送信中は再要求を無効にする', () => {
    connected()
    event(button(panel(), '状態をもう一度受け取る'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('STATUS')
    harness.snapshot = { ...harness.snapshot, sending: true }
    expect(button(panel(), '状態をもう一度受け取る').props.disabled).toBe(true)
  })

  it('同じコントローラを再描画でも維持し、アンマウント時だけ切断する', () => {
    panel(); panel()
    expect(harness.instances).toBe(1)
    expect(harness.disconnect).not.toHaveBeenCalled()
    for (const scope of harness.scopes.values()) {
      for (const cleanup of scope.cleanups.values()) cleanup()
      scope.cleanups.clear()
    }
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
  })

  it('対応プログラムの準備リンクでプログラム画面に戻れる', () => {
    const onOpenProgram = vi.fn()
    event(button(panel(onOpenProgram), 'プログラム画面'), 'onClick')
    expect(onOpenProgram).toHaveBeenCalledTimes(1)
  })
})

describe('スライダーと追加コマンド', () => {
  it.each(['disconnected', 'connected'] as const)('%sでも状態未受信ならスライダー初期値を機器の設定と表示しない', phase => {
    harness.snapshot = { ...harness.snapshot, phase }
    for (const command of ['BRIGHTNESS', 'SPEED'] as const) {
      expect(content(sliderView(command))).toContain('未受信')
      expect(content(sliderView(command))).not.toContain('機器の設定')
      expect(slider(command).props['aria-valuetext']).toBe('未受信')
      expect(slider(command).props.disabled).toBe(true)
    }
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sは0〜100の整数範囲で、操作途中では送信しない', command => {
    connected()
    const control = slider(command)
    expect(control.props).toMatchObject({ min: '0', max: '100', step: '1', disabled: false })
    expect(control.props.value).toBe(command === 'BRIGHTNESS' ? 80 : 20)
    expect(content(sliderView(command))).toContain('機器の設定')
    event(control, 'onChange', { target: { value: '37' } })
    expect(harness.send).not.toHaveBeenCalled()
    expect(slider(command).props.value).toBe(37)
    event(slider(command), 'onPointerUp')
    expect(harness.send).toHaveBeenLastCalledWith(`${command} 37`)
  })

  it('キーボード操作を確定でき、未編集の操作では送信しない', () => {
    connected()
    event(slider('SPEED'), 'onKeyUp')
    expect(harness.send).not.toHaveBeenCalled()
    event(slider('SPEED'), 'onChange', { target: { value: '55' } })
    event(slider('SPEED'), 'onKeyUp')
    expect(harness.send).toHaveBeenLastCalledWith('SPEED 55')
  })

  it('スライダー外で指を離した場合も受け取れるようにポインターを捕捉する', () => {
    connected()
    const setPointerCapture = vi.fn()
    event(slider('BRIGHTNESS'), 'onPointerDown', { pointerId: 12, currentTarget: { setPointerCapture } })
    expect(setPointerCapture).toHaveBeenCalledWith(12)
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('指操作をキャンセルした場合は送信せず機器の設定へ戻す', () => {
    connected()
    event(slider('BRIGHTNESS'), 'onChange', { target: { value: '12' } })
    event(slider('BRIGHTNESS'), 'onPointerCancel')
    expect(slider('BRIGHTNESS').props.value).toBe(80)
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('編集中に受信が止まった場合、確定しても送信しない', () => {
    connected()
    event(slider('BRIGHTNESS'), 'onChange', { target: { value: '12' } })
    vi.advanceTimersByTime(6000)
    const control = slider('BRIGHTNESS')
    expect(control.props.disabled).toBe(true)
    expect(control.props.value).toBe(80)
    event(control, 'onPointerUp')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each(['', '1STAR', 'STAR RED', 'STAR\nOFF', '光', 'ABCDEFGHIJKLMNOPQ', 'BRIGHTNESS', 'speed'])('不正な合言葉 %j は送信できない', command => {
    connected()
    event(find(panel(), element => element.props.id === 'ble-custom-command'), 'onChange', { target: { value: command } })
    const view = panel()
    expect(button(view, '送る').props.disabled).toBe(true)
    event(find(view, element => element.type === 'form'), 'onSubmit', { preventDefault: vi.fn() })
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('有効な合言葉は大文字にそろえて送信する', () => {
    connected()
    event(find(panel(), element => element.props.id === 'ble-custom-command'), 'onChange', { target: { value: ' star_2 ' } })
    const view = panel()
    expect(button(view, '送る').props.disabled).toBe(false)
    event(find(view, element => element.type === 'form'), 'onSubmit', { preventDefault: vi.fn() })
    expect(harness.send).toHaveBeenLastCalledWith('STAR_2')
  })

  it('有効な合言葉でも未接続なら送信しない', () => {
    event(find(panel(), element => element.props.id === 'ble-custom-command'), 'onChange', { target: { value: 'STAR' } })
    const view = panel()
    expect(button(view, '送る').props.disabled).toBe(true)
    event(find(view, element => element.type === 'form'), 'onSubmit', { preventDefault: vi.fn() })
    expect(harness.send).not.toHaveBeenCalled()
  })
})

describe('Bluetooth画面の言語切り替え', () => {
  it.each([
    ['en', 'Connect Bluetooth', 'Pink', 'Brightness and speed', '3 LEDs. 2 lit. Pink'],
    ['zh', '连接蓝牙', '粉色', '亮度与速度', '3 个 LED。2 个亮起。粉色'],
  ] as const)('%sでも機器名・受信色・コマンドは変えず、表示と読み上げを翻訳する', (locale, connectLabel, pinkLabel, title, previewLabel) => {
    connected()
    harness.locale = locale
    const view = panel()
    expect(button(view, connectLabel).props.disabled).toBe(true)
    expect(content(view)).toContain(title)
    expect(content(view)).toContain('NanoLED-07')
    expect(find(view, element => element.props.className === 'led-preview').props['aria-label']).toBe(previewLabel)
    expect(find(view, element => element.props.title === 'LED 1: #800020').props.style).toMatchObject({ backgroundColor: '#800020' })
    event(button(view, pinkLabel), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('PINK')
    expect(content(view)).not.toMatch(/[ぁ-んァ-ヶ]/u)
  })

  it('接続中に言語を変えてもコントローラ・スライダー編集中の値・追加コマンドを維持する', () => {
    connected()
    panel()
    event(slider('BRIGHTNESS'), 'onChange', { target: { value: '37' } })
    event(find(panel(), element => element.props.id === 'ble-custom-command'), 'onChange', { target: { value: ' star_2 ' } })
    harness.locale = 'en'
    expect(slider('BRIGHTNESS').props.value).toBe(37)
    expect(slider('BRIGHTNESS').props['aria-valuetext']).toBe('37 percent')
    expect(content(sliderView('BRIGHTNESS'))).toContain('Your selection')
    harness.locale = 'zh'
    expect(slider('BRIGHTNESS').props.value).toBe(37)
    expect(slider('BRIGHTNESS').props['aria-valuetext']).toBe('百分之37')
    expect(find(panel(), element => element.props.id === 'ble-custom-command').props.value).toBe(' star_2 ')
    expect(harness.instances).toBe(1)
    expect(harness.connect).not.toHaveBeenCalled()
    expect(harness.disconnect).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
    event(slider('BRIGHTNESS'), 'onPointerUp')
    expect(harness.send).toHaveBeenLastCalledWith('BRIGHTNESS 37')
    event(find(panel(), element => element.type === 'form'), 'onSubmit', { preventDefault: vi.fn() })
    expect(harness.send).toHaveBeenLastCalledWith('STAR_2')
  })

  it('表示済みの接続エラーも切り替え直後に翻訳する', () => {
    harness.snapshot = { ...harness.snapshot, error: 'Bluetoothの接続が切れました。機器の電源と距離を確認して、もう一度つないでください。' }
    expect(content(panel())).toContain('Bluetoothの接続が切れました')
    harness.locale = 'en'
    expect(content(panel())).toContain('Bluetooth disconnected.')
    harness.locale = 'zh'
    expect(content(panel())).toContain('蓝牙连接已断开。')
    expect(harness.instances).toBe(1)
    expect(harness.disconnect).not.toHaveBeenCalled()
  })

  it('両機種を案内し、独自モード名は翻訳せずそのまま表示する', () => {
    expect(content(panel())).toContain('M5NanoC6／AtomS3Lite')
    connected({ status: { v: 1, mode: 'STAR_2', brightness: 20, speed: 0, pixels: 'abcdef' } })
    harness.locale = 'en'
    expect(content(panel())).toContain('M5NanoC6 / AtomS3Lite')
    expect(content(panel())).toContain('STAR_2')
  })

  it('画面と通信サービスの全日本語メッセージに英語・簡体字中国語が揃い、置換項目も一致する', () => {
    const sources = [['BluetoothPanel.tsx', panelSource], ['BluetoothController.ts', controllerSource], ['protocol.ts', protocolSource]]
    const keys: string[] = []
    for (const [path, text] of sources) {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) && /[ぁ-んァ-ヶ一-龯]/u.test(node.text)) keys.push(node.text)
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(keys.length).toBeGreaterThan(80)
    for (const key of keys) {
      expect(bluetoothMessages, key).toHaveProperty(key)
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
      for (const locale of ['en', 'zh'] as const) {
        const translated = bluetoothMessages[key][locale]
        expect(translated.trim(), `${locale}: ${key}`).not.toBe('')
        expect(translated, `${locale}: ${key}`).not.toMatch(/[ぁ-んァ-ヶ]/u)
        expect(placeholders(translated), `${locale}: ${key}`).toEqual(placeholders(key))
      }
    }
  })
})
