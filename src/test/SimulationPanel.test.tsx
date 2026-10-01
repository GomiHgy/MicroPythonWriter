import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimulationPanel, type SimulationPanelProps } from '../components/SimulationPanel'
import { simulationMessages } from '../i18n/simulationMessages'
import type { SimulationSnapshot } from '../services/simulation/types'
import { observeLedCurrent } from '../services/simulation/LedCurrent'

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as { deps?: unknown[]; run: () => unknown }[], effectCursor: 0, pending: [] as (() => unknown)[], supported: true, emit: null as null | ((state: SimulationSnapshot) => void), locale: 'ja' as 'ja' | 'en' | 'zh', start: vi.fn(), pause: vi.fn(), resume: vi.fn(), reset: vi.fn(), button: vi.fn(), command: vi.fn(), dispose: vi.fn() }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [harness.slots[index], (next: Value | ((old: Value) => Value)) => { harness.slots[index] = typeof next === 'function' ? (next as (old: Value) => Value)(harness.slots[index] as Value) : next }]
  },
  useRef: <Value,>(initial: Value) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useEffect: (run: () => unknown, deps?: unknown[]) => {
    const index = harness.effectCursor++, old = harness.effects[index]
    harness.effects[index] = { run, deps }
    if (!old || !deps || deps.some((value, position) => !Object.is(value, old.deps?.[position]))) harness.pending.push(run)
  },
}))
vi.mock('../services/simulation/SimulationClient', () => ({
  isSimulationSupported: () => harness.supported,
  SimulationClient: class {
    constructor(emit: (state: SimulationSnapshot) => void) { harness.emit = emit }
    start = harness.start
    pause = harness.pause
    resume = harness.resume
    reset = harness.reset
    button = harness.button
    command = harness.command
    dispose = harness.dispose
  },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ locale: harness.locale, t: (key: string, params: Record<string, string | number> = {}) => (harness.locale === 'ja' ? key : simulationMessages[key]?.[harness.locale] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) }) }))

type Element = ReactElement<Record<string, unknown>>
let props: SimulationPanelProps
const snapshot = (override: Partial<SimulationSnapshot> = {}): SimulationSnapshot => {
  const pixels: SimulationSnapshot['pixels'] = override.pixels ?? [[255, 0, 0], [0, 32, 0]]
  return { phase: 'running', pixels, ledCurrent: pixels.length ? observeLedCurrent(null, pixels) : null, elapsedMs: 120, bleEnabled: false, modes: [], actions: [], log: '', error: '', ...override }
}
function render() { harness.cursor = 0; harness.effectCursor = 0; const view = SimulationPanel(props); const effects = harness.pending.splice(0); effects.forEach(effect => effect()); return view }
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
function find(predicate: (element: Element) => boolean) { const found = all(render(), predicate); expect(found).toHaveLength(1); return found[0] }
function button(label: string) { return find(element => element.type === 'button' && text(element) === label) }
function invoke(element: Element, handler: string, event?: unknown) { (element.props[handler] as (event: unknown) => unknown)(event) }
function click(label: string) { invoke(button(label), 'onClick') }
function start(state: Partial<SimulationSnapshot> = {}) { click('▶ シミュレーションを再生'); harness.emit?.(snapshot(state)); render() }
function input(id: string) { return find(element => element.props.id === id) }
function change(element: Element, value: string) { invoke(element, 'onChange', { target: { value } }) }

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.effectCursor = 0; harness.pending = []; harness.emit = null; harness.supported = true; harness.locale = 'ja'
  vi.clearAllMocks()
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  props = { source: 'from machine import Pin\nprint("unchanged")\n', settings: null, active: true }
})
afterEach(() => { vi.unstubAllGlobals() })

describe('画面だけのLEDシミュレーションUI', () => {
  it('USBなしでも初期値で試せて、開始前は本体ボタンが無効・BLE操作は非表示', () => {
    const view = render()
    expect(text(view)).toContain('実機への書き込みやBluetooth通信は行いません')
    expect(text(view)).toContain('GPIO 2・LED 10個')
    expect(button('▶ シミュレーションを再生').props.disabled).toBe(false)
    expect(button('● 本体ボタン（押している間ON）').props.disabled).toBe(true)
    expect(text(view)).not.toContain('BLEリモコンを試す（仮想通信）')
    expect(harness.start).not.toHaveBeenCalled()
    click('▶ シミュレーションを再生')
    expect(harness.start).toHaveBeenCalledWith(props.source, { boardId: 'm5nanoc6', ledPin: 2, ledCount: 10, buttonPin: 9 })
  })

  it('保存設定とAtomS3Liteの内蔵ボタンピンを使い、コードは変更しない', () => {
    props.settings = { boardId: 'atoms3lite', ledPin: 8, ledCount: 37, firmwareVersion: '2.5.3', ledModel: 'WS2812B', maxBrightnessPercent: 20 }
    start()
    expect(harness.start).toHaveBeenCalledWith(props.source, { boardId: 'atoms3lite', ledPin: 8, ledCount: 37, buttonPin: 41 })
    expect(text(render())).toContain('GPIO 41')
  })

  it('一時停止と再開は同じ実行を保ち、リセットは再実行しない', () => {
    start()
    click('Ⅱ シミュレーションを一時停止')
    expect(harness.pause).toHaveBeenCalledOnce()
    harness.emit?.(snapshot({ phase: 'paused' }))
    click('▶ シミュレーションを再開')
    expect(harness.resume).toHaveBeenCalledOnce()
    click('↺ リセット')
    expect(harness.reset).toHaveBeenCalledOnce()
    expect(harness.start).toHaveBeenCalledOnce()
    expect(text(render())).toContain('再生すると試せます')
  })

  it('コード変更を検出すると停止を要求し、再開ではなく最新コードで開始する', () => {
    start()
    props.source = '# newest\nprint(2)'
    render()
    expect(harness.pause).toHaveBeenCalledOnce()
    harness.emit?.(snapshot({ phase: 'paused' }))
    expect(text(render())).toContain('コードまたは設定が変わりました')
    click('▶ 最新コードで再生')
    expect(harness.start).toHaveBeenLastCalledWith(props.source, expect.anything())
    expect(harness.resume).not.toHaveBeenCalled()
  })

  it('別タブへ移ると入力を離して一時停止し、ロード終了が後でも停止する', () => {
    start({ phase: 'loading' })
    props.active = false
    render()
    expect(harness.button).toHaveBeenCalledWith(false)
    harness.pause.mockClear()
    harness.emit?.(snapshot())
    render()
    expect(harness.pause).toHaveBeenCalledOnce()
    expect(button('● 本体ボタン（押している間ON）').props.disabled).toBe(true)
  })

  it('本体ボタンはポインターの押下・解放・キャンセルを伝える', () => {
    start()
    const press = { button: 0, pointerId: 4, currentTarget: { setPointerCapture: vi.fn() } }
    invoke(button('● 本体ボタン（押している間ON）'), 'onPointerDown', press)
    expect(press.currentTarget.setPointerCapture).toHaveBeenCalledWith(4)
    expect(harness.button).toHaveBeenLastCalledWith(true)
    expect(button('● ボタンを押しています').props['aria-pressed']).toBe(true)
    invoke(button('● ボタンを押しています'), 'onPointerCancel')
    expect(harness.button).toHaveBeenLastCalledWith(false)
    expect(button('● 本体ボタン（押している間ON）').props['aria-pressed']).toBe(false)
  })

  it('キーボードの押下・解放とフォーカス喪失に対応し、キーリピートは再押下しない', () => {
    start()
    const key = { key: ' ', repeat: false, preventDefault: vi.fn() }
    invoke(button('● 本体ボタン（押している間ON）'), 'onKeyDown', key)
    invoke(button('● ボタンを押しています'), 'onKeyDown', { ...key, repeat: true })
    expect(harness.button.mock.calls.filter(call => call[0] === true)).toHaveLength(1)
    invoke(button('● ボタンを押しています'), 'onKeyUp', key)
    expect(harness.button).toHaveBeenLastCalledWith(false)
    invoke(button('● 本体ボタン（押している間ON）'), 'onKeyDown', { ...key, key: 'Enter' })
    invoke(button('● ボタンを押しています'), 'onBlur')
    expect(harness.button).toHaveBeenLastCalledWith(false)
  })

  it('BLE有効後だけ標準命令・コードから受け取った名前付きモードと演出を表示する', () => {
    start({ bleEnabled: true, modes: [{ id: 'STARS', label: '星空' }], actions: [{ id: 'FLASH', label: 'フラッシュ' }] })
    click('▶ LEDを再生'); click('Ⅱ LEDを停止'); click('○ ライトを消す'); click('星空'); click('フラッシュ')
    expect(harness.command.mock.calls.map(call => call[0])).toEqual(['PLAY', 'PAUSE', 'OFF', 'MODE STARS', 'ACTION FLASH'])
    change(input('simulation-brightness'), '43')
    expect(harness.command).toHaveBeenCalledTimes(5)
    invoke(input('simulation-brightness'), 'onPointerUp')
    expect(harness.command).toHaveBeenLastCalledWith('BRIGHTNESS 43')
    expect(input('simulation-brightness').props.value).toBe(43)
  })

  it('明るさの両端は0%と100%で、その値を仮想BLEへ送る', () => {
    start({ bleEnabled: true })
    expect(input('simulation-brightness').props).toMatchObject({ min: '0', max: '100', step: '1' })
    change(input('simulation-brightness'), '0')
    invoke(input('simulation-brightness'), 'onKeyUp')
    expect(input('simulation-brightness').props.value).toBe(0)
    expect(harness.command).toHaveBeenLastCalledWith('BRIGHTNESS 0')
    change(input('simulation-brightness'), '100')
    invoke(input('simulation-brightness'), 'onPointerUp')
    expect(input('simulation-brightness').props.value).toBe(100)
    expect(harness.command).toHaveBeenLastCalledWith('BRIGHTNESS 100')
  })

  it('不正な演出IDを送らず、停止中はBLE操作を無効にする', () => {
    start({ bleEnabled: true })
    change(input('simulation-action'), 'PLAY')
    expect(button('演出を送る').props.disabled).toBe(true)
    change(input('simulation-action'), 'flash_1')
    expect(button('演出を送る').props.disabled).toBe(false)
    click('演出を送る')
    expect(harness.command).toHaveBeenLastCalledWith('ACTION FLASH_1')
    harness.emit?.(snapshot({ phase: 'paused', bleEnabled: true }))
    expect(button('▶ LEDを再生').props.disabled).toBe(true)
    expect(input('simulation-brightness').props.disabled).toBe(true)
  })

  it('テープ・リング切り替えで実行をやり直さず、出力RGBをそのまま描く', () => {
    start()
    expect(all(render(), element => element.type === 'circle' && element.props.fill === 'rgb(0,32,0)')).toHaveLength(1)
    click('リング')
    expect(button('リング').props['aria-pressed']).toBe(true)
    expect(button('テープ').props['aria-pressed']).toBe(false)
    expect(harness.start).toHaveBeenCalledOnce()
    expect(find(element => element.type === 'svg').props['aria-label']).toContain('10個中2個')
  })

  it('表示中の機器・GPIOを折りたたみ外にも示し、出力LED数の不一致を知らせる', () => {
    const before = render()
    const summary = all(before, element => element.props.className === 'simulation-display-meta')
    expect(text(summary)).toContain('M5NanoC6 · GPIO 2')
    expect(text(before)).not.toContain('コードの出力は')
    start()
    expect(text(render())).toContain('コードの出力は2個、表示設定は10個です')
    expect(find(element => element.type === 'svg').props['aria-label']).toContain('10個中2個')
    harness.emit?.(snapshot({ pixels: Array.from({ length: 10 }, () => [0, 0, 0]) }))
    expect(text(render())).not.toContain('コードの出力は')
    expect(harness.start).toHaveBeenCalledOnce()
  })

  it('実行コードの注意とCPythonである制約を案内し、準備中だけダウンロード量を示す', () => {
    expect(text(render())).toContain('内容が分からないコードは実行しないでください')
    expect(text(render())).toContain('Pyodide（CPython）')
    expect(text(render())).not.toContain('初回は約12MB')
    start({ phase: 'loading' })
    expect(text(render())).toContain('初回は約12MB')
    harness.emit?.(snapshot())
    expect(text(render())).not.toContain('初回は約12MB')
  })

  it.each([1, 37, 300])('出力LED数%dをワンクリックで反映し、演出や元の設定を変更しない', count => {
    props.settings = { boardId: 'atoms3lite', ledPin: 8, ledCount: 10, firmwareVersion: '2.5.3', ledModel: 'WS2812B', maxBrightnessPercent: 20 }
    const original = structuredClone(props)
    start({ pixels: Array.from({ length: count }, () => [12, 34, 56]) })
    click('コードのLED数を反映')
    expect(find(element => element.type === 'svg').props['aria-label']).toContain(`${count}個中${count}個`)
    expect(find(element => element.type === 'input' && element.props.max === '300').props.value).toBe(count)
    expect(text(render())).toContain(`表示するLED数を${count}個に変更しました`)
    expect(text(render())).not.toContain('コードの出力は')
    expect(text(render())).not.toContain('コードまたは設定が変わりました')
    expect(harness.start).toHaveBeenCalledOnce()
    expect(harness.pause).not.toHaveBeenCalled()
    expect(harness.reset).not.toHaveBeenCalled()
    expect(harness.command).not.toHaveBeenCalled()
    expect(props).toEqual(original)
    click('↺ リセット')
    expect(text(render())).not.toContain('表示するLED数を')
    click('▶ シミュレーションを再生')
    expect(harness.start).toHaveBeenLastCalledWith(original.source, expect.objectContaining({ ledCount: count, ledPin: 8, buttonPin: 41 }))
  })

  it.each(['paused', 'finished'] as const)('%sでも反映でき、自動再開・再実行しない', phase => {
    start({ phase })
    click('コードのLED数を反映')
    expect(text(render())).toContain('表示するLED数を2個に変更しました')
    expect(harness.start).toHaveBeenCalledOnce()
    expect(harness.resume).not.toHaveBeenCalled()
    expect(harness.pause).not.toHaveBeenCalled()
  })

  it('編集後の古い出力を最新コードの個数として反映しない', () => {
    start()
    props.source = 'print("new source")'
    expect(button('コードのLED数を反映').props.disabled).toBe(true)
    click('コードのLED数を反映')
    expect(find(element => element.type === 'input' && element.props.max === '300').props.value).toBe(10)
    expect(text(render())).not.toContain('表示するLED数を')
  })

  it('再生準備中・未出力・上限を超える出力は反映しない', () => {
    expect(all(render(), element => element.type === 'button' && text(element) === 'コードのLED数を反映')).toHaveLength(0)
    start({ phase: 'loading' })
    expect(button('コードのLED数を反映').props.disabled).toBe(true)
    harness.emit?.(snapshot({ pixels: [] }))
    expect(all(render(), element => element.type === 'button' && text(element) === 'コードのLED数を反映')).toHaveLength(0)
    harness.emit?.(snapshot({ pixels: Array.from({ length: 301 }, () => [0, 0, 0]) }))
    expect(button('コードのLED数を反映').props.disabled).toBe(true)
  })

  it.each(['en', 'zh'] as const)('%sでもLED数反映ボタンと結果を翻訳する', locale => {
    start()
    harness.locale = locale
    click(simulationMessages['コードのLED数を反映'][locale])
    expect(text(render())).toContain(simulationMessages['表示するLED数を{count}個に変更しました。コードや実機の設定は変更していません。'][locale].replace('{count}', '2'))
  })

  it('初回のLED出力前は0mAという実測風の値を出さず、リセットで電流と最大値を消す', () => {
    expect(text(render())).toContain('最新コードからLEDへの出力を受け取ると計算します')
    start({ ledCurrent: null })
    expect(text(render())).not.toContain('約 0.0 mA')
    const pixels: SimulationSnapshot['pixels'] = Array.from({ length: 30 }, () => [255, 255, 255])
    harness.emit?.(snapshot({ pixels }))
    expect(text(render())).toContain('約 1830.0 mA')
    click('↺ リセット')
    expect(text(render())).not.toContain('約 1830.0 mA')
    expect(text(all(render(), node => node.props.role === 'alert'))).not.toContain('600mA')
  })

  it('表示個数10個でも全30個の出力を合計し、600mA超で1Aヒューズの注意を出す', () => {
    start({ pixels: Array.from({ length: 30 }, () => [255, 255, 255]) })
    const view = text(render())
    expect(view).toContain('約 1830.0 mA')
    expect(view).toContain('GPIO 2に出力された全30個を計算')
    expect(text(all(render(), node => node.props.role === 'alert'))).toContain('1Aヒューズが働いて消灯する可能性')
    expect(text(all(render(), node => node.props.role === 'alert'))).toContain('明るさ、あるいは同時に光るLEDの数を減らし、消費電流値を600mA未満にすることを推奨します。')
    expect(view).toContain('600mAは早めの注意基準で、1Aヒューズの作動点ではありません')
    expect(harness.start).toHaveBeenCalledOnce()
  })

  it('補正後RGBにゲインと設定の最大輝度を二重適用しない', () => {
    props.settings = { boardId: 'm5nanoc6', ledPin: 2, ledCount: 1, firmwareVersion: '', ledModel: 'WS2812B-MINI', maxBrightnessPercent: 20 }
    start({ pixels: [[255, 178, 242]] })
    expect(input('simulation-led-model').props.value).toBe('WS2812B-MINI')
    expect(text(render())).toContain('約 32.4 mA')
    expect(text(render())).toContain('二重に補正しません')
  })

  it('型番を変えると実行を止めず電流と最大値を再計算する', () => {
    start({ pixels: Array.from({ length: 30 }, () => [255, 255, 255]) })
    change(input('simulation-led-model'), 'WS2812C-2020')
    expect(text(render())).toContain('約 465.0 mA')
    expect(text(all(render(), node => node.props.role === 'alert'))).not.toContain('600mA')
    expect(harness.start).toHaveBeenCalledOnce()
    expect(harness.pause).not.toHaveBeenCalled()
    expect(props.settings).toBeNull()
    expect(harness.command).not.toHaveBeenCalled()
  })

  it.each([500, 599.99, 600, 600.01])('600mAちょうどは注意を出さず、超えたときだけ注意する（%s）', peak => {
    const ledCurrent = observeLedCurrent(null, [[0, 0, 0]])
    ledCurrent.peakMa.WS2812B = peak
    start({ ledCurrent })
    expect(text(all(render(), node => node.props.role === 'alert')).includes('600mA')).toBe(peak > 600)
  })

  it('消灯後や一時停止中も再生中の最大値と注意を保持し、コード編集時は古い推定を隠す', () => {
    const on: SimulationSnapshot['pixels'] = Array.from({ length: 30 }, () => [255, 255, 255])
    start({ pixels: on })
    const off: SimulationSnapshot['pixels'] = on.map(() => [0, 0, 0])
    harness.emit?.(snapshot({ pixels: off, phase: 'paused', ledCurrent: observeLedCurrent(observeLedCurrent(null, on), off) }))
    expect(text(render())).toContain('約 30.0 mA')
    expect(text(render())).toContain('約 1830.0 mA')
    expect(text(all(render(), node => node.props.role === 'alert'))).toContain('600mA')
    props.source += '\n# edited'
    expect(text(render())).not.toContain('約 1830.0 mA')
    expect(text(render())).toContain('最新コードからLEDへの出力を受け取ると計算します')
  })

  it.each(['en', 'zh'] as const)('%sでも電流・警告・計算条件を翻訳する', locale => {
    start({ pixels: Array.from({ length: 30 }, () => [255, 255, 255]) })
    harness.locale = locale
    const result = text(render())
    for (const key of ['LED全体の推定電流', 'この再生中に600mAを超える出力がありました', '電流の計算条件・注意点']) expect(result).toContain(simulationMessages[key][locale])
  })

  it('空コード・非対応ブラウザ・不正なLED数のときは開始しない', () => {
    props.source = '  '
    expect(button('▶ シミュレーションを再生').props.disabled).toBe(true)
    props.source = 'print(1)'; harness.supported = false
    expect(button('▶ シミュレーションを再生').props.disabled).toBe(true)
    expect(text(render())).toContain('この環境ではシミュレーターを動かせません')
    harness.supported = true
    const count = find(element => element.type === 'input' && element.props.max === '300')
    change(count, '301')
    expect(button('▶ シミュレーションを再生').props.disabled).toBe(true)
    expect(harness.start).not.toHaveBeenCalled()
  })

  it('実行エラーを見せ、シミュレーションと実機の保証を分ける', () => {
    start({ phase: 'error', error: 'NotImplementedError: I2C', log: 'before error' })
    const alerts = all(render(), element => element.props.role === 'alert')
    expect(text(alerts)).toContain('NotImplementedError: I2C')
    expect(text(alerts)).toContain('実機でも動かないとは判断できません')
    expect(text(render())).toContain('before error')
    expect(all(render(), element => element.type === 'details').every(element => element.props.open === undefined)).toBe(true)
  })

  it.each(['en', 'zh'] as const)('%sでも主要操作と注意事項を翻訳する', locale => {
    harness.locale = locale
    const result = text(render())
    expect(result).toContain(simulationMessages['LED・ボタンのシミュレーション'][locale])
    expect(result).toContain(simulationMessages['▶ シミュレーションを再生'][locale])
    expect(result).toContain(simulationMessages['画面の色・明るさ・時間は目安です。配線、電源、実際のLEDの発色、UIFlow2固有の機能は実機で確認してください。'][locale])
  })
})
