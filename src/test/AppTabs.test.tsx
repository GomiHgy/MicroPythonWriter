import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import App from '../App'
import { CodeEditor } from '../components/CodeEditor'
import { BluetoothPanel } from '../components/BluetoothPanel'
import { AiPreparationPanel } from '../components/AiPreparationPanel'
import type { AppError } from '../types'
import { setLocale } from '../i18n'

type Element = ReactElement<Record<string, unknown>>

const harness = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  preparation: { context: null as unknown },
  contexts: [] as unknown[],
  programmer: {
    state: 'running', source: 'print("keep this draft")', log: 'existing log', supported: true,
    info: { bootOption: 1, deviceName: 'NanoC6', nanoC6Confirmed: true, microPythonVersion: 'test' },
    error: undefined as AppError | undefined, baudRate: 115200,
    connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn(), run: vi.fn(), write: vi.fn(),
    setSource: vi.fn(), setLog: vi.fn(), setBaudRate: vi.fn(), load: vi.fn(), setBoot: vi.fn(), normalMode: vi.fn(), reset: vi.fn(), reconnect: vi.fn(),
  },
  focus: vi.fn(), getElementById: vi.fn(),
}))

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [harness.slots[index], (next: Value | ((previous: Value) => Value)) => {
      harness.slots[index] = typeof next === 'function' ? (next as (previous: Value) => Value)(harness.slots[index] as Value) : next
    }]
  },
  useEffect: vi.fn(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))
vi.mock('../hooks/useProgrammer', () => ({ useProgrammer: (context: unknown) => { harness.contexts.push(context); return harness.programmer } }))
vi.mock('../hooks/useWorkshopPreparation', () => ({ useWorkshopPreparation: () => harness.preparation }))
vi.mock('../components/CodeEditor', () => ({ CodeEditor: () => null }))
vi.mock('../components/Terminal', () => ({ Terminal: () => null }))
vi.mock('../components/BluetoothPanel', () => ({ BluetoothPanel: () => null }))
vi.mock('../components/AiPreparationPanel', () => ({ AiPreparationPanel: () => null }))

function render(): ReactNode { harness.cursor = 0; return App() }

function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}

function find(node: ReactNode, predicate: (element: Element) => boolean): Element {
  const found = all(node, predicate)
  expect(found).toHaveLength(1)
  return found[0]
}

function byId(node: ReactNode, id: string) { return find(node, element => element.props.id === id) }

function event(element: Element, name: string, value?: unknown) {
  const handler = element.props[name]
  expect(handler).toBeTypeOf('function')
  return (handler as (event: unknown) => unknown)(value)
}

beforeEach(() => {
  setLocale('ja')
  harness.slots = []; harness.cursor = 0
  harness.preparation.context = null; harness.contexts = []; harness.programmer.error = undefined
  harness.programmer.state = 'running'; harness.programmer.supported = true; harness.programmer.source = 'print("keep this draft")'
  vi.clearAllMocks()
  harness.programmer.setSource.mockImplementation((value: string) => { harness.programmer.source = value })
  harness.getElementById.mockReturnValue({ focus: harness.focus })
  vi.stubGlobal('localStorage', { getItem: () => null })
  vi.stubGlobal('document', { getElementById: harness.getElementById })
})

afterEach(() => { setLocale('ja'); vi.unstubAllGlobals() })

it('最初はプログラムタブを表示し、両タブの見出しとパネルを関連付ける', () => {
  const view = render()
  expect(byId(view, 'tab-program').props).toMatchObject({ role: 'tab', 'aria-selected': true, 'aria-controls': 'panel-program', tabIndex: 0 })
  expect(byId(view, 'tab-controller').props).toMatchObject({ role: 'tab', 'aria-selected': false, 'aria-controls': 'panel-controller', tabIndex: -1 })
  expect(byId(view, 'panel-program').props).toMatchObject({ role: 'tabpanel', hidden: false, 'aria-labelledby': 'tab-program' })
  expect(byId(view, 'panel-controller').props).toMatchObject({ role: 'tabpanel', hidden: true, 'aria-labelledby': 'tab-controller' })
})

it('タブを切り替えても両パネルを保持し、USB切断やプログラム停止を行わない', () => {
  let view = render()
  const beforeEditor = find(view, element => element.type === CodeEditor)
  event(byId(view, 'tab-controller'), 'onClick')
  view = render()
  expect(byId(view, 'panel-program').props.hidden).toBe(true)
  expect(byId(view, 'panel-controller').props.hidden).toBe(false)
  expect(find(view, element => element.type === CodeEditor).props).toEqual(beforeEditor.props)
  expect(all(view, element => element.type === BluetoothPanel)).toHaveLength(1)
  event(byId(view, 'tab-program'), 'onClick')
  view = render()
  expect(byId(view, 'panel-program').props.hidden).toBe(false)
  expect(all(view, element => element.type === BluetoothPanel)).toHaveLength(1)
  expect(harness.programmer.stop).not.toHaveBeenCalled()
  expect(harness.programmer.disconnect).not.toHaveBeenCalled()
  expect(harness.programmer.run).not.toHaveBeenCalled()
})

it('編集した下書きをコントローラ画面への往復後も保持する', () => {
  let view = render()
  event(find(view, element => element.type === CodeEditor), 'onChange', 'print("edited")')
  event(byId(view, 'tab-controller'), 'onClick')
  view = render()
  event(byId(view, 'tab-program'), 'onClick')
  expect(find(render(), element => element.type === CodeEditor).props.value).toBe('print("edited")')
  expect(harness.programmer.write).not.toHaveBeenCalled()
})

it('キーボードでタブを移動し、選んだ見出しへフォーカスを合わせる', () => {
  const keys = [['ArrowRight', 'controller'], ['ArrowLeft', 'program'], ['End', 'controller'], ['Home', 'preparation']]
  for (const [key, expected] of keys) {
    const preventDefault = vi.fn()
    event(find(render(), element => element.props.role === 'tablist'), 'onKeyDown', { key, preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(byId(render(), `tab-${expected}`).props['aria-selected']).toBe(true)
    expect(harness.getElementById).toHaveBeenLastCalledWith(`tab-${expected}`)
  }
  expect(harness.focus).toHaveBeenCalledTimes(4)
})

it('USB非対応環境でもBluetoothコントローラタブへ移動できる', () => {
  harness.programmer.supported = false; harness.programmer.state = 'unsupported'
  event(byId(render(), 'tab-controller'), 'onClick')
  const view = render()
  expect(byId(view, 'panel-controller').props.hidden).toBe(false)
  expect(all(view, element => element.type === BluetoothPanel)).toHaveLength(1)
})

it('Bluetooth画面の準備リンクからプログラムへ戻り、見出しにフォーカスする', () => {
  event(byId(render(), 'tab-controller'), 'onClick')
  event(find(render(), element => element.type === BluetoothPanel), 'onOpenProgram')
  expect(byId(render(), 'panel-program').props.hidden).toBe(false)
  expect(harness.getElementById).toHaveBeenLastCalledWith('tab-program')
  expect(harness.focus).toHaveBeenCalledTimes(1)
})

it('AIの準備へ移動しても3つのパネルと編集内容を保持する', () => {
  const before = find(render(), element => element.type === CodeEditor).props
  event(byId(render(), 'tab-preparation'), 'onClick')
  const view = render()
  expect(byId(view, 'panel-preparation').props).toMatchObject({ role: 'tabpanel', hidden: false, 'aria-labelledby': 'tab-preparation' })
  expect(byId(view, 'panel-program').props.hidden).toBe(true)
  expect(byId(view, 'panel-controller').props.hidden).toBe(true)
  expect(find(view, element => element.type === CodeEditor).props).toEqual(before)
  expect(all(view, element => element.type === BluetoothPanel)).toHaveLength(1)
  expect(find(view, element => element.type === AiPreparationPanel).props.preparation).toBe(harness.preparation)
  event(find(view, element => element.type === AiPreparationPanel), 'onOpenProgram')
  expect(byId(render(), 'panel-program').props.hidden).toBe(false)
  for (const operation of ['connect', 'disconnect', 'run', 'stop', 'write', 'reset'] as const) expect(harness.programmer[operation]).not.toHaveBeenCalled()
})

it('USB非対応でもAI準備を開けて、不正を含む選択文脈を通信hookへ渡す', () => {
  harness.programmer.supported = false; harness.programmer.state = 'unsupported'
  harness.preparation.context = { errors: ['LED数が未設定です'], profile: { kitId: '001' } }
  event(byId(render(), 'tab-preparation'), 'onClick')
  expect(byId(render(), 'panel-preparation').props.hidden).toBe(false)
  expect(harness.contexts.at(-1)).toBe(harness.preparation.context)
  expect(harness.programmer.write).not.toHaveBeenCalled()
  expect(harness.programmer.disconnect).not.toHaveBeenCalled()
})

it('設定ストレージが利用不可でもAIの準備を表示できる', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('SecurityError') } })
  expect(() => render()).not.toThrow()
  event(byId(render(), 'tab-preparation'), 'onClick')
  expect(byId(render(), 'panel-preparation').props.hidden).toBe(false)
})

it('修正依頼の秘密情報確認は現在の編集欄ではなく持ち出す全文を対象にする', async () => {
  harness.programmer.error = { exceptionType: 'Error', message: 'test', traceback: 'test', intentionalInterrupt: false, stage: '実行', repairPrompt: '基準コードとログ\npassword = "private-value"' }
  const confirmation = vi.fn(() => false)
  const writeText = vi.fn()
  vi.stubGlobal('confirm', confirmation)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  await event(find(render(), element => element.type === 'button' && element.props.children === 'AIに相談する文章をコピー'), 'onClick')
  expect(confirmation).toHaveBeenCalledTimes(1)
  expect(writeText).not.toHaveBeenCalled()
})

it('エラー後に変更された編集コードへ過去のエラー行を表示しない', () => {
  harness.programmer.error = { exceptionType: 'Error', message: 'test', traceback: 'test', intentionalInterrupt: false, stage: '実行', repairPrompt: 'old error', sourceSnapshot: 'old code', sourceKnown: true, line: 7 }
  expect(find(render(), element => element.type === CodeEditor).props.errorLine).toBeUndefined()
})

it('機器上のコードが未取得の場合は編集コードにエラー行を表示しない', () => {
  harness.programmer.error = { exceptionType: 'Error', message: 'test', traceback: 'test', intentionalInterrupt: false, stage: '停止', repairPrompt: 'unknown code', sourceKnown: false, line: 7 }
  expect(find(render(), element => element.type === CodeEditor).props.errorLine).toBeUndefined()
})

it.each([['en', 'Program', 'Language'], ['zh', '程序', '显示语言']])('言語 %s を切り替えても編集・タブ・機器操作を維持する', (locale, programLabel, languageLabel) => {
  event(byId(render(), 'tab-preparation'), 'onClick')
  const editorBefore = find(render(), element => element.type === CodeEditor).props.value
  const selector = find(render(), element => element.type === 'select' && element.props['aria-label'] === '表示言語')
  event(selector, 'onChange', { target: { value: locale } })
  const view = render()
  expect(byId(view, 'tab-program').props.children).toContain(programLabel)
  expect(byId(view, 'panel-preparation').props.hidden).toBe(false)
  expect(find(view, element => element.type === 'select' && element.props['aria-label'] === languageLabel).props.value).toBe(locale)
  expect(find(view, element => element.type === CodeEditor).props.value).toBe(editorBefore)
  expect(all(view, element => element.type === BluetoothPanel)).toHaveLength(1)
  for (const operation of ['connect', 'disconnect', 'run', 'stop', 'write', 'reset'] as const) expect(harness.programmer[operation]).not.toHaveBeenCalled()
})
