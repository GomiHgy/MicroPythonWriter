import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import App from '../App'
import { CodeEditor } from '../components/CodeEditor'
import { BluetoothPanel } from '../components/BluetoothPanel'
import { AiPreparationPanel } from '../components/AiPreparationPanel'
import { MakerPanel } from '../components/MakerPanel'
import { ProgramResult } from '../components/ProgramResult'
import type { ProgramFeedback } from '../types/programFeedback'
import { createProject, markWorking, PROJECT_DRAFT_STORAGE_KEY, PROJECT_STORAGE_KEY, serializeProject } from '../services/projects/ProjectStorage'
import type { ArtworkProject } from '../services/projects/types'
import type { AppError } from '../types'
import { setLocale, translate } from '../i18n'

type Element = ReactElement<Record<string, unknown>>

const harness = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  preparation: { context: null as unknown, hasPendingChanges: false, isImporting: false, adoptProjectSettings: vi.fn() },
  contexts: [] as unknown[],
  initialSources: [] as unknown[], sourceAuthorities: [] as unknown[], effects: [] as (() => void)[], runDependentEffects: false,
  starterVerified: false, starterSource: 'print("starter")\n', starterThrows: false,
  values: new Map<string, string>(), getItem: vi.fn(), setItem: vi.fn(), confirm: vi.fn(),
  anchor: { href: '', download: '', click: vi.fn() },
  programmer: {
    state: 'running', source: 'print("keep this draft")', log: 'existing log', supported: true,
    runningSource: 'print("keep this draft")' as string | null, writtenSource: 'print("keep this draft")' as string | null,
    bootConfigured: null as { mode: 0 | 1; source: string | null } | null,
    programFeedback: null as ProgramFeedback | null,
    info: { bootOption: 1, deviceName: 'NanoC6', nanoC6Confirmed: true, microPythonVersion: 'test', boardId: 'm5nanoc6', bootOptionSupported: true, nvsFallbackSupported: false },
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
  useRef: <Value,>(initial: Value) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useEffect: (effect: () => void, dependencies?: unknown[]) => { if (!dependencies || harness.runDependentEffects) harness.effects.push(effect) },
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))
vi.mock('../hooks/useProgrammer', () => ({ useProgrammer: (context: unknown, source: unknown, authoritative: unknown) => { harness.contexts.push(context); harness.initialSources.push(source); harness.sourceAuthorities.push(authoritative); return harness.programmer } }))
vi.mock('../hooks/useWorkshopPreparation', () => ({ useWorkshopPreparation: () => harness.preparation }))
vi.mock('../components/CodeEditor', () => ({ CodeEditor: () => null }))
vi.mock('../components/Terminal', () => ({ Terminal: () => null }))
vi.mock('../components/BluetoothPanel', () => ({ BluetoothPanel: () => null }))
vi.mock('../components/AiPreparationPanel', () => ({ AiPreparationPanel: () => null }))
vi.mock('../components/MakerPanel', () => ({ MakerPanel: () => null }))
vi.mock('../services/projects/StarterProgram', () => ({ buildStarterProgram: () => { if (harness.starterThrows) throw new Error('設定が不正です'); return harness.starterSource }, starterAvailability: () => ({ verified: harness.starterVerified, reason: '実機未確認です。' }) }))

function render(): ReactNode {
  harness.cursor = 0; harness.effects = []
  const view = App()
  harness.effects.forEach(effect => effect())
  return view
}

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
function maker() { return find(render(), element => element.type === MakerPanel) }
function currentProject() { return maker().props.project as ArtworkProject }
function editorContent(props: Record<string, unknown>) { return { ...props, onRun: undefined } }
function aiPanel() { return find(render(), element => element.type === AiPreparationPanel) }
function controllerTrial() {
  const draft = structuredClone(createProject().draft)
  draft.settings.firmwareVersion = '2.4.1'
  draft.settings.ledCount = 24
  draft.recipe.wireless = true
  const trial = { settings: draft.settings, recipe: draft.recipe, source: harness.starterSource }
  harness.preparation.context = { profile: draft.settings, errors: [], bleSource: 'bundled-candidate', controllerEnabled: true, controllerStarter: trial }
  return trial
}
function assertNoUsbOperations() {
  for (const operation of ['connect', 'disconnect', 'run', 'stop', 'write', 'reset', 'load', 'setBoot', 'normalMode'] as const) expect(harness.programmer[operation], operation).not.toHaveBeenCalled()
}

it.each((['maker', 'program', 'preparation', 'controller'] as const).flatMap(tab => (['ja', 'en', 'zh'] as const).map(locale => [tab, locale] as const)))('%sタブの%sでも共通のバージョン欄を表示する', (tab, locale) => {
  setLocale(locale)
  let view = render()
  event(byId(view, `tab-${tab}`), 'onClick')
  view = render()
  const footer = find(view, element => element.props.className === 'app-version')
  expect(footer.type).toBe('footer')
  expect(footer.props['aria-label']).toBe(translate(locale, 'アプリのバージョン情報'))
  expect(find(footer, element => element.type === 'code').props.children).toBe(__APP_BUILD__.revision ?? translate(locale, '取得できませんでした'))
  for (const panel of all(view, element => element.props.role === 'tabpanel')) {
    expect(all(panel, element => element.props.className === 'app-version')).toHaveLength(0)
  }
  expect(find(footer, element => element.type === 'time').props.dateTime).toBe(__APP_BUILD__.builtAt)
})

function event(element: Element, name: string, value?: unknown) {
  const handler = element.props[name]
  expect(handler).toBeTypeOf('function')
  return (handler as (event: unknown) => unknown)(value)
}

beforeEach(() => {
  setLocale('ja')
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.runDependentEffects = false
  harness.preparation.context = null; harness.preparation.hasPendingChanges = false; harness.preparation.isImporting = false; harness.contexts = []; harness.initialSources = []; harness.sourceAuthorities = []; harness.programmer.error = undefined
  harness.programmer.state = 'running'; harness.programmer.supported = true; harness.programmer.source = 'print("keep this draft")'
  harness.programmer.runningSource = harness.programmer.source; harness.programmer.writtenSource = harness.programmer.source
  harness.programmer.bootConfigured = null; harness.programmer.info.bootOption = 1
  harness.programmer.programFeedback = null
  harness.programmer.info.boardId = 'm5nanoc6'; harness.programmer.info.bootOptionSupported = true; harness.programmer.info.nvsFallbackSupported = false
  harness.starterVerified = false; harness.starterSource = 'print("starter")\n'; harness.starterThrows = false; harness.values = new Map()
  vi.clearAllMocks()
  harness.programmer.setSource.mockImplementation((value: string) => { harness.programmer.source = value })
  harness.getElementById.mockReturnValue({ focus: harness.focus })
  harness.getItem.mockImplementation((key: string) => harness.values.get(key) ?? null)
  harness.setItem.mockImplementation((key: string, value: string) => { harness.values.set(key, value) })
  harness.confirm.mockReturnValue(true)
  vi.stubGlobal('localStorage', { getItem: harness.getItem, setItem: harness.setItem })
  vi.stubGlobal('confirm', harness.confirm)
  vi.stubGlobal('document', { getElementById: harness.getElementById, createElement: () => harness.anchor, documentElement: { dataset: {} } })
  vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:project-download')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => { setLocale('ja'); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('AI準備のお試しコードは現在の作品を退避して編集画面へ準備するだけで、機器には送らない', () => {
  const trial = controllerTrial()
  const previous = structuredClone(currentProject())
  event(aiPanel(), 'onPrepareController')
  expect(currentProject().draft).toEqual({ ...trial, remoteButtons: [] })
  expect(currentProject().working).toBeNull()
  expect(JSON.parse(harness.values.get('mpw-artwork-before-replace-v1')!)).toEqual(previous)
  expect(JSON.parse(harness.values.get(PROJECT_DRAFT_STORAGE_KEY)!).draft).toEqual({ ...trial, remoteButtons: [] })
  expect(byId(render(), 'panel-program').props.hidden).toBe(false)
  expect(harness.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('機器への書き込みや実行はしません'))
  expect(harness.preparation.adoptProjectSettings).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('Webリモコン用コードへの置換を断れば元の編集・設定・保存内容を保つ', () => {
  controllerTrial()
  const before = structuredClone(currentProject())
  harness.confirm.mockReturnValue(false)
  event(aiPanel(), 'onPrepareController')
  expect(currentProject()).toEqual(before)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(harness.setItem).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('コードが空でも光り方や操作ボタンの置換確認を省かない', () => {
  controllerTrial()
  harness.programmer.source = ''
  harness.confirm.mockReturnValue(false)
  const before = structuredClone(currentProject())
  event(aiPanel(), 'onPrepareController')
  expect(harness.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('操作ボタンを置き換え'))
  expect(currentProject()).toEqual(before)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it.each(['backup', 'draft'])('Webリモコンの %s 保存失敗は元のコードを保持しAI準備内で案内する', stage => {
  controllerTrial()
  const before = structuredClone(currentProject())
  event(byId(render(), 'tab-preparation'), 'onClick')
  harness.setItem.mockImplementation((key: string, value: string) => {
    if (key === (stage === 'backup' ? 'mpw-artwork-before-replace-v1' : PROJECT_DRAFT_STORAGE_KEY)) throw new Error('quota')
    harness.values.set(key, value)
  })
  event(aiPanel(), 'onPrepareController')
  expect(currentProject()).toEqual(before)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(aiPanel().props.controllerPreparationNotice).toContain('現在の編集内容は変更していません')
  expect(byId(render(), 'panel-preparation').props.hidden).toBe(false)
  assertNoUsbOperations()
})

it.each(['pending', 'importing', 'registered', 'disabled', 'missing'])('準備不可の %s 状態では直接ハンドラが呼ばれてもコードを置き換えない', reason => {
  controllerTrial()
  const context = harness.preparation.context as Record<string, unknown>
  if (reason === 'pending') harness.preparation.hasPendingChanges = true
  if (reason === 'importing') harness.preparation.isImporting = true
  if (reason === 'registered') context.bleSource = 'registered'
  if (reason === 'disabled') context.controllerEnabled = false
  if (reason === 'missing') delete context.controllerStarter
  event(aiPanel(), 'onPrepareController')
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(harness.confirm).not.toHaveBeenCalled()
  expect(harness.setItem).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('準備後のWeb用コードにも毎回未検証確認を求め、キャンセルでは実行しない', () => {
  controllerTrial()
  event(aiPanel(), 'onPrepareController')
  harness.confirm.mockClear().mockReturnValue(false)
  event(find(render(), element => element.type === CodeEditor), 'onRun')
  expect(harness.programmer.run).not.toHaveBeenCalled()
  expect(harness.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('提供側の実機検証が未完了'))
  harness.confirm.mockReturnValue(true)
  event(find(render(), element => element.type === CodeEditor), 'onRun')
  event(find(render(), element => element.type === CodeEditor), 'onRun')
  expect(harness.programmer.run).toHaveBeenCalledTimes(2)
  expect(harness.confirm).toHaveBeenCalledTimes(3)
  expect(currentProject().working).toBeNull()
})

it('Web用コードを準備しても接続機種が違えば実行させない', () => {
  controllerTrial()
  event(aiPanel(), 'onPrepareController')
  harness.programmer.info.boardId = 'atoms3lite'
  event(find(render(), element => element.type === CodeEditor), 'onRun')
  expect(harness.programmer.run).not.toHaveBeenCalled()
  expect(maker().props.notice).toContain('接続した機器と、選択した機器が違います')
})

it('AI準備からコントローラへ移るだけではコードやUSB通信に触れない', () => {
  controllerTrial()
  event(aiPanel(), 'onOpenController')
  expect(byId(render(), 'panel-controller').props.hidden).toBe(false)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(harness.confirm).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it.each(['running', 'error', 'connection-lost', 'disconnected'])('操作結果を %s でも操作ボタンの近くに残す', state => {
  harness.programmer.state = state
  const feedback: ProgramFeedback = { id: 4, operation: 'run', phase: state === 'running' ? 'running' : state === 'error' ? 'failed' : 'disconnected', saved: true, source: 'old source' }
  harness.programmer.programFeedback = feedback
  const view = render()
  const card = find(view, element => element.props.className === 'action-card')
  const result = find(card, element => element.type === ProgramResult)
  expect(result.props).toMatchObject({ feedback, source: harness.programmer.source, connected: state === 'running' || state === 'error' })
  expect(result.props.onRecover).toBe(state === 'error' ? harness.programmer.normalMode : undefined)
  const run = find(card, element => element.props.className === 'run-button')
  expect(run.props.disabled).toBe(state !== 'running')
  expect(all(card, element => element.props.className === 'action-tip')).toHaveLength(0)
  assertNoUsbOperations()
})

it('初回接続だけでは書込み成功を表示しない', () => {
  harness.programmer.state = 'raw-repl-ready'
  expect(all(render(), element => element.type === ProgramResult)).toHaveLength(0)
  assertNoUsbOperations()
})

it('結果の対処ボタンからエラー詳細へ移動できる', () => {
  harness.programmer.state = 'error'
  harness.programmer.programFeedback = { id: 4, operation: 'run', phase: 'failed', saved: false, source: 'known', failedAt: 'write' }
  harness.programmer.error = { exceptionType: 'Error', message: 'test failure', traceback: 'test failure', intentionalInterrupt: false, stage: '実行', repairPrompt: 'test prompt' }
  const scrollIntoView = vi.fn()
  harness.getElementById.mockReturnValue({ focus: harness.focus, scrollIntoView })
  const view = render()
  expect(byId(view, 'program-error-details').props.tabIndex).toBe(-1)
  event(find(view, element => element.type === ProgramResult), 'onShowError')
  expect(harness.getElementById).toHaveBeenCalledWith('program-error-details')
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  expect(harness.focus).toHaveBeenCalledWith({ preventScroll: true })
  assertNoUsbOperations()
})

it('ヘッダーに共有のフルカラーLEDアイコンを装飾画像として表示し、USB操作を行わない', () => {
  const view = render()
  const header = find(view, element => element.type === 'header')
  const icon = find(header, element => element.props.className === 'brand-mark')
  expect(icon.type).toBe('img')
  expect(icon.props).toMatchObject({
    src: `${import.meta.env.BASE_URL}favicon.svg`,
    alt: '',
    'aria-hidden': 'true',
    width: 48,
    height: 48,
  })
  assertNoUsbOperations()
})

it('既存コードがない初回は作品づくりを入口にし、4つのタブを関連付ける', () => {
  const view = render()
  expect(byId(view, 'tab-maker').props).toMatchObject({ role: 'tab', 'aria-selected': true, 'aria-controls': 'panel-maker', tabIndex: 0 })
  expect(byId(view, 'tab-program').props).toMatchObject({ role: 'tab', 'aria-selected': false, 'aria-controls': 'panel-program', tabIndex: -1 })
  expect(byId(view, 'tab-controller').props).toMatchObject({ role: 'tab', 'aria-selected': false, 'aria-controls': 'panel-controller', tabIndex: -1 })
  expect(byId(view, 'panel-maker').props).toMatchObject({ role: 'tabpanel', hidden: false, 'aria-labelledby': 'tab-maker' })
  expect(byId(view, 'panel-program').props).toMatchObject({ role: 'tabpanel', hidden: true, 'aria-labelledby': 'tab-program' })
  expect(byId(view, 'panel-controller').props).toMatchObject({ role: 'tabpanel', hidden: true, 'aria-labelledby': 'tab-controller' })
})

it('既存利用者の保存コードがある場合はプログラム画面から続ける', () => {
  harness.values.set('mpw-source', 'print("previous")')
  expect(byId(render(), 'tab-program').props['aria-selected']).toBe(true)
  assertNoUsbOperations()
})

it('タブを切り替えても両パネルを保持し、USB切断やプログラム停止を行わない', () => {
  let view = render()
  const beforeEditor = find(view, element => element.type === CodeEditor)
  event(byId(view, 'tab-controller'), 'onClick')
  view = render()
  expect(byId(view, 'panel-program').props.hidden).toBe(true)
  expect(byId(view, 'panel-controller').props.hidden).toBe(false)
  expect(editorContent(find(view, element => element.type === CodeEditor).props)).toEqual(editorContent(beforeEditor.props))
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
  const keys = [['ArrowRight', 'preparation'], ['ArrowRight', 'program'], ['ArrowRight', 'controller'], ['ArrowRight', 'maker'], ['ArrowLeft', 'controller'], ['Home', 'maker'], ['End', 'controller']]
  for (const [key, expected] of keys) {
    const preventDefault = vi.fn()
    event(find(render(), element => element.props.role === 'tablist'), 'onKeyDown', { key, preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(byId(render(), `tab-${expected}`).props['aria-selected']).toBe(true)
    expect(harness.getElementById).toHaveBeenLastCalledWith(`tab-${expected}`)
  }
  expect(harness.focus).toHaveBeenCalledTimes(keys.length)
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

it('Bluetooth画面からAIの準備へ移動しても編集内容と両通信画面を保持し、自動操作しない', () => {
  event(byId(render(), 'tab-controller'), 'onClick')
  const before = find(render(), element => element.type === CodeEditor).props
  event(find(render(), element => element.type === BluetoothPanel), 'onOpenPreparation')
  const view = render()
  expect(byId(view, 'panel-preparation').props.hidden).toBe(false)
  expect(byId(view, 'panel-program').props.hidden).toBe(true)
  expect(byId(view, 'panel-controller').props.hidden).toBe(true)
  expect(editorContent(find(view, element => element.type === CodeEditor).props)).toEqual(editorContent(before))
  expect(all(view, element => element.type === BluetoothPanel)).toHaveLength(1)
  expect(all(view, element => element.type === AiPreparationPanel)).toHaveLength(1)
  expect(harness.getElementById).toHaveBeenLastCalledWith('tab-preparation')
  expect(harness.focus).toHaveBeenCalledTimes(1)
  for (const operation of ['connect', 'disconnect', 'run', 'stop', 'write', 'reset', 'setBoot', 'normalMode', 'load', 'setSource'] as const) {
    expect(harness.programmer[operation], operation).not.toHaveBeenCalled()
  }
})

it('AIの準備へ移動しても3つのパネルと編集内容を保持する', () => {
  const before = find(render(), element => element.type === CodeEditor).props
  event(byId(render(), 'tab-preparation'), 'onClick')
  const view = render()
  expect(byId(view, 'panel-preparation').props).toMatchObject({ role: 'tabpanel', hidden: false, 'aria-labelledby': 'tab-preparation' })
  expect(byId(view, 'panel-program').props.hidden).toBe(true)
  expect(byId(view, 'panel-controller').props.hidden).toBe(true)
  expect(editorContent(find(view, element => element.type === CodeEditor).props)).toEqual(editorContent(before))
  expect(all(view, element => element.type === BluetoothPanel)).toHaveLength(1)
  expect(find(view, element => element.type === AiPreparationPanel).props.preparation).toBe(harness.preparation)
  event(find(view, element => element.type === AiPreparationPanel), 'onOpenProgram')
  expect(byId(render(), 'panel-program').props.hidden).toBe(false)
  for (const operation of ['connect', 'disconnect', 'run', 'stop', 'write', 'reset'] as const) expect(harness.programmer[operation]).not.toHaveBeenCalled()
})

it('USB非対応でもAI準備を開けて、不正を含む選択文脈を通信hookへ渡す', () => {
  harness.programmer.supported = false; harness.programmer.state = 'unsupported'
  harness.preparation.context = { errors: ['LED数が未設定です'], profile: { boardId: 'm5nanoc6' } }
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

it('実機未確認でも入門コードを編集画面だけに準備し、確認済み表示・動作OK記録には変えない', () => {
  harness.programmer.state = 'disconnected'
  expect(maker().props.verifiedStarter).toBe(false)
  expect(maker().props.canPrepareStarter).toBe(true)
  event(maker(), 'onPrepare')
  expect(harness.programmer.setSource).toHaveBeenCalledExactlyOnceWith(harness.starterSource)
  expect(maker().props.sourceMatches).toBe(true)
  expect(maker().props.verifiedStarter).toBe(false)
  expect(currentProject().working).toBeNull()
  expect(maker().props.notice).toContain('機器には送っていません')
  expect(JSON.parse(harness.values.get('mpw-artwork-before-replace-v1')!).draft.source).toBe('print("keep this draft")')
  expect(JSON.parse(harness.values.get(PROJECT_DRAFT_STORAGE_KEY)!).draft.source).toBe(harness.starterSource)
  assertNoUsbOperations()
})

it.each([false, true])('確認済み=%sの入門準備もコード上書き確認を断ると変更せず、承認時も機器へ送信しない', verified => {
  harness.starterVerified = verified
  harness.confirm.mockReturnValue(false)
  event(maker(), 'onPrepare')
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(harness.values.has('mpw-artwork-before-replace-v1')).toBe(false)
  harness.confirm.mockReturnValue(true)
  event(maker(), 'onPrepare')
  expect(harness.programmer.source).toBe(harness.starterSource)
  const checkpoint = JSON.parse(harness.values.get('mpw-artwork-before-replace-v1')!)
  expect(checkpoint.draft.source).toBe('print("keep this draft")')
  expect(maker().props.canUndoReplacement).toBe(true)
  assertNoUsbOperations()
})

it('空の編集欄へ未確認コードを準備するときもUSBへ送らず、空の元コードを退避する', () => {
  harness.programmer.source = ''
  event(maker(), 'onPrepare')
  expect(harness.programmer.source).toBe(harness.starterSource)
  expect(harness.confirm).not.toHaveBeenCalled()
  expect(JSON.parse(harness.values.get('mpw-artwork-before-replace-v1')!).draft.source).toBe('')
  assertNoUsbOperations()
})

it.each(['backup', 'draft'])('未確認コード準備で%s保存に失敗したら元の編集を保持する', failure => {
  const previous = currentProject()
  harness.setItem.mockImplementation((key: string, value: string) => {
    if (key === (failure === 'backup' ? 'mpw-artwork-before-replace-v1' : PROJECT_DRAFT_STORAGE_KEY)) throw new Error('保存できません')
    harness.values.set(key, value)
  })
  event(maker(), 'onPrepare')
  expect(currentProject()).toEqual(previous)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(maker().props.verifiedStarter).toBe(false)
  assertNoUsbOperations()
})

it.each(['empty', 'throw'])('生成結果が%sの場合は準備・実行のコールバックを直接呼んでも変更しない', failure => {
  if (failure === 'empty') harness.starterSource = ''
  else harness.starterThrows = true
  expect(maker().props.canPrepareStarter).toBe(false)
  event(maker(), 'onPrepare'); event(maker(), 'onRun')
  expect(maker().props.sourceMatches).toBe(false)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(harness.confirm).not.toHaveBeenCalled()
  expect(harness.values.has(PROJECT_DRAFT_STORAGE_KEY)).toBe(false)
  assertNoUsbOperations()
})

it.each([false, true].flatMap(verified => ['source', 'board', 'state'].map(reason => [verified, reason] as const)))('確認済み=%sでも入門実行は%s不一致時に確認も送信もしない', (verified, reason) => {
  harness.starterVerified = verified
  harness.programmer.source = harness.starterSource
  if (reason === 'source') harness.programmer.source = 'manual edit'
  if (reason === 'board') harness.programmer.info.boardId = 'atoms3lite'
  if (reason === 'state') harness.programmer.state = 'disconnected'
  event(maker(), 'onRun')
  expect(harness.confirm).not.toHaveBeenCalled()
  if (reason === 'board') expect(maker().props.boardMatches).toBe(false)
  assertNoUsbOperations()
})

it.each(['disconnected', 'connection-lost', 'unsupported', 'error', 'connecting', 'stopping', 'writing', 'interrupting'])('状態%sでは未確認プログラムの実行を承認することもできない', state => {
  harness.programmer.state = state; harness.programmer.source = harness.starterSource
  event(maker(), 'onRun')
  expect(harness.confirm).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it.each(['raw-repl-ready', 'stopped', 'running', 'running-no-marker'])('状態%sで未確認実行を承認した時だけ安全な実行入口を1回呼ぶ', state => {
  harness.programmer.state = state; harness.programmer.source = harness.starterSource
  event(maker(), 'onRun')
  expect(harness.confirm).toHaveBeenCalledOnce()
  expect(harness.programmer.run).toHaveBeenCalledOnce()
  for (const operation of ['connect', 'disconnect', 'stop', 'write', 'reset', 'load', 'setBoot', 'normalMode'] as const) expect(harness.programmer[operation]).not.toHaveBeenCalled()
  expect(currentProject().working).toBeNull()
  expect(maker().props.verifiedStarter).toBe(false)
})

it('未確認の実行は毎回確認し、キャンセル時は通信も動作OK登録も行わない', () => {
  harness.programmer.source = harness.starterSource
  harness.programmer.runningSource = harness.starterSource
  harness.confirm.mockReturnValue(false)
  event(maker(), 'onRun')
  expect(harness.confirm).toHaveBeenCalledOnce()
  expect(maker().props.canMarkWorking).toBe(false)
  event(maker(), 'onMarkWorking')
  expect(currentProject().working).toBeNull()
  assertNoUsbOperations()
  harness.confirm.mockReturnValue(true)
  event(maker(), 'onRun')
  expect(harness.confirm).toHaveBeenCalledTimes(2)
  expect(harness.programmer.run).toHaveBeenCalledOnce()
  expect(currentProject().working).toBeNull()
  harness.confirm.mockReturnValue(false)
  event(maker(), 'onRun')
  expect(harness.confirm).toHaveBeenCalledTimes(3)
  expect(harness.programmer.run).toHaveBeenCalledOnce()
  expect(maker().props.verifiedStarter).toBe(false)
})

const trialConfirmation = 'このコードは提供側の実機検証が未完了です。動作は保証されません。\n\n機器: {board}\nUIFlow2: {firmware}\nLED: {model} × {count}個 / GPIO {pin}\n最大輝度: {brightness}%\n\n電源を外して配線・電源容量を確認し、上記が実機と一致することを確かめましたか？\n実行すると、実行中のプログラムを停止し、機器のmain.pyを書き換えます。未検証コードを試しますか？'

it.each(['ja', 'en', 'zh'] as const)('未確認実行の確認文は%s表示で現在の機種・版・LED設定と上書き対象を明示する', locale => {
  const next = structuredClone(currentProject())
  Object.assign(next.draft.settings, { boardId: 'atoms3lite', firmwareVersion: 'TEST-2.3.7', ledModel: 'SK6812MINI', ledCount: 37, ledPin: 8, maxBrightnessPercent: 35 })
  event(maker(), 'onChange', next)
  harness.programmer.info.boardId = 'atoms3lite'; harness.programmer.source = harness.starterSource
  setLocale(locale)
  harness.confirm.mockReturnValue(false)
  event(maker(), 'onRun')
  const expected = translate(locale, trialConfirmation, { board: 'AtomS3Lite', firmware: 'TEST-2.3.7', model: 'SK6812MINI', count: 37, pin: 8, brightness: 35 })
  expect(harness.confirm).toHaveBeenCalledExactlyOnceWith(expected)
  if (locale !== 'ja') expect(expected).not.toContain('このコードは提供側')
  for (const value of ['AtomS3Lite', 'TEST-2.3.7', 'SK6812MINI', '37', 'GPIO 8', '35%', 'main.py']) expect(expected).toContain(value)
  expect(expected).not.toMatch(/\{(?:board|firmware|model|count|pin|brightness)\}/)
  assertNoUsbOperations()
  const changed = structuredClone(currentProject()); changed.draft.settings.ledCount = 42; changed.draft.settings.maxBrightnessPercent = 12
  event(maker(), 'onChange', changed); event(maker(), 'onRun')
  expect(harness.confirm).toHaveBeenLastCalledWith(translate(locale, trialConfirmation, { board: 'AtomS3Lite', firmware: 'TEST-2.3.7', model: 'SK6812MINI', count: 42, pin: 8, brightness: 12 }))
  expect(harness.confirm).toHaveBeenCalledTimes(2)
  assertNoUsbOperations()
})

it.each(['button', 'editor'])('未確認候補をプログラム画面の%sから実行しても確認を省略しない', entry => {
  harness.programmer.source = harness.starterSource
  const run = () => {
    const view = render()
    if (entry === 'editor') event(find(view, element => element.type === CodeEditor), 'onRun')
    else event(find(view, element => element.props.className === 'run-button'), 'onClick')
  }
  harness.confirm.mockReturnValue(false)
  run()
  expect(harness.confirm).toHaveBeenCalledOnce()
  assertNoUsbOperations()
  harness.confirm.mockReturnValue(true)
  run()
  expect(harness.confirm).toHaveBeenCalledTimes(2)
  expect(harness.programmer.run).toHaveBeenCalledOnce()
  expect(currentProject().working).toBeNull()
})

it.each([false, true].flatMap(verified => ['button', 'editor'].map(entry => [verified, entry] as const)))('確認済み=%sでも%sから機種不一致の生成コードを送らず作品画面で設定を案内する', (verified, entry) => {
  harness.starterVerified = verified; harness.programmer.source = harness.starterSource
  harness.programmer.info.boardId = 'atoms3lite'
  event(byId(render(), 'tab-program'), 'onClick')
  const view = render()
  if (entry === 'editor') event(find(view, element => element.type === CodeEditor), 'onRun')
  else event(find(view, element => element.props.className === 'run-button'), 'onClick')
  expect(byId(render(), 'panel-maker').props.hidden).toBe(false)
  expect(maker().props.notice).not.toBe('')
  expect(harness.confirm).not.toHaveBeenCalled()
  expect(currentProject().working).toBeNull()
  assertNoUsbOperations()
})

it('未確認コードを準備・保存・実行・利用者の動作OK登録しても提供側の確認済みには昇格しない', () => {
  event(maker(), 'onPrepare'); event(maker(), 'onSave')
  expect(maker().props.verifiedStarter).toBe(false)
  expect(currentProject().working).toBeNull()
  assertNoUsbOperations()
  harness.programmer.runningSource = harness.starterSource
  event(maker(), 'onRun')
  expect(maker().props.canMarkWorking).toBe(true)
  expect(currentProject().working).toBeNull()
  event(maker(), 'onMarkWorking')
  expect(currentProject().working?.snapshot.source).toBe(harness.starterSource)
  expect(maker().props.verifiedStarter).toBe(false)
})

it('設定変更・保存・言語変更・再描画だけでは未確認コードを準備も実行もしない', () => {
  render()
  const next = structuredClone(currentProject()); next.draft.settings.firmwareVersion = 'TEST-UNVERIFIED'; next.draft.settings.ledCount = 24
  event(maker(), 'onChange', next); event(maker(), 'onSave')
  setLocale('en'); render(); setLocale('zh'); render()
  expect(harness.confirm).not.toHaveBeenCalled()
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(currentProject().working).toBeNull()
  assertNoUsbOperations()
})

it('確認済み条件が一致すると入門実行から既存の安全な実行入口を1回呼ぶ', () => {
  harness.starterVerified = true
  harness.programmer.source = harness.starterSource
  event(maker(), 'onRun')
  expect(harness.confirm).not.toHaveBeenCalled()
  expect(harness.programmer.run).toHaveBeenCalledOnce()
  expect(harness.programmer.write).not.toHaveBeenCalled()
  expect(harness.programmer.setBoot).not.toHaveBeenCalled()
})

it('作品の設定変更・保存ではエディタの最新コードを保持し、通信を行わない', () => {
  const next = structuredClone(currentProject())
  next.name = '衣装の袖'; next.draft.source = '古いsourceを持つUIイベント'; next.draft.settings.ledCount = 24
  event(maker(), 'onChange', next)
  expect(currentProject().name).toBe('衣装の袖')
  expect(currentProject().draft.source).toBe('print("keep this draft")')
  event(maker(), 'onSave')
  expect(JSON.parse(harness.values.get(PROJECT_STORAGE_KEY)!)).toMatchObject({ name: '衣装の袖', draft: { source: 'print("keep this draft")', settings: { ledCount: 24 } } })
  expect(maker().props.notice).toContain('作品をこのブラウザに保存しました')
  assertNoUsbOperations()
})

it('保存失敗を成功通知にせず、編集中のコードを維持する', () => {
  harness.setItem.mockImplementation(() => { throw new Error('QuotaExceeded') })
  event(maker(), 'onSave')
  expect(maker().props.notice).toContain('保存できませんでした')
  expect(currentProject().draft.source).toBe(harness.programmer.source)
  assertNoUsbOperations()
})

it('作品の書き出しはコード付きJSONをダウンロードし、USBを操作しない', async () => {
  event(maker(), 'onExport')
  expect(harness.anchor.click).toHaveBeenCalledOnce()
  expect(harness.anchor.download).toMatch(/\.mpw\.json$/)
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
  expect(JSON.parse(await blob.text()).draft.source).toBe(harness.programmer.source)
  expect(maker().props.notice).toContain('書き出しました')
  assertNoUsbOperations()
})

it('秘密情報を含む作品の書き出しは確認を断ると中止する', () => {
  harness.programmer.source = 'password = "do-not-export"'
  harness.confirm.mockReturnValue(false)
  event(maker(), 'onExport')
  expect(harness.confirm).toHaveBeenCalledOnce()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  expect(harness.anchor.click).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('実機未確認コードのダウンロードは検証用と明示し、確認済み化も送信もしない', async () => {
  event(maker(), 'onDownloadCandidate')
  expect(harness.anchor.download).toBe('main-unverified.py')
  expect(await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text()).toBe(harness.starterSource)
  expect(maker().props.notice).toContain('動作保証・検証済みの登録・機器への送信は行っていません')
  expect(currentProject().working).toBeNull()
  assertNoUsbOperations()
})

const projectFile = (project: ArtworkProject) => ({ name: 'artwork.mpw.json', size: serializeProject(project).length, text: async () => serializeProject(project) })

it('作品の読み込み確認を断ると編集・保存・USB状態を変更しない', async () => {
  harness.confirm.mockReturnValue(false)
  const next = createProject(); next.name = '持ち込んだ作品'; next.draft.source = 'print("import")'
  const before = currentProject()
  await event(maker(), 'onImport', projectFile(next))
  expect(currentProject()).toEqual(before)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(harness.setItem).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('読み込みでは元の最新コードを一時退避し、持込確認を降格して機器へ送らない', async () => {
  const next = createProject(); next.name = '持ち込んだ作品'; next.draft.source = 'print("import")'
  const confirmed = markWorking(next)
  render()
  harness.programmer.source = 'print("import直前の編集")'
  render()
  await event(maker(), 'onImport', projectFile(confirmed))
  expect(currentProject().name).toBe('持ち込んだ作品')
  expect(currentProject().draft.source).toBe(next.draft.source)
  expect(currentProject().working).toBeNull()
  expect(JSON.parse(harness.values.get('mpw-artwork-before-replace-v1')!).draft.source).toBe('print("import直前の編集")')
  expect(maker().props.notice).toContain('動作OK記録は引き継がず')
  expect(harness.values.has(PROJECT_STORAGE_KEY)).toBe(false)
  assertNoUsbOperations()
})

it('退避用ストレージが書けなければ読み込みを中止し、元データを置き換えない', async () => {
  const next = createProject(); next.draft.source = 'print("import")'
  const before = currentProject()
  harness.setItem.mockImplementation(() => { throw new Error('退避できません') })
  await event(maker(), 'onImport', projectFile(next))
  expect(currentProject()).toEqual(before)
  expect(maker().props.notice).toContain('退避できません')
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it.each([{ name: 'project.py', size: 10 }, { name: 'project.json', size: 1_000_001 }])('未対応の作品ファイルは内容を読まず拒否する: %j', async metadata => {
  const text = vi.fn(async () => serializeProject(createProject()))
  await event(maker(), 'onImport', { ...metadata, text })
  expect(text).not.toHaveBeenCalled()
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('読み込みの取り消しは直前のコード・設定・ボタンへ戻せるが自動送信しない', async () => {
  const previous = currentProject()
  const next = createProject(); next.name = '次'; next.draft.source = 'print("next")'
  await event(maker(), 'onImport', projectFile(next))
  event(maker(), 'onUndoReplacement')
  expect(currentProject()).toEqual(previous)
  expect(harness.programmer.source).toBe(previous.draft.source)
  assertNoUsbOperations()
})

function runAndMark() {
  event(find(render(), element => element.type === CodeEditor), 'onRun')
  expect(maker().props.canMarkWorking).toBe(true)
  event(maker(), 'onMarkWorking')
}

it('実行中の表示だけでは動作OK登録できず、実行コードと確認の一致を求める', () => {
  expect(maker().props.canMarkWorking).toBe(false)
  event(maker(), 'onMarkWorking')
  expect(currentProject().working).toBeNull()
  expect(harness.confirm).not.toHaveBeenCalled()
  runAndMark()
  expect(currentProject().working?.snapshot).toEqual(currentProject().draft)
  expect(harness.confirm).toHaveBeenCalledOnce()
})

it.each(['source', 'recipe', 'settings', 'runningSource', 'state', 'board'])('実行後に %s が変わると確認済み登録を止める', mismatch => {
  event(find(render(), element => element.type === CodeEditor), 'onRun')
  if (mismatch === 'source') harness.programmer.source += '\nprint(2)'
  if (mismatch === 'runningSource') harness.programmer.runningSource = 'old source'
  if (mismatch === 'state') harness.programmer.state = 'stopped'
  if (mismatch === 'board') harness.programmer.info.boardId = 'atoms3lite'
  if (mismatch === 'recipe' || mismatch === 'settings') {
    const next = structuredClone(currentProject())
    if (mismatch === 'recipe') next.draft.recipe.modes[0].speed = 1
    else next.draft.settings.ledCount = 12
    event(maker(), 'onChange', next)
  }
  expect(maker().props.canMarkWorking).toBe(false)
  event(maker(), 'onMarkWorking')
  expect(currentProject().working).toBeNull()
  expect(harness.confirm).not.toHaveBeenCalled()
})

it('実機確認をキャンセルすると動作OK版を作らない', () => {
  event(find(render(), element => element.type === CodeEditor), 'onRun')
  harness.confirm.mockReturnValue(false)
  event(maker(), 'onMarkWorking')
  expect(currentProject().working).toBeNull()
  expect(harness.values.has(PROJECT_STORAGE_KEY)).toBe(false)
})

it('動作OK版を復元すると現draftを退避し、コード・設定・ボタンを正確に戻す', () => {
  runAndMark()
  const confirmed = structuredClone(currentProject().working!.snapshot)
  const next = structuredClone(currentProject()); next.draft.settings.ledCount = 21; next.draft.recipe.modes[0].label = '編集'; next.draft.remoteButtons = [{ kind: 'mode', id: 'OTHER', label: '別', icon: 'heart' }]
  harness.programmer.source = 'print("edited")'
  event(maker(), 'onChange', next)
  harness.programmer.run.mockClear()
  event(maker(), 'onRestore')
  expect(currentProject().draft).toEqual(confirmed)
  expect(JSON.parse(harness.values.get('mpw-artwork-before-replace-v1')!).draft).toMatchObject({ source: 'print("edited")', settings: { ledCount: 21 } })
  expect(maker().props.canMarkWorking).toBe(false)
  assertNoUsbOperations()
})

it.each(['running', 'writtenSource', 'snapshot', 'bootUnsupported', 'board'])('完成設定は %s 不一致を拒否する', mismatch => {
  runAndMark(); harness.programmer.state = 'stopped'
  if (mismatch === 'running') harness.programmer.state = 'running'
  if (mismatch === 'writtenSource') harness.programmer.writtenSource = null
  if (mismatch === 'bootUnsupported') harness.programmer.info.bootOptionSupported = false
  if (mismatch === 'board') harness.programmer.info.boardId = 'atoms3lite'
  if (mismatch === 'snapshot') {
    const next = structuredClone(currentProject()); next.draft.settings.ledPin = 3
    event(maker(), 'onChange', next)
  }
  expect(maker().props.canFinish).toBe(false)
  event(maker(), 'onFinish')
  expect(harness.programmer.setBoot).not.toHaveBeenCalled()
})

it('完成は停止済み・機器上コード一致・動作OK版一致・対応機器でだけ自動起動設定を呼ぶ', () => {
  runAndMark(); harness.programmer.state = 'stopped'
  expect(maker().props.canFinish).toBe(true)
  event(maker(), 'onFinish')
  expect(harness.programmer.setBoot).toHaveBeenCalledExactlyOnceWith(0)
})

it('作品の機器設定をAI準備へ渡す前に未適用設定の置換確認をし、コードや通信に触れない', () => {
  harness.preparation.hasPendingChanges = true; harness.confirm.mockReturnValue(false)
  event(maker(), 'onOpenAI')
  expect(harness.preparation.adoptProjectSettings).not.toHaveBeenCalled()
  harness.confirm.mockReturnValue(true)
  event(maker(), 'onOpenAI')
  expect(harness.preparation.adoptProjectSettings).toHaveBeenCalledExactlyOnceWith(currentProject().draft.settings, false)
  expect(byId(render(), 'panel-preparation').props.hidden).toBe(false)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('作品の名前・ボタンはコントローラへ渡され、登録は作品保存のみで通信しない', () => {
  const next = structuredClone(currentProject()); next.name = '魔法の杖'
  event(maker(), 'onChange', next)
  const buttons = [{ kind: 'action', id: 'SPARKLE', label: '変身', icon: 'star' }]
  event(find(render(), element => element.type === BluetoothPanel), 'onRemoteButtonsChange', buttons)
  const panel = find(render(), element => element.type === BluetoothPanel)
  expect(panel.props.projectName).toBe('魔法の杖')
  expect(panel.props.remoteButtons).toEqual(buttons)
  expect(JSON.parse(harness.values.get(PROJECT_STORAGE_KEY)!).draft.remoteButtons).toEqual(buttons)
  assertNoUsbOperations()
})

it('複数の作品読み込みが逆順で完了しても、最後に選んだファイルだけ確認・反映する', async () => {
  const firstProject = createProject(); firstProject.name = '古い読み込み'; firstProject.draft.source = 'old incoming code'
  const secondProject = createProject(); secondProject.name = '最後に選んだ作品'; secondProject.draft.source = 'latest incoming code'
  let resolveFirst!: (text: string) => void
  let resolveSecond!: (text: string) => void
  const first = event(maker(), 'onImport', { name: 'first.json', size: 1000, text: () => new Promise<string>(resolve => { resolveFirst = resolve }) })
  const second = event(maker(), 'onImport', { name: 'second.json', size: 1000, text: () => new Promise<string>(resolve => { resolveSecond = resolve }) })
  resolveSecond(serializeProject(secondProject)); await second
  expect(currentProject().name).toBe('最後に選んだ作品')
  const checkpoint = harness.values.get('mpw-artwork-before-replace-v1')
  resolveFirst(serializeProject(firstProject)); await first
  expect(currentProject().name).toBe('最後に選んだ作品')
  expect(harness.programmer.source).toBe('latest incoming code')
  expect(harness.confirm).toHaveBeenCalledOnce()
  expect(harness.programmer.setSource).toHaveBeenCalledExactlyOnceWith('latest incoming code')
  expect(harness.values.get('mpw-artwork-before-replace-v1')).toBe(checkpoint)
  assertNoUsbOperations()
})

it('退避が成功しても作品全体の下書き保存が失敗したら編集コードを置き換えない', async () => {
  const previous = currentProject()
  harness.values.set(PROJECT_DRAFT_STORAGE_KEY, serializeProject(previous))
  const incoming = createProject(); incoming.name = '置換候補'; incoming.draft.source = 'incoming source'
  harness.setItem.mockImplementation((key: string, value: string) => {
    if (key === PROJECT_DRAFT_STORAGE_KEY) throw new Error('draft quota')
    harness.values.set(key, value)
  })
  await event(maker(), 'onImport', projectFile(incoming))
  expect(currentProject()).toEqual(previous)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  expect(maker().props.notice).toContain('編集中の作品をブラウザに保存できませんでした')
  expect(harness.values.get(PROJECT_DRAFT_STORAGE_KEY)).toBe(serializeProject(previous))
  expect(harness.values.has('mpw-artwork-before-replace-v1')).toBe(true)
  assertNoUsbOperations()
})

it('下書き全体を保存してからコードを置き換え、読込直後の再起動にも設定の一貫性を保つ', async () => {
  const incoming = createProject(); incoming.draft.source = 'incoming'; incoming.draft.settings.boardId = 'atoms3lite'; incoming.draft.settings.ledPin = 8
  harness.programmer.setSource.mockImplementation((source: string) => {
    const persisted = JSON.parse(harness.values.get(PROJECT_DRAFT_STORAGE_KEY)!)
    expect(persisted.draft.source).toBe(source)
    expect(persisted.draft.settings.boardId).toBe('atoms3lite')
    expect(persisted.draft.settings.ledPin).toBe(8)
    harness.programmer.source = source
  })
  await event(maker(), 'onImport', projectFile(incoming))
  expect(harness.programmer.setSource).toHaveBeenCalledOnce()
  expect(harness.values.has(PROJECT_STORAGE_KEY)).toBe(false)
  harness.values.set('mpw-source', 'old split code')
  harness.slots = []
  render()
  expect(harness.initialSources.at(-1)).toBe('incoming')
  expect(harness.sourceAuthorities.at(-1)).toBe(true)
  expect(currentProject().draft.settings.boardId).toBe('atoms3lite')
  assertNoUsbOperations()
})

it('編集後のコード・設定を単一の下書きとして自動保存し、明示保存とは分ける', () => {
  harness.runDependentEffects = true
  render()
  const next = structuredClone(currentProject()); next.name = '編集中'; next.draft.settings.ledCount = 23
  event(maker(), 'onChange', next)
  harness.programmer.source = 'new editor code'
  render()
  expect(JSON.parse(harness.values.get(PROJECT_DRAFT_STORAGE_KEY)!)).toMatchObject({ name: '編集中', draft: { source: 'new editor code', settings: { ledCount: 23 } } })
  expect(harness.values.has(PROJECT_STORAGE_KEY)).toBe(false)
  assertNoUsbOperations()
})

it('破損した下書きは自動保存で消さず、明示保存を断るとそのまま残す', () => {
  harness.values.set(PROJECT_DRAFT_STORAGE_KEY, '{corrupt draft')
  harness.runDependentEffects = true
  render()
  expect(harness.values.get(PROJECT_DRAFT_STORAGE_KEY)).toBe('{corrupt draft')
  harness.confirm.mockReturnValue(false)
  event(maker(), 'onSave')
  expect(harness.values.get(PROJECT_DRAFT_STORAGE_KEY)).toBe('{corrupt draft')
  expect(harness.values.has(PROJECT_STORAGE_KEY)).toBe(false)
  assertNoUsbOperations()
})

it('最後のタブを保存して再表示し、未知の保存タブは初回導線へ戻す', () => {
  harness.runDependentEffects = true
  event(byId(render(), 'tab-maker'), 'onClick'); render()
  expect(harness.values.get('mpw-active-tab')).toBe('maker')
  harness.values.set('mpw-source', 'legacy saved source')
  harness.slots = []
  expect(byId(render(), 'tab-maker').props['aria-selected']).toBe(true)
  harness.values.set('mpw-active-tab', 'unknown'); harness.values.delete('mpw-source'); harness.slots = []
  expect(byId(render(), 'tab-maker').props['aria-selected']).toBe(true)
  assertNoUsbOperations()
})

it('単体動作確認は起動設定の表示値や他画面での設定成功だけでは有効にならない', () => {
  harness.programmer.info.bootOption = 0
  expect(maker().props.canConfirmStandalone).toBe(false)
  harness.programmer.bootConfigured = { mode: 0, source: harness.programmer.source }
  expect(maker().props.canConfirmStandalone).toBe(false)
  assertNoUsbOperations()
})

it('単体動作確認は完成操作と一致するコードの起動設定成功が揃って初めて有効になる', () => {
  runAndMark(); harness.programmer.state = 'stopped'
  event(maker(), 'onFinish')
  expect(maker().props.canConfirmStandalone).toBe(false)
  harness.programmer.bootConfigured = { mode: 0, source: 'different program' }
  expect(maker().props.canConfirmStandalone).toBe(false)
  harness.programmer.bootConfigured = { mode: 1, source: harness.programmer.source }
  expect(maker().props.canConfirmStandalone).toBe(false)
  harness.programmer.bootConfigured = { mode: 0, source: harness.programmer.source }
  expect(maker().props.canConfirmStandalone).toBe(true)
})

it.each(['code', 'settings', 'recipe', 'remoteButtons'])('単体確認待ちの %s 変更は以前の確認条件を失効する', mismatch => {
  runAndMark(); harness.programmer.state = 'stopped'; event(maker(), 'onFinish')
  harness.programmer.bootConfigured = { mode: 0, source: harness.programmer.source }
  expect(maker().props.canConfirmStandalone).toBe(true)
  if (mismatch === 'code') harness.programmer.source = 'print("changed")'
  else {
    const next = structuredClone(currentProject())
    if (mismatch === 'settings') next.draft.settings.ledPin = 3
    if (mismatch === 'recipe') next.draft.recipe.modes[0].speed = 1
    if (mismatch === 'remoteButtons') next.draft.remoteButtons = [{ kind: 'action', id: 'OTHER', label: '別', icon: 'heart' }]
    event(maker(), 'onChange', next)
  }
  expect(maker().props.canConfirmStandalone).toBe(false)
})

it('作品設定を使い始めた後は不一致のAI準備文脈をUSBへ渡さず、AI準備自体は保持する', () => {
  const legacyContext = { profile: { ...createProject().draft.settings, boardId: 'atoms3lite', ledCount: 99 }, errors: [] }
  harness.preparation.context = legacyContext
  render()
  expect(harness.contexts.at(-1)).toBe(legacyContext)
  event(maker(), 'onChange', structuredClone(currentProject()))
  render()
  expect(harness.contexts.at(-1)).toBeNull()
  expect(harness.preparation.context).toBe(legacyContext)
  expect(harness.preparation.adoptProjectSettings).not.toHaveBeenCalled()
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it('作品と一致するAI準備だけを通信文脈として使用する', () => {
  const context = { profile: structuredClone(createProject().draft.settings), errors: [] }
  harness.preparation.context = context
  event(maker(), 'onChange', structuredClone(currentProject()))
  render()
  expect(harness.contexts.at(-1)).toBe(context)
  const changed = structuredClone(currentProject()); changed.draft.settings.ledCount = 25
  event(maker(), 'onChange', changed); render()
  expect(harness.contexts.at(-1)).toBeNull()
  expect(context.profile.ledCount).toBe(10)
  assertNoUsbOperations()
})

it.each([null, 'false'])('有効な作品下書きがあればactiveフラグ=%sでも不一致のAI準備文脈を省く', active => {
  const draft = createProject(); draft.draft.source = 'print("restored project")'; draft.draft.settings.boardId = 'atoms3lite'; draft.draft.settings.ledPin = 8
  harness.values.set(PROJECT_DRAFT_STORAGE_KEY, serializeProject(draft))
  if (active !== null) harness.values.set('mpw-project-settings-active', active)
  const previousContext = { profile: { ...createProject().draft.settings, firmwareVersion: 'old-ui-version', ledCount: 37 }, errors: [] }
  harness.preparation.context = previousContext
  render()
  expect(harness.sourceAuthorities.at(-1)).toBe(true)
  expect(harness.initialSources.at(-1)).toBe(draft.draft.source)
  expect(harness.contexts.at(-1)).toBeNull()
  expect(harness.preparation.context).toBe(previousContext)
  expect(currentProject().draft.settings).toEqual(draft.draft.settings)
  expect(harness.programmer.setSource).not.toHaveBeenCalled()
  assertNoUsbOperations()
})

it.each([null, 'false'])('有効な作品下書きと一致するAI準備文脈はactiveフラグ=%sでも維持する', active => {
  const draft = createProject(); draft.draft.source = 'print("restored")'; draft.draft.settings.firmwareVersion = '2.3.7'; draft.draft.settings.ledCount = 24
  harness.values.set(PROJECT_DRAFT_STORAGE_KEY, serializeProject(draft))
  if (active !== null) harness.values.set('mpw-project-settings-active', active)
  const matchingContext = { profile: structuredClone(draft.draft.settings), errors: [] }
  harness.preparation.context = matchingContext
  render()
  expect(harness.sourceAuthorities.at(-1)).toBe(true)
  expect(harness.contexts.at(-1)).toBe(matchingContext)
  expect(harness.preparation.context).toBe(matchingContext)
  expect(harness.preparation.adoptProjectSettings).not.toHaveBeenCalled()
  assertNoUsbOperations()
})
