import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { ProgramLibraryPanel, type ProgramLibraryPanelProps } from '../components/ProgramLibraryPanel'
import panelSource from '../components/ProgramLibraryPanel.tsx?raw'
import serviceSource from '../services/programs/ProgramLibrary.ts?raw'
import { programLibraryMessages } from '../i18n/programLibraryMessages'
import { loadProgramLibrary, PROGRAM_LIBRARY_STORAGE_KEY, saveLibraryProgram, type SavedProgram } from '../services/programs/ProgramLibrary'
import type { ProjectSettings } from '../services/projects/types'

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, locale: 'ja' as 'ja' | 'en' | 'zh' }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [harness.slots[index], (next: Value | ((old: Value) => Value)) => { harness.slots[index] = typeof next === 'function' ? (next as (old: Value) => Value)(harness.slots[index] as Value) : next }]
  },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ locale: harness.locale, t: (key: string, values: Record<string, string | number> = {}) => (harness.locale === 'ja' ? key : programLibraryMessages[key]?.[harness.locale] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match)) }) }))

type Element = ReactElement<Record<string, unknown>>
let props: ProgramLibraryPanelProps
let data: Map<string, string>
const settings: ProjectSettings = { boardId: 'm5nanoc6', firmwareVersion: '2.5.3', ledModel: 'WS2812B-MINI', ledCount: 37, ledPin: 2, maxBrightnessPercent: 20 }
function render() { harness.cursor = 0; return ProgramLibraryPanel(props) }
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
function find(predicate: (element: Element) => boolean) { const result = all(render(), predicate); expect(result).toHaveLength(1); return result[0] }
function button(label: string) { return find(element => element.type === 'button' && text(element) === label) }
function input(id: string) { return find(element => element.props.id === id) }
function invoke(element: Element, handler: string, value?: unknown) { return (element.props[handler] as (value: unknown) => unknown)(value) }
function click(label: string) { invoke(button(label), 'onClick') }
function change(id: string, value: string) { invoke(input(id), 'onChange', { target: { value } }) }
function submit() { invoke(find(element => element.type === 'form'), 'onSubmit', { preventDefault: vi.fn() }) }
function fillName() { change('library-name', '魔法の杖'); change('library-description', 'ボタンで光る\nイベント用') }
function existing(overrides: Partial<SavedProgram> = {}) {
  const programs = saveLibraryProgram({ name: '星空', description: 'ゆっくり点滅', source: 'print("stars")', settings, ...overrides })
  return programs[programs.length - 1]
}

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.locale = 'ja'
  data = new Map()
  vi.stubGlobal('localStorage', { getItem: vi.fn((key: string) => data.get(key) ?? null), setItem: vi.fn((key: string, value: string) => data.set(key, value)), removeItem: vi.fn((key: string) => data.delete(key)) })
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
  props = { source: '# unchanged\nprint("hello")\n', settings: { ...settings }, busy: false, onLoad: vi.fn(() => true), onOpenPreparation: vi.fn() }
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('プログラムのブラウザ保存UI', () => {
  it('空一覧と保存先・機器へ送信しない説明を表示し、表示だけでは保存しない', () => {
    const result = text(render())
    expect(result).toContain('保存したプログラムはまだありません')
    expect(result).toContain('外部への送信や機器への書き込みは行いません')
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(props.onLoad).not.toHaveBeenCalled()
  })

  it('名前と説明を必須にし、両方入力後にその時点のコードと設定を新規保存する', () => {
    click('このプログラムを保存')
    expect(button('名前を付けて保存する').props.disabled).toBe(true)
    expect(input('library-name').props.required).toBe(true)
    expect(input('library-description').props.required).toBe(true)
    change('library-name', '魔法の杖')
    submit()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    change('library-description', 'ボタンで光る\nイベント用')
    props.source = '# saved exactly\r\nprint("new")\r\n'
    submit()
    const stored = loadProgramLibrary().programs
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: '魔法の杖', description: 'ボタンで光る\nイベント用', source: props.source, settings })
    expect(text(find(element => element.props.role === 'status'))).toContain('このブラウザに保存しました')
    expect(all(render(), element => element.type === 'form')).toHaveLength(0)
    expect(props.onLoad).not.toHaveBeenCalled()
  })

  it('一覧に名前・説明・機器・LEDの全設定と保存日時を表示する', () => {
    const program = existing()
    const result = text(render())
    for (const value of ['星空', 'ゆっくり点滅', 'M5NanoC6', 'WS2812B-MINI', '37個', 'GPIO 2', '20%', '2.5.3']) expect(result).toContain(value)
    expect(find(element => element.type === 'time').props.dateTime).toBe(program.savedAt)
    expect(result).toContain('コードから自動で読み取った値や、実機での動作保証ではありません')
  })

  it('未設定の場合は機器を勝手に選ばず、仮のLED設定を示して明示選択を要求する', () => {
    props.settings = null
    click('このプログラムを保存'); fillName()
    expect(input('library-board').props.value).toBe('')
    expect(input('library-led-count').props.value).toBe('10')
    expect(input('library-led-pin').props.value).toBe('2')
    expect(input('library-brightness').props.value).toBe('20')
    expect(button('名前を付けて保存する').props.disabled).toBe(true)
    submit()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    change('library-board', 'atoms3lite')
    expect(input('library-led-pin').props.max).toBe(48)
    submit()
    expect(loadProgramLibrary().programs[0].settings).toMatchObject({ boardId: 'atoms3lite', ledCount: 10, ledPin: 2, maxBrightnessPercent: 20, firmwareVersion: '' })
    expect(text(render())).toContain('AtomS3Lite')
    expect(text(render())).toContain('未記入')
  })

  it('フォームを開いた後に親設定が更新されても入力内容を戻さず、設定変更だけではコードを書き換えない', () => {
    click('このプログラムを保存'); fillName()
    change('library-led-count', '88')
    props.settings = { ...settings, ledCount: 110 }
    expect(input('library-led-count').props.value).toBe('88')
    const original = props.source
    submit()
    expect(loadProgramLibrary().programs[0].settings.ledCount).toBe(88)
    expect(loadProgramLibrary().programs[0].source).toBe(original)
    click('このプログラムを保存')
    expect(input('library-led-count').props.value).toBe('110')
  })

  it('空コードなら保存を開かず、入力取消は保存しない', () => {
    props.source = ' \n'
    expect(button('このプログラムを保存').props.disabled).toBe(true)
    click('このプログラムを保存')
    expect(all(render(), element => element.type === 'form')).toHaveLength(0)
    props.source = 'print(1)'
    click('このプログラムを保存'); fillName(); click('キャンセル')
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('数値欄の空欄を0へ変換して保存せずエラーを通知する', () => {
    click('このプログラムを保存'); fillName(); change('library-led-pin', '')
    submit()
    expect(text(find(element => element.props.role === 'alert'))).toContain('入力してください')
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('保存失敗時は成功にせずフォームを維持し、元の保存内容を消さない', () => {
    existing()
    const original = data.get(PROGRAM_LIBRARY_STORAGE_KEY)
    click('このプログラムを保存'); fillName()
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('Quota exceeded') })
    submit()
    expect(data.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(original)
    expect(text(find(element => element.props.role === 'alert'))).toContain('容量や保存設定を確認')
    expect(input('library-name').props.value).toBe('魔法の杖')
    expect(all(render(), element => element.props.role === 'status')).toHaveLength(0)
  })

  it('破損データは保存で上書きせず、読み直しで復帰できる', () => {
    data.set(PROGRAM_LIBRARY_STORAGE_KEY, '{broken')
    expect(button('このプログラムを保存').props.disabled).toBe(true)
    expect(text(find(element => element.props.role === 'alert'))).toContain('元の保存データは変更していません')
    click('このプログラムを保存')
    expect(data.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe('{broken')
    data.delete(PROGRAM_LIBRARY_STORAGE_KEY)
    click('保存リストを読み直す')
    expect(button('このプログラムを保存').props.disabled).toBe(false)
  })

  it('読み込みは親へ保存内容を渡し、親が取消した場合は成功通知しない', () => {
    const program = existing()
    vi.mocked(props.onLoad).mockReturnValueOnce(false)
    click('編集画面に読み込む')
    expect(props.onLoad).toHaveBeenCalledWith(program)
    expect(text(find(element => element.props.role === 'status'))).toContain('読み込みを中止しました')
    expect(find(element => element.props.role === 'status').props.className).toContain('neutral')
    click('編集画面に読み込む')
    expect(text(find(element => element.props.role === 'status'))).toContain('機器には送信していません')
    vi.mocked(props.onLoad).mockReturnValueOnce(false)
    click('編集画面に読み込む')
    expect(text(find(element => element.props.role === 'status'))).toContain('読み込みを中止しました')
    expect(find(element => element.props.role === 'status').props.className).not.toContain('success')
  })

  it('機器処理中は読込ハンドラーの直接呼び出しも拒否する', () => {
    existing(); props.busy = true
    expect(button('編集画面に読み込む').props.disabled).toBe(true)
    click('編集画面に読み込む')
    expect(props.onLoad).not.toHaveBeenCalled()
    expect(button('このプログラムを保存').props.disabled).toBe(false)
  })

  it('別プログラムの読込成功時は以前のコード用保存フォームを閉じ、取消では入力を残す', () => {
    existing()
    click('このプログラムを保存'); fillName()
    vi.mocked(props.onLoad).mockReturnValueOnce(false)
    click('編集画面に読み込む')
    expect(input('library-name').props.value).toBe('魔法の杖')
    click('編集画面に読み込む')
    expect(all(render(), element => element.type === 'form')).toHaveLength(0)
  })

  it('削除は確認後だけ実行し、編集中コード・機器操作を変更しない', () => {
    existing()
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    click('保存リストから削除')
    expect(loadProgramLibrary().programs).toHaveLength(1)
    click('保存リストから削除')
    expect(loadProgramLibrary().programs).toHaveLength(0)
    expect(props.onLoad).not.toHaveBeenCalled()
    expect(text(find(element => element.props.role === 'status'))).toContain('機器のプログラムは変更していません')
  })

  it('準備画面へは明示操作だけで移動する', () => {
    render()
    expect(props.onOpenPreparation).not.toHaveBeenCalled()
    click('機器・LED設定をAIの準備で確認')
    expect(props.onOpenPreparation).toHaveBeenCalledOnce()
  })

  it('保存済みの名前・説明にHTMLが含まれても実行せずテキストで表示する', () => {
    existing({ name: '<img src=x>', description: '<script>alert(1)</script>' })
    const view = render()
    expect(text(view)).toContain('<img src=x>')
    expect(all(view, element => element.type === 'img' || element.type === 'script' || 'dangerouslySetInnerHTML' in element.props)).toHaveLength(0)
  })

  it.each(['en', 'zh'] as const)('%sでフォーム・一覧・保存通知・削除確認を翻訳する', locale => {
    harness.locale = locale
    const translated = (key: string) => programLibraryMessages[key][locale]
    click(translated('このプログラムを保存'))
    fillName()
    expect(text(render())).toContain(translated('このプログラムで使う機器とLED'))
    submit()
    expect(text(render())).toContain(translated('プログラムをこのブラウザに保存しました。機器には送信していません。'))
    click(translated('保存リストから削除'))
    expect(window.confirm).toHaveBeenCalledWith(translated('「{name}」を保存リストから削除しますか？編集中のコードや機器のプログラムは消しません。').replace('{name}', '魔法の杖'))
  })

  it('UI文言と保存サービスのエラーを全て英語・中国語カタログに含める', () => {
    const keys = new Set<string>()
    for (const [name, source] of [['Panel.tsx', panelSource], ['Storage.ts', serviceSource]]) {
      const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) && /[ぁ-ゖァ-ヺ一-龯]/u.test(node.text)) keys.add(node.text)
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    for (const key of keys) {
      expect(programLibraryMessages[key], key).toBeDefined()
      expect(programLibraryMessages[key]?.en, key).toBeTruthy()
      expect(programLibraryMessages[key]?.zh, key).toBeTruthy()
    }
  })
})
