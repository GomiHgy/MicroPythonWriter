import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BluetoothPanel } from '../components/BluetoothPanel'
import { RemoteButtonEditor } from '../components/RemoteButtonEditor'
import type { RemoteButton } from '../services/projects/types'
import type { BluetoothSnapshot } from '../services/bluetooth/BluetoothController'
import type { LedStatus } from '../services/bluetooth/protocol'
import { bluetoothMessages } from '../i18n/bluetoothMessages'
import type { Locale } from '../i18n/types'
import panelSource from '../components/BluetoothPanel.tsx?raw'
import editorSource from '../components/RemoteButtonEditor.tsx?raw'
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
  useRef: <Value,>(initial: Value) => {
    const scope = harness.scopes.get(harness.scope)!
    const index = harness.cursor++
    if (!(index in scope.slots)) scope.slots[index] = { current: initial }
    return scope.slots[index]
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

function panel(onOpenProgram = vi.fn(), onOpenPreparation = vi.fn(), preferences: Pick<Parameters<typeof BluetoothPanel>[0], 'remoteButtons' | 'projectName' | 'onRemoteButtonsChange'> = {}): ReactNode {
  return renderInScope('panel', () => BluetoothPanel({ onOpenProgram, onOpenPreparation, ...preferences }))
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

function availability(node: ReactNode): Element {
  return find(node, element => String(element.props.className).split(' ').includes('remote-availability'))
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

function reportedSliderValue(command: 'BRIGHTNESS' | 'SPEED'): string {
  return content(find(sliderView(command), element => String(element.props.className).split(' ').includes('slider-reported')))
}

function receiveSliderValue(command: 'BRIGHTNESS' | 'SPEED', value: number) {
  harness.snapshot = {
    ...harness.snapshot,
    receivedAt: Date.now(),
    status: { ...harness.snapshot.status!, [command === 'BRIGHTNESS' ? 'brightness' : 'speed']: value },
  }
}

function connected(patch: Partial<BluetoothSnapshot> = {}) {
  harness.snapshot = {
    phase: 'connected', deviceName: 'NanoLED-07', connectedAt: Date.now(), receivedAt: Date.now(), error: null, sending: false,
    status: { v: 1, mode: 'PINK', brightness: 80, speed: 20, pixels: '800020000000001040' },
    ...patch,
  }
}

type ModernStatus = Extract<LedStatus, { v: 2 }>

function modern(patch: Partial<ModernStatus> = {}) {
  connected({ status: {
    v: 2, mode: 'RAINBOW', brightness: 50, speed: 30, pixels: '330000001a00000000',
    playback: 'playing', action: null,
    controls: {
      speed: true,
      modes: [{ id: 'RAINBOW', label: 'にじいろ散歩' }, { id: 'CALM', label: '落ち着いた光' }],
      actions: [{ id: 'SPARK', label: '一度だけ光る' }],
    },
    ...patch,
  } })
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-15T10:00:00Z'))
  vi.stubGlobal('window', { setInterval, clearInterval })
  harness.scopes.clear(); harness.sliderKeys.clear(); harness.effects = []; harness.instances = 0
  harness.locale = 'ja'
  harness.connect.mockReset(); harness.disconnect.mockReset(); harness.send.mockReset().mockResolvedValue(true)
  harness.snapshot = { phase: 'disconnected', deviceName: null, connectedAt: null, receivedAt: null, status: null, error: null, sending: false }
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
    for (const label of ['再生', '停止', 'モードを選ぶ', 'アクションを実行']) expect(button(view, label).props.disabled).toBe(true)
    expect(all(view, element => element.type === 'button' && content(element.props.children as ReactNode).includes('ピンク'))).toHaveLength(0)
    expect(all(view, element => element.props.id === 'ble-custom-command')).toHaveLength(0)
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
    for (const label of ['再生', '停止', 'モードを選ぶ', 'アクションを実行']) expect(button(view, label).props.disabled).toBe(true)
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

  it.each([1, 2])('v%sの消灯はOFFを1回だけ送り、フェードや輝度表示をブラウザで偽装しない', async version => {
    if (version === 2) modern()
    else connected()
    const before = harness.snapshot.status
    const view = panel()
    const off = button(view, 'ライトを消す')
    expect(off.props['aria-describedby']).toBe('lights-off-help')
    expect(content(view)).toContain('0.2秒かけてふわっと消灯')
    expect(content(view)).toContain('以前のプログラムは更新が必要')
    event(off, 'onClick')
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.send.mock.calls).toEqual([['OFF']])
    expect(harness.snapshot.status).toEqual(before)
    expect(slider('BRIGHTNESS').props.value).toBe(before?.brightness)
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
    expect(harness.connect).not.toHaveBeenCalled()
    expect(harness.disconnect).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
  })
})

describe('未接続からのリモコン案内', () => {
  const states = [
    ['disconnected', '未接続'],
    ['connecting', '接続中'],
    ['waiting', '状態待ち'],
    ['legacy', '旧仕様（NanoLED v1）'],
    ['modern', '新仕様（NanoLED v2）'],
    ['unsupported', '接続非対応'],
  ] as const

  function selectState(state: typeof states[number][0]) {
    if (state === 'legacy') connected()
    else if (state === 'modern') modern()
    else if (state === 'waiting') connected({ status: null, receivedAt: null })
    else harness.snapshot = { ...harness.snapshot, phase: state }
  }

  it.each((['ja', 'en', 'zh'] as const).flatMap(locale => states.map(([state, label]) => [locale, state, label] as const)))('%sで%sを明確に表示する', (locale, state, label) => {
    harness.locale = locale
    selectState(state)
    const view = panel()
    const translated = (text: string) => locale === 'ja' ? text : bluetoothMessages[text][locale]
    expect(content(availability(view))).toContain(translated(label))
    expect(availability(view).props).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    expect(button(view, translated('AIの準備へ'))).toBeDefined()
    expect(button(view, translated('プログラム画面'))).toBeDefined()
    expect(button(view, translated('再生')).props.disabled).toBe(true)
    expect(button(view, translated('停止')).props.disabled).toBe(state !== 'modern')
    if (locale !== 'ja') {
      // 機器から届く作品名を除き、新しい案内も選択言語で表示する。
      const withoutArtworkLabels = content(view).replaceAll('にじいろ散歩', '').replaceAll('落ち着いた光', '').replaceAll('一度だけ光る', '')
      expect(withoutArtworkLabels).not.toMatch(/[ぁ-んァ-ヶ]/u)
    }
    expect(harness.connect).not.toHaveBeenCalled()
    expect(harness.disconnect).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each(['disconnected', 'connecting', 'waiting', 'unsupported'] as const)('%sでは存在しないモードを見せず、プレースホルダーから送信できない', state => {
    selectState(state)
    const view = panel()
    for (const label of ['モードを選ぶ', 'アクションを実行']) {
      const placeholder = button(view, label)
      expect(placeholder.props.disabled).toBe(true)
      expect(placeholder.props.onClick).toBeUndefined()
    }
    for (const label of ['ピンク', 'ブルー', 'マジック', 'にじいろ']) {
      expect(all(view, element => element.type === 'button' && content(element.props.children as ReactNode).includes(label))).toHaveLength(0)
    }
    expect(all(view, element => element.props.id === 'ble-custom-command')).toHaveLength(0)
    for (const label of ['再生', '停止']) event(button(view, label), 'onClick')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('旧仕様では再生・停止のハンドラーを直接呼んでも新仕様の命令を送らない', () => {
    connected()
    const view = panel()
    for (const label of ['再生', '停止']) {
      expect(button(view, label).props.disabled).toBe(true)
      event(button(view, label), 'onClick')
    }
    expect(button(view, 'アクションを実行').props.onClick).toBeUndefined()
    expect(content(view)).toContain('NanoLED v2')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each(states.map(([state]) => state))('%sからAI準備とプログラムへ案内しても自動で通信・命令を実行しない', state => {
    selectState(state)
    const onOpenPreparation = vi.fn()
    const onOpenProgram = vi.fn()
    const view = panel(onOpenProgram, onOpenPreparation)
    event(button(view, 'AIの準備へ'), 'onClick')
    event(button(view, 'プログラム画面'), 'onClick')
    expect(onOpenPreparation).toHaveBeenCalledTimes(1)
    expect(onOpenProgram).toHaveBeenCalledTimes(1)
    expect(harness.connect).not.toHaveBeenCalled()
    expect(harness.disconnect).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each(['disconnected', 'connecting', 'waiting', 'legacy', 'unsupported'] as const)('%sでは理由と対応プログラムの準備手順を折り畳まずに表示する', state => {
    selectState(state)
    const view = panel()
    const guide = find(view, element => element.props.className === 'remote-setup')
    expect(guide.type).toBe('section')
    expect(guide.props.hidden).not.toBe(true)
    expect(all(guide, element => element.type === 'li')).toHaveLength(3)
    expect(content(guide)).toContain('UIFlow2')
    expect(content(guide)).toContain('NanoLED v2対応の main.py')
    expect(content(guide)).toContain('「実行」')
    expect(content(guide)).toContain('実機確認済みのBLE基準コードは含まれていません')
    expect(content(guide)).toContain('動作確認をしていないコードを確認済みにしない')
    const details = all(view, element => element.type === 'details')
    expect(details.every(detail => all(detail, element => element === guide).length === 0)).toBe(true)
    const reason = availability(view)
    expect(all(reason, element => element.type === 'p').length).toBeGreaterThanOrEqual(2)
    if (state === 'waiting') expect(content(reason)).toContain('通信仕様はまだ未確認')
    if (state === 'legacy') expect(content(reason)).toContain('新仕様の対応プログラムが必要')
  })

  it('新仕様受信後は初回準備の大きな案内を畳み、再確認用の導線とヘルプを残す', () => {
    modern()
    const view = panel()
    expect(all(view, element => element.props.className === 'remote-setup')).toHaveLength(0)
    const help = find(view, element => String(element.props.className).split(' ').includes('bluetooth-help'))
    expect(help.type).toBe('details')
    expect(help.props.open).not.toBe(true)
    expect(button(view, 'AIの準備へ')).toBeDefined()
    expect(button(view, 'プログラム画面')).toBeDefined()
  })

  it.each(['legacy', 'modern'] as const)('%sで受信停止しても仕様を取り違えず、復旧後に操作を再開する', state => {
    selectState(state)
    panel()
    vi.advanceTimersByTime(6000)
    const view = panel()
    expect(content(availability(view))).toContain(state === 'legacy' ? '旧仕様（NanoLED v1）' : '新仕様（NanoLED v2）')
    expect(content(availability(view))).toContain('更新停止')
    expect(content(view)).toContain('更新が止まっています')
    expect(button(view, state === 'legacy' ? 'ピンク' : 'にじいろ散歩').props.disabled).toBe(true)
    for (const label of ['再生', '停止']) {
      expect(button(view, label).props.disabled).toBe(true)
      event(button(view, label), 'onClick')
    }
    expect(harness.send).not.toHaveBeenCalled()
    selectState(state)
    expect(button(panel(), state === 'legacy' ? 'ピンク' : 'にじいろ散歩').props.disabled).toBe(false)
  })

  it.each(['legacy', 'modern'] as const)('%sから切断・再接続したら以前の機能を残さず状態待ちに戻す', state => {
    selectState(state)
    panel()
    harness.snapshot = { phase: 'disconnected', deviceName: null, connectedAt: null, receivedAt: null, status: null, error: null, sending: false }
    let view = panel()
    expect(content(availability(view))).toContain('未接続')
    expect(content(availability(view))).not.toContain('旧仕様（NanoLED v1）')
    expect(content(availability(view))).not.toContain('新仕様（NanoLED v2）')
    expect(all(view, element => element.type === 'button' && /ピンク|にじいろ散歩|一度だけ光る/u.test(content(element.props.children as ReactNode)))).toHaveLength(0)
    for (const label of ['再生', '停止', 'モードを選ぶ', 'アクションを実行']) expect(button(view, label).props.disabled).toBe(true)
    connected({ status: null, receivedAt: null })
    view = panel()
    expect(content(view)).toContain('状態待ち')
    expect(button(view, 'モードを選ぶ').props.disabled).toBe(true)
    expect(button(view, 'アクションを実行').props.disabled).toBe(true)
    expect(slider('BRIGHTNESS').props.disabled).toBe(true)
    expect(harness.send).not.toHaveBeenCalled()
  })
})

describe('作品専用の無線リモコン v2', () => {
  it('機器が知らせたモードとアクションだけを名前付きで表示する', () => {
    modern()
    const view = panel()
    expect(button(view, 'にじいろ散歩').props['aria-pressed']).toBe(true)
    expect(button(view, '落ち着いた光').props['aria-pressed']).toBe(false)
    expect(button(view, '一度だけ光る').props.disabled).toBe(false)
    expect(all(view, element => element.type === 'button' && content(element.props.children as ReactNode).includes('ピンク'))).toHaveLength(0)
    expect(all(view, element => element.props.id === 'ble-custom-command')).toHaveLength(0)
    expect(content(view)).toContain('にじいろ散歩')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each([['落ち着いた光', 'MODE CALM'], ['一度だけ光る', 'ACTION SPARK']] as const)('%sは表示名ではなく登録IDを送る', (label, command) => {
    modern()
    event(button(panel(), label), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith(command)
  })

  it('停止はPAUSEで現在色を維持し、消灯は別のOFF命令にする', () => {
    modern()
    const view = panel()
    expect(button(view, '再生').props.disabled).toBe(true)
    expect(button(view, '停止').props.disabled).toBe(false)
    event(button(view, '停止'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('PAUSE')
    expect(button(panel(), '再生').props.disabled).toBe(true)
    expect(button(panel(), '停止').props.disabled).toBe(false)
    expect(find(panel(), element => element.props.title === 'LED 1: #330000').props.style).toMatchObject({ backgroundColor: '#330000' })
    event(button(panel(), 'ライトを消す'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('OFF')
    expect(find(panel(), element => element.props.title === 'LED 1: #330000').props.style).toMatchObject({ backgroundColor: '#330000' })
  })

  it.each(['paused', 'off'] as const)('%sの受信後は再生でき、停止を重ねて送れない', playback => {
    modern({ playback, pixels: playback === 'off' ? '000000000000000000' : '330000001a00000000' })
    const view = panel()
    expect(button(view, '再生').props.disabled).toBe(false)
    expect(button(view, '停止').props.disabled).toBe(true)
    event(button(view, '再生'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('PLAY')
    expect(button(panel(), '再生').props.disabled).toBe(false)
    modern({ playback: 'playing' })
    expect(button(panel(), '再生').props.disabled).toBe(true)
    expect(button(panel(), '停止').props.disabled).toBe(false)
  })

  it('スライダーの選択値は保持し、機器のモード・明るさ・LEDは返信でだけ更新する', () => {
    modern()
    event(button(panel(), '落ち着いた光'), 'onClick')
    expect(button(panel(), 'にじいろ散歩').props['aria-pressed']).toBe(true)
    expect(button(panel(), '落ち着いた光').props['aria-pressed']).toBe(false)
    event(slider('BRIGHTNESS'), 'onChange', { target: { value: '12' } })
    event(slider('BRIGHTNESS'), 'onPointerUp')
    expect(harness.send).toHaveBeenLastCalledWith('BRIGHTNESS 12')
    expect(slider('BRIGHTNESS').props.value).toBe(12)
    expect(reportedSliderValue('BRIGHTNESS')).toContain('50%')
    expect(find(panel(), element => element.props.title === 'LED 1: #330000').props.style).toMatchObject({ backgroundColor: '#330000' })
    modern({ mode: 'CALM', brightness: 12, pixels: '000306000306000306' })
    expect(button(panel(), '落ち着いた光').props['aria-pressed']).toBe(true)
    expect(slider('BRIGHTNESS').props.value).toBe(12)
    expect(reportedSliderValue('BRIGHTNESS')).toContain('12%')
    expect(find(panel(), element => element.props.title === 'LED 1: #000306').props.style).toMatchObject({ backgroundColor: '#000306' })
  })

  it('アクション実行中は連打を防ぎ、モード変更・停止・消灯は使える', () => {
    modern({ action: 'SPARK' })
    const view = panel()
    expect(button(view, '一度だけ光る').props.disabled).toBe(true)
    expect(button(view, '落ち着いた光').props.disabled).toBe(false)
    expect(button(view, '停止').props.disabled).toBe(false)
    expect(button(view, 'ライトを消す').props.disabled).toBe(false)
    event(button(view, '落ち着いた光'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('MODE CALM')
    modern({ action: null })
    expect(button(panel(), '一度だけ光る').props.disabled).toBe(false)
  })

  it('送信処理中はアクションの追加送信を無効にする', () => {
    modern()
    harness.snapshot = { ...harness.snapshot, sending: true }
    const view = panel()
    expect(button(view, '一度だけ光る').props.disabled).toBe(true)
    expect(button(view, 'ライトを消す').props.disabled).toBe(false)
  })

  it('スピード非対応の作品ではスピードスライダーを表示しない', () => {
    modern({ controls: { speed: false, modes: [{ id: 'RAINBOW', label: 'にじいろ散歩' }], actions: [] } })
    const view = panel()
    expect(all(view, element => typeof element.type === 'function' && element.props.command === 'SPEED')).toHaveLength(0)
    expect(slider('BRIGHTNESS').props.disabled).toBe(false)
    expect(all(view, element => element.type === 'button' && content(element.props.children as ReactNode).includes('一度だけ光る'))).toHaveLength(0)
    expect(all(view, element => element.type === 'button' && content(element.props.children as ReactNode).includes('アクションを実行'))).toHaveLength(0)
    expect(content(view)).toContain('この作品には、一度だけの演出はありません。')
  })

  it('受信が途絶えたら作品専用操作も無効にするが消灯と再受信は残す', () => {
    modern({ playback: 'paused' })
    panel()
    vi.advanceTimersByTime(6000)
    const view = panel()
    for (const label of ['にじいろ散歩', '落ち着いた光', '一度だけ光る', '再生', '停止']) {
      expect(button(view, label).props.disabled, label).toBe(true)
    }
    expect(button(view, 'ライトを消す').props.disabled).toBe(false)
    expect(button(view, '状態をもう一度受け取る').props.disabled).toBe(false)
  })

  it('接続後に一度も状態が来ない場合も5秒を超えたら復旧を案内する', () => {
    connected({ status: null, receivedAt: null })
    panel()
    vi.advanceTimersByTime(5000)
    expect(all(panel(), element => element.props.role === 'status' && content(element.props.children as ReactNode).includes('5秒'))).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    const view = panel()
    expect(content(view)).toContain('5秒')
    expect(content(view)).toContain('プログラム')
    expect(button(view, '状態をもう一度受け取る').props.disabled).toBe(false)
    expect(button(view, 'ライトを消す').props.disabled).toBe(false)
    event(button(view, '状態をもう一度受け取る'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('STATUS')
    modern()
    expect(content(panel())).not.toContain('5秒以上LEDの状態が届いていません')
    expect(button(panel(), '一度だけ光る').props.disabled).toBe(false)
  })

  it('v1では既存操作を残し、再生・停止・作品専用操作に更新が必要なことを案内する', () => {
    connected()
    const view = panel()
    expect(button(view, 'ピンク').props.disabled).toBe(false)
    expect(all(view, element => element.props.id === 'ble-custom-command')).toHaveLength(1)
    expect(content(view)).toContain('旧仕様（NanoLED v1）')
    expect(content(view)).toContain('新仕様の対応プログラムが必要')
    expect(all(view, element => element.type === 'button' && content(element.props.children as ReactNode).includes('一度だけ光る'))).toHaveLength(0)
    for (const label of ['再生', '停止', 'アクションを実行']) expect(button(view, label).props.disabled).toBe(true)
  })

  it.each(['en', 'zh'] as const)('%sへ表示を切り替えても作品の名前・操作ID・受信状態は変えない', locale => {
    modern()
    panel()
    harness.locale = locale
    const view = panel()
    expect(button(view, 'にじいろ散歩').props['aria-pressed']).toBe(true)
    event(button(view, '落ち着いた光'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('MODE CALM')
    event(button(view, '一度だけ光る'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('ACTION SPARK')
    expect(harness.instances).toBe(1)
    expect(harness.disconnect).not.toHaveBeenCalled()
    expect(find(view, element => element.props.title === 'LED 1: #330000').props.style).toMatchObject({ backgroundColor: '#330000' })
  })

  it('送信成功は操作送信の通知だけを出し、演出完了や状態変化とは扱わない', async () => {
    modern()
    event(button(panel(), '一度だけ光る'), 'onClick')
    await Promise.resolve()
    const view = panel()
    expect(content(view)).toContain('操作を送信しました。実行完了の確認ではありません。')
    expect(content(view)).not.toContain('「一度だけ光る」を実行中')
    expect(button(view, 'にじいろ散歩').props['aria-pressed']).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(content(panel())).not.toContain('操作を送信しました。')
  })

  it.each(['失敗', '再受信'] as const)('%sでは操作送信済み通知を出さない', async scenario => {
    modern()
    if (scenario === '失敗') harness.send.mockResolvedValueOnce(false)
    event(button(panel(), scenario === '再受信' ? '状態をもう一度受け取る' : '一度だけ光る'), 'onClick')
    await Promise.resolve()
    expect(content(panel())).not.toContain('操作を送信しました。')
  })

  it('古い接続の送信完了で再接続後の画面に成功通知を出さない', async () => {
    modern()
    let complete!: (value: boolean) => void
    harness.send.mockReturnValueOnce(new Promise<boolean>(resolve => { complete = resolve }))
    event(button(panel(), '一度だけ光る'), 'onClick')
    harness.snapshot = { ...harness.snapshot, connectedAt: Date.now() + 1 }
    complete(true)
    await Promise.resolve()
    expect(content(panel())).not.toContain('操作を送信しました。')
  })
})

describe('保存した作品のリモコン表示', () => {
  const saved: RemoteButton[] = [
    { kind: 'mode', id: 'CALM', label: '星空の待機', icon: 'heart' },
    { kind: 'action', id: 'SPARK', label: '変身', icon: 'rainbow' },
    { kind: 'mode', id: 'UNKNOWN', label: '未対応の光', icon: 'star' },
    { kind: 'action', id: 'CALM', label: '同じIDの別操作', icon: 'star' },
  ]
  const configured = (onRemoteButtonsChange = vi.fn()) => panel(undefined, undefined, { remoteButtons: saved, projectName: '魔法の杖', onRemoteButtonsChange })

  it('v2が報告した操作だけに保存名・アイコンを表示し、未知の操作を作らない', () => {
    modern()
    const view = configured()
    expect(content(view)).toContain('魔法の杖')
    expect(content(button(view, '星空の待機'))).toContain('♥')
    expect(content(button(view, '変身'))).toContain('🌈')
    expect(content(view)).not.toContain('未対応の光')
    expect(content(view)).not.toContain('同じIDの別操作')
    expect(all(view, element => element.type === RemoteButtonEditor)).toHaveLength(3)
    expect(button(view, 'にじいろ散歩')).toBeDefined()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each([['星空の待機', 'MODE CALM'], ['変身', 'ACTION SPARK']] as const)('表示名%sでも保存名ではなく受信したIDで送信する', (label, command) => {
    modern()
    event(button(configured(), label), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith(command)
  })

  it('ボタン名保存は対応項目だけを置換し、他の設定を保持して通信しない', () => {
    modern()
    const save = vi.fn()
    const editor = find(configured(save), element => element.type === RemoteButtonEditor && (element.props.value as RemoteButton).kind === 'mode' && (element.props.value as RemoteButton).id === 'CALM')
    event(editor, 'onSave', { kind: 'mode', id: 'CALM', label: 'おやすみ', icon: 'star' })
    expect(save).toHaveBeenCalledWith([
      ...saved.filter(item => item.kind !== 'mode' || item.id !== 'CALM'),
      { kind: 'mode', id: 'CALM', label: 'おやすみ', icon: 'star' },
    ])
    expect(saved[0].label).toBe('星空の待機')
    expect(harness.send).not.toHaveBeenCalled()
    expect(harness.connect).not.toHaveBeenCalled()
    expect(harness.disconnect).not.toHaveBeenCalled()
  })

  it('受信カタログが変わると古い保存名のボタンも編集欄も表示しない', () => {
    modern(); configured()
    modern({ mode: 'REST', controls: { speed: false, modes: [{ id: 'REST', label: '新しい待機' }], actions: [] } })
    const view = configured()
    expect(button(view, '新しい待機')).toBeDefined()
    expect(content(view)).not.toContain('星空の待機')
    expect(content(view)).not.toContain('変身')
    expect(all(view, element => element.type === RemoteButtonEditor)).toHaveLength(1)
  })

  it('旧仕様では保存名で標準4モードを置き換えず、表示編集も出さない', () => {
    connected()
    const view = panel(undefined, undefined, { projectName: '魔法の杖', remoteButtons: [{ kind: 'mode', id: 'PINK', label: '保存した名前', icon: 'heart' }], onRemoteButtonsChange: vi.fn() })
    expect(button(view, 'ピンク')).toBeDefined()
    expect(content(view)).not.toContain('保存した名前')
    expect(all(view, element => element.type === RemoteButtonEditor)).toHaveLength(0)
    expect(all(view, element => element.props.className === 'remote-view-toggle')).toHaveLength(0)
    event(button(view, 'ピンク'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('PINK')
  })

  it('使う画面への切り替えは通信せず、切断時は案内を隠すクラスを外す', () => {
    modern()
    event(button(configured(), '作品を使う画面にする'), 'onClick')
    expect(find(configured(), element => String(element.props.className).split(' ').includes('bluetooth-panel')).props.className).toBe('bluetooth-panel using-view')
    expect(button(configured(), '設定も表示する').props['aria-pressed']).toBe(true)
    expect(harness.send).not.toHaveBeenCalled()
    expect(harness.disconnect).not.toHaveBeenCalled()
    harness.snapshot = { phase: 'disconnected', deviceName: null, connectedAt: null, receivedAt: null, status: null, error: null, sending: false }
    const view = configured()
    expect(find(view, element => String(element.props.className).split(' ').includes('bluetooth-panel')).props.className).toBe('bluetooth-panel')
    expect(content(view)).toContain('対応プログラムの準備')
    expect(button(view, 'AIの準備へ')).toBeDefined()
    expect(button(view, 'Bluetoothでつなぐ').props.disabled).toBe(false)
    expect(content(view)).not.toContain('星空の待機')
  })

  it('使う画面でも通信が途絶えると保存名の操作を無効にし、再受信と消灯を残す', () => {
    modern({ playback: 'paused' })
    event(button(configured(), '作品を使う画面にする'), 'onClick')
    vi.advanceTimersByTime(6000)
    const view = configured()
    for (const label of ['星空の待機', '変身', '再生', '停止']) expect(button(view, label).props.disabled, label).toBe(true)
    expect(content(view)).toContain('更新停止')
    expect(button(view, 'ライトを消す').props.disabled).toBe(false)
    expect(button(view, '状態をもう一度受け取る').props.disabled).toBe(false)
  })

  it.each(['en', 'zh'] as const)('%sでも作品名・保存したボタン名と送信IDを翻訳しない', locale => {
    modern(); harness.locale = locale
    const view = configured()
    expect(content(view)).toContain('魔法の杖')
    expect(button(view, '星空の待機')).toBeDefined()
    event(button(view, '変身'), 'onClick')
    expect(harness.send).toHaveBeenLastCalledWith('ACTION SPARK')
    expect(harness.instances).toBe(1)
  })
})

describe('スライダーと追加コマンド', () => {
  it.each(['disconnected', 'connected'] as const)('%sでも状態未受信ならスライダー初期値を機器の設定と表示しない', phase => {
    harness.snapshot = { ...harness.snapshot, phase }
    for (const command of ['BRIGHTNESS', 'SPEED'] as const) {
      expect(reportedSliderValue(command)).toContain('未受信')
      expect(reportedSliderValue(command)).not.toMatch(/\d+%/u)
      expect(slider(command).props['aria-valuetext']).toBe('未受信')
      expect(slider(command).props.disabled).toBe(true)
    }
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sは0〜100の整数範囲で、操作途中では送信しない', command => {
    connected()
    const control = slider(command)
    expect(control.props).toMatchObject({ min: '0', max: '100', step: '1', disabled: false })
    expect(control.props.value).toBe(command === 'BRIGHTNESS' ? 80 : 20)
    expect(content(sliderView(command))).toContain('設定したい値')
    expect(reportedSliderValue(command)).toContain('機器から受信')
    event(control, 'onChange', { target: { value: '37' } })
    expect(harness.send).not.toHaveBeenCalled()
    expect(slider(command).props.value).toBe(37)
    event(slider(command), 'onPointerUp')
    expect(harness.send).toHaveBeenLastCalledWith(`${command} 37`)
    expect(slider(command).props.value).toBe(37)
    expect(reportedSliderValue(command)).toContain(command === 'BRIGHTNESS' ? '80%' : '20%')
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sは未編集なら初回と後続の受信値で初期化し、自動送信しない', command => {
    connected({ status: null, receivedAt: null })
    expect(reportedSliderValue(command)).toContain('未受信')
    connected()
    expect(slider(command).props.value).toBe(command === 'BRIGHTNESS' ? 80 : 20)
    receiveSliderValue(command, 64)
    expect(slider(command).props.value).toBe(64)
    expect(reportedSliderValue(command)).toContain('64%')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sは送信後に遅延・一致・別の受信値が届いても選択値を戻さない', async command => {
    modern()
    const before = command === 'BRIGHTNESS' ? 50 : 30
    event(slider(command), 'onChange', { target: { value: '37' } })
    receiveSliderValue(command, before)
    expect(slider(command).props.value).toBe(37)
    expect(reportedSliderValue(command)).toContain(`${before}%`)
    event(slider(command), 'onPointerUp')
    await Promise.resolve()
    expect(slider(command).props.value).toBe(37)
    expect(reportedSliderValue(command)).toContain(`${before}%`)
    for (const reported of [before, 37, 84, 37]) {
      receiveSliderValue(command, reported)
      expect(slider(command).props.value).toBe(37)
      expect(reportedSliderValue(command)).toContain(`${reported}%`)
    }
    expect(harness.send.mock.calls).toEqual([[`${command} 37`]])
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sの送信に失敗しても選択値は保ち、受信値や成功表示を偽装しない', async command => {
    connected()
    harness.send.mockResolvedValueOnce(false)
    event(slider(command), 'onChange', { target: { value: '37' } })
    event(slider(command), 'onPointerUp')
    await Promise.resolve()
    expect(slider(command).props.value).toBe(37)
    expect(reportedSliderValue(command)).toContain(command === 'BRIGHTNESS' ? '80%' : '20%')
    expect(content(panel())).not.toContain('操作を送信しました。')
    expect(harness.send.mock.calls).toEqual([[`${command} 37`]])
  })

  it.each(['onKeyUp', 'onBlur'] as const)('%sで確定しても選択値を維持し、未編集の操作では送信しない', handler => {
    connected()
    event(slider('SPEED'), handler)
    expect(harness.send).not.toHaveBeenCalled()
    event(slider('SPEED'), 'onChange', { target: { value: '55' } })
    event(slider('SPEED'), handler)
    expect(harness.send).toHaveBeenLastCalledWith('SPEED 55')
    expect(slider('SPEED').props.value).toBe(55)
    expect(reportedSliderValue('SPEED')).toContain('20%')
    event(slider('SPEED'), handler)
    expect(harness.send).toHaveBeenCalledTimes(1)
  })

  it('同じ描画の指離しとフォーカス離脱が続いても1回だけ送信する', () => {
    connected()
    event(slider('BRIGHTNESS'), 'onChange', { target: { value: '37' } })
    const control = slider('BRIGHTNESS')
    event(control, 'onPointerUp')
    event(control, 'onBlur')
    expect(harness.send.mock.calls).toEqual([['BRIGHTNESS 37']])
    expect(slider('BRIGHTNESS').props.value).toBe(37)
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sは変更と確定の間に再描画がなくても最新の選択値を1回だけ送信する', command => {
    connected()
    const control = slider(command)
    event(control, 'onChange', { target: { value: '37' } })
    event(control, 'onChange', { target: { value: '38' } })
    event(control, 'onPointerUp')
    event(control, 'onBlur')
    expect(harness.send.mock.calls).toEqual([[`${command} 38`]])
    expect(slider(command).props.value).toBe(38)
  })

  it('スライダー外で指を離した場合も受け取れるようにポインターを捕捉する', () => {
    connected()
    const setPointerCapture = vi.fn()
    event(slider('BRIGHTNESS'), 'onPointerDown', { pointerId: 12, currentTarget: { setPointerCapture } })
    expect(setPointerCapture).toHaveBeenCalledWith(12)
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('指操作をキャンセルしても選択値は戻さず、フォーカス離脱でも送信しない', () => {
    connected()
    event(slider('BRIGHTNESS'), 'onChange', { target: { value: '12' } })
    const control = slider('BRIGHTNESS')
    event(control, 'onPointerCancel')
    event(control, 'onBlur')
    expect(slider('BRIGHTNESS').props.value).toBe(12)
    expect(reportedSliderValue('BRIGHTNESS')).toContain('80%')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sの編集中に受信が止まっても選択値は維持し、復旧時に古い操作を送信しない', command => {
    connected()
    event(slider(command), 'onChange', { target: { value: '12' } })
    vi.advanceTimersByTime(6000)
    const control = slider(command)
    expect(control.props.disabled).toBe(true)
    expect(control.props.value).toBe(12)
    expect(reportedSliderValue(command)).toContain('最後に受信')
    expect(reportedSliderValue(command)).toContain(command === 'BRIGHTNESS' ? '80%' : '20%')
    event(control, 'onPointerUp')
    expect(harness.send).not.toHaveBeenCalled()
    receiveSliderValue(command, 64)
    const recovered = slider(command)
    expect(recovered.props.disabled).toBe(false)
    expect(recovered.props.value).toBe(12)
    expect(reportedSliderValue(command)).toContain('機器から受信')
    expect(reportedSliderValue(command)).toContain('64%')
    event(recovered, 'onBlur')
    expect(harness.send).not.toHaveBeenCalled()
    event(recovered, 'onChange', { target: { value: '13' } })
    event(slider(command), 'onPointerUp')
    expect(harness.send.mock.calls).toEqual([[`${command} 13`]])
  })

  it.each(['BRIGHTNESS', 'SPEED'] as const)('%sは切断・再接続で別の機器の受信値に初期化し、前の選択値を自動送信しない', command => {
    connected()
    event(slider(command), 'onChange', { target: { value: '12' } })
    harness.snapshot = { phase: 'disconnected', deviceName: null, connectedAt: null, receivedAt: null, status: null, error: null, sending: false }
    expect(slider(command).props.disabled).toBe(true)
    expect(reportedSliderValue(command)).toContain('未受信')
    connected({ connectedAt: Date.now() + 1, deviceName: 'NanoLED-NEW' })
    receiveSliderValue(command, 64)
    expect(slider(command).props.value).toBe(64)
    expect(reportedSliderValue(command)).toContain('64%')
    event(slider(command), 'onBlur')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('更新停止中に確定イベントがなくても保留操作を破棄し、復旧後のフォーカス離脱で送信しない', () => {
    connected()
    event(slider('SPEED'), 'onChange', { target: { value: '12' } })
    vi.advanceTimersByTime(6000)
    expect(slider('SPEED').props.disabled).toBe(true)
    receiveSliderValue('SPEED', 64)
    const recovered = slider('SPEED')
    expect(recovered.props.value).toBe(12)
    expect(recovered.props.disabled).toBe(false)
    event(recovered, 'onBlur')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it.each(['', '1STAR', 'STAR RED', 'STAR\nOFF', '光', 'ABCDEFGHIJKLMNOPQ', 'BRIGHTNESS', 'speed', 'PLAY', 'PAUSE', 'MODE', 'ACTION'])('不正な合言葉 %j は送信できない', command => {
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

  it('切断すると合言葉入力を非表示にして古い作品の操作を残さない', () => {
    connected()
    event(find(panel(), element => element.props.id === 'ble-custom-command'), 'onChange', { target: { value: 'STAR' } })
    harness.snapshot = { phase: 'disconnected', deviceName: null, connectedAt: null, receivedAt: null, status: null, error: null, sending: false }
    const view = panel()
    expect(all(view, element => element.props.id === 'ble-custom-command')).toHaveLength(0)
    expect(all(view, element => element.type === 'form')).toHaveLength(0)
    expect(button(view, 'モードを選ぶ').props.disabled).toBe(true)
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
    expect(content(sliderView('BRIGHTNESS'))).toContain('Your setting')
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

  it.each(['en', 'zh'] as const)('%sへの言語変更で確定済みの選択値と受信値を混ぜず、再送信しない', locale => {
    modern()
    for (const command of ['BRIGHTNESS', 'SPEED'] as const) {
      event(slider(command), 'onChange', { target: { value: '37' } })
      event(slider(command), 'onPointerUp')
    }
    harness.locale = locale
    for (const command of ['BRIGHTNESS', 'SPEED'] as const) {
      expect(slider(command).props.value).toBe(37)
      expect(content(sliderView(command))).toContain(bluetoothMessages['設定したい値'][locale])
      expect(reportedSliderValue(command)).toContain(bluetoothMessages['機器から受信'][locale])
      expect(reportedSliderValue(command)).toContain(command === 'BRIGHTNESS' ? '50%' : '30%')
      expect(content(sliderView(command))).not.toMatch(/[ぁ-んァ-ヶ]/u)
      event(slider(command), 'onBlur')
    }
    expect(harness.send.mock.calls).toEqual([['BRIGHTNESS 37'], ['SPEED 37']])
    expect(harness.instances).toBe(1)
    expect(harness.disconnect).not.toHaveBeenCalled()
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
    const sources = [['BluetoothPanel.tsx', panelSource], ['RemoteButtonEditor.tsx', editorSource], ['BluetoothController.ts', controllerSource], ['protocol.ts', protocolSource]]
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
