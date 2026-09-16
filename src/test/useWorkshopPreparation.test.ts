import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkshopPreparation } from '../hooks/useWorkshopPreparation'
import { workshopPresets } from '../config/workshops'
import { setLocale } from '../i18n'

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }))
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useRef: <Value,>(initial: Value) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index] },
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [hooks.slots[index], (next: Value | ((previous: Value) => Value)) => { hooks.slots[index] = typeof next === 'function' ? (next as (previous: Value) => Value)(hooks.slots[index] as Value) : next }]
  },
  useMemo: <Value,>(factory: () => Value, dependencies: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.slots[index] as { value: Value; dependencies: unknown[] } | undefined
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) hooks.slots[index] = { value: factory(), dependencies }
    return (hooks.slots[index] as { value: Value }).value
  },
}))

function HookHarness() { return useWorkshopPreparation() }
function render() { hooks.cursor = 0; return HookHarness() }
function prepare() {
  render().selectProfile(workshopPresets[0].id)
  render().editDraft({ kitId: '007', firmwareVersion: 'test-ui-2', ledModel: 'test-rgb', ledCount: 37, ledBpp: 3, maxBrightnessPercent: 30, features: { button: true, ble: true, controller: true } })
}
function verifyBaseline() {
  prepare()
  render().editDraft({ baseline: { code: 'print("test baseline")', verification: null } })
  render().confirmBaseline('テスト講師', true)
}

beforeEach(() => { setLocale('ja'); hooks.slots = []; hooks.cursor = 0; vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('AI準備用hookは講師設定だけを扱う', () => {
  it('LED設定だけを未設定項目と独立して自動保存し、再読込・機種切替で復元する', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
    render().selectProfile(workshopPresets[0].id)
    expect(render().selectedProfile).toMatchObject({ ledCount: 10, ledPin: 2, maxBrightnessPercent: 20 })
    render().editLedSettings({ ledCount: 24 })
    render().editLedSettings({ maxBrightnessPercent: 15, ledPin: 3 })
    expect(render().hasPendingChanges).toBe(false)
    expect(render().notice).toContain('自動保存')
    expect([...values.values()][0]).not.toContain('baseline')
    hooks.slots = []; hooks.cursor = 0
    render().selectProfile(workshopPresets[0].id)
    expect(render().selectedProfile).toMatchObject({ ledCount: 24, ledPin: 3, maxBrightnessPercent: 15 })
    render().selectProfile(workshopPresets[1].id)
    expect(render().selectedProfile).toMatchObject({ ledCount: 10, ledPin: 2, maxBrightnessPercent: 20 })
    render().editLedSettings({ ledCount: 7, ledPin: 9 })
    hooks.slots = []; hooks.cursor = 0
    render().selectProfile(workshopPresets[1].id)
    expect(render().selectedProfile).toMatchObject({ ledCount: 7, ledPin: 9 })
    render().selectProfile(workshopPresets[0].id)
    expect(render().selectedProfile?.ledPin).toBe(3)
  })
  it('LED変更時に古いBLE実機確認を失効させ、未適用のほかの編集は保存しない', () => {
    verifyBaseline(); render().applyDraft()
    render().editDraft({ displayName: '未適用の名前' })
    render().editLedSettings({ ledPin: 3 })
    expect(render().selectedProfile?.baseline.verification).toBeNull()
    expect(render().draft?.baseline.verification).toBeNull()
    expect(render().draft?.displayName).toBe('未適用の名前')
    expect(render().selectedProfile?.displayName).not.toBe('未適用の名前')
    expect(render().hasPendingChanges).toBe(true)
    expect(render().context?.bleEnabled).toBe(false)
    expect(localStorage.setItem).toHaveBeenLastCalledWith(expect.stringContaining('mpw-led:'), JSON.stringify({ ledCount: 37, maxBrightnessPercent: 30, ledPin: 3 }))
  })
  it('不正なLED値は準備文を止め、保存失敗は成功通知にしない', () => {
    prepare(); render().applyDraft()
    render().editLedSettings({ ledCount: null })
    expect(render().prompt).toBe('')
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(render().notice).toContain('不正')
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw Error('quota') }, removeItem: vi.fn() })
    render().editLedSettings({ ledCount: 12 })
    expect(render().prompt).toContain('LED_COUNT: 12')
    expect(render().notice).toContain('保存できません')
  })
  it('言語変更で準備文だけを再生成し、キット・未適用設定・基準コードを維持する', () => {
    verifyBaseline()
    render().applyDraft()
    render().editDraft({ displayName: '名前を編集中', baseline: { code: 'print("日本語を保持")', verification: null } })
    const before = render()
    setLocale('en')
    const english = render()
    expect(english.prompt).not.toBe(before.prompt)
    expect(english.context?.locale).toBe('en')
    expect(english.selectedId).toBe(before.selectedId)
    expect(english.selectedProfile).toBe(before.selectedProfile)
    expect(english.draft).toBe(before.draft)
    expect(english.hasPendingChanges).toBe(true)
    setLocale('zh')
    const chinese = render()
    expect(chinese.context?.locale).toBe('zh')
    expect(chinese.prompt).not.toBe(english.prompt)
    expect(chinese.draft?.baseline.code).toBe('print("日本語を保持")')
    setLocale('ja')
    expect(render().prompt).toBe(before.prompt)
  })
  it('機器別キットは設定・実機確認を共有せず、確認登録は対象機器に結び付く', () => {
    verifyBaseline()
    render().applyDraft()
    expect(render().draft?.baseline.verification?.boardId).toBe('m5nanoc6')
    render().selectProfile('atom-s3-lite-led-default')
    expect(render().draft?.boardId).toBe('atoms3lite')
    expect(render().draft?.baseline.verification).toBeNull()
    expect(render().draft?.kitId).toBeNull()
    render().editDraft({ boardId: 'm5nanoc6', kitId: '008', firmwareVersion: 'test-ui-atom', ledModel: 'test-rgb', ledCount: 12, maxBrightnessPercent: 25, baseline: { code: 'print("atom")', verification: null } })
    expect(render().draft?.boardId).toBe('atoms3lite')
    render().confirmBaseline('テスト講師', true)
    expect(render().draft?.baseline.verification?.boardId).toBe('atoms3lite')
    render().applyDraft()
    expect(render().prompt).toContain('GPIO41')
    expect(render().prompt).toContain('GPIO35')
    render().selectProfile(workshopPresets[0].id)
    expect(render().draft?.kitId).toBe('007')
    expect(render().draft?.boardId).toBe('m5nanoc6')
  })
  it('通常利用は初期未選択、未設定キットを選んでも出力しない', () => {
    expect(render().context).toBeNull()
    expect(render().prompt).toBe('')
    render().selectProfile(workshopPresets[0].id)
    expect(render().context?.errors.length).toBeGreaterThan(0)
    expect(render().prompt).toBe('')
    expect(render().applyDraft()).toBe(false)
  })
  it('選択と編集は保存せず、明示適用後だけ有効な準備文を作る', () => {
    prepare()
    expect(render().prompt).toBe('')
    expect(render().hasPendingChanges).toBe(true)
    expect(render().applyDraft()).toBe(true)
    expect(render().hasPendingChanges).toBe(false)
    expect(render().prompt).toContain('007')
    expect(render().context?.bleEnabled).toBe(false)
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(workshopPresets[0].profile.kitId).toBeNull()
    render().selectProfile(null)
    expect(render().context).toBeNull()
  })
  it.each(['code', 'firmware'])('%s を変更して元に戻しても講師の確認情報は復活しない', field => {
    verifyBaseline()
    expect(render().draft?.baseline.verification).not.toBeNull()
    if (field === 'code') {
      render().editDraft({ baseline: { code: 'new', verification: render().draft!.baseline.verification } })
      render().editDraft({ baseline: { code: 'print("test baseline")', verification: render().draft!.baseline.verification } })
    } else {
      render().editDraft({ firmwareVersion: 'other' })
      render().editDraft({ firmwareVersion: 'test-ui-2' })
    }
    expect(render().draft?.baseline.verification).toBeNull()
    render().applyDraft()
    expect(render().context?.bleEnabled).toBe(false)
  })
  it('講師の明示登録でのみ確認情報を付け、ブラウザ保存も明示操作だけ', () => {
    verifyBaseline()
    render().applyDraft()
    expect(render().context?.controllerEnabled).toBe(true)
    expect(localStorage.setItem).not.toHaveBeenCalled()
    render().saveDraft(false)
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls[0][1])
    expect(saved.profile.baseline.code).toBe('')
    render().saveDraft(true)
    expect(vi.mocked(localStorage.setItem).mock.calls[1][1]).toContain('test baseline')
  })
  it('確認者・コード・版が不足した確認登録を拒否する', () => {
    prepare()
    render().confirmBaseline('テスト講師', true)
    expect(render().draft?.baseline.verification).toBeNull()
    render().editDraft({ baseline: { code: 'code', verification: null } })
    render().confirmBaseline('', true)
    expect(render().draft?.baseline.verification).toBeNull()
  })
  it('pyはテキストとして読み、実行しない。大きいファイルや別拡張子は拒否', async () => {
    prepare()
    const text = vi.fn(async () => 'globalThis.executeMustNotRun()')
    await render().importBaseline({ name: 'baseline.py', size: 32, text })
    expect(render().draft?.baseline.code).toBe('globalThis.executeMustNotRun()')
    expect(render().draft?.baseline.verification).toBeNull()
    await render().importBaseline({ name: 'baseline.js', size: 32, text })
    await render().importBaseline({ name: 'baseline.py', size: 500_000, text })
    expect(text).toHaveBeenCalledOnce()
  })
  it.each(['selection', 'edit'])('ファイル読込中の%s変更を古い内容で上書きしない', async action => {
    prepare()
    let resolve!: (value: string) => void
    const operation = render().importBaseline({ name: 'baseline.py', size: 32, text: () => new Promise(done => { resolve = done }) })
    if (action === 'selection') render().selectProfile(null)
    else render().editDraft({ baseline: { code: 'new draft', verification: null } })
    resolve('old file')
    await operation
    expect(render().draft?.baseline.code).toBe(action === 'selection' ? undefined : 'new draft')
    expect(render().isImporting).toBe(false)
  })
  it('読込中は古い設定の適用・保存・確認登録を止め、終了後も新しいコードは未適用', async () => {
    verifyBaseline()
    render().applyDraft()
    const before = render().context
    let resolve!: (value: string) => void
    const operation = render().importBaseline({ name: 'baseline.py', size: 32, text: () => new Promise(done => { resolve = done }) })
    expect(render().isImporting).toBe(true)
    expect(render().applyDraft()).toBe(false)
    render().saveDraft(true)
    render().confirmBaseline('別講師', true)
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(render().draft?.baseline.verification?.confirmedBy).toBe('テスト講師')
    expect(render().context).toBe(before)
    resolve('new baseline'); await operation
    expect(render().isImporting).toBe(false)
    expect(render().hasPendingChanges).toBe(true)
    expect(render().draft?.baseline.verification).toBeNull()
    expect(render().context).toBe(before)
  })
  it('古い読込完了で次の読込中状態を解除せず、最新ファイルのみ反映する', async () => {
    prepare()
    let first!: (value: string) => void
    let second!: (value: string) => void
    const initial = render().importBaseline({ name: 'first.py', size: 10, text: () => new Promise(done => { first = done }) })
    const latest = render().importBaseline({ name: 'second.py', size: 10, text: () => new Promise(done => { second = done }) })
    first('old'); await initial
    expect(render().isImporting).toBe(true)
    expect(render().draft?.baseline.code).toBe('')
    second('latest'); await latest
    expect(render().isImporting).toBe(false)
    expect(render().draft?.baseline.code).toBe('latest')
  })
  it('配布設定へのリセットは進行中のファイル読込を無効化する', async () => {
    prepare()
    let resolve!: (value: string) => void
    const operation = render().importBaseline({ name: 'baseline.py', size: 32, text: () => new Promise(done => { resolve = done }) })
    render().resetProfile()
    expect(render().isImporting).toBe(false)
    resolve('old'); await operation
    expect(render().draft?.baseline.code).toBe('')
  })
  it('保存機能が使えなくても設定をメモリ上で利用できる', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(render().notice).toContain('読み込めません')
    prepare()
    render().saveDraft(false)
    expect(render().prompt).not.toBe('')
    expect(render().notice).toContain('保存できません')
  })
  it('教材ID・版は画面上の変更で書き換えない', () => {
    prepare()
    render().editDraft({ materialId: 'different', revision: 'different' })
    expect(render().draft?.materialId).toBe(workshopPresets[0].profile.materialId)
    expect(render().draft?.revision).toBe(workshopPresets[0].profile.revision)
  })
})
