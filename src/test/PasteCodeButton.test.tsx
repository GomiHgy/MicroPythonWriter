import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasteCodeButton, type PasteCodeButtonProps } from '../components/PasteCodeButton'
import { pasteMessages } from '../i18n/pasteMessages'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  effects: [] as { deps?: unknown[]; cleanup?: () => void }[], effectCursor: 0,
  pending: [] as (() => void)[],
  locale: 'ja' as 'ja' | 'en' | 'zh',
  readText: vi.fn(), replace: vi.fn(),
}))
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
  useLayoutEffect: (run: () => void | (() => void), deps?: unknown[]) => {
    const index = harness.effectCursor++, old = harness.effects[index]
    if (!old || !deps || deps.some((value, position) => !Object.is(value, old.deps?.[position]))) {
      harness.pending.push(() => { old?.cleanup?.(); const cleanup = run(); harness.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined } })
    }
  },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ t: (key: string) => harness.locale === 'ja' ? key : pasteMessages[key]?.[harness.locale] ?? key }) }))

type Element = ReactElement<Record<string, unknown>>
let props: PasteCodeButtonProps
const initialSource = 'print("original code")\n'
const insertedSource = 'from machine import Pin\nprint("new code")\n'
function render() { harness.cursor = 0; harness.effectCursor = 0; const view = PasteCodeButton(props); harness.pending.splice(0).forEach(run => run()); return view }
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
function button(label = 'コピーしたテキストをペースト') {
  const matches = all(render(), element => element.type === 'button' && text(element) === label)
  expect(matches).toHaveLength(1)
  return matches[0]
}
function click(label?: string) { return (button(label).props.onClick as () => Promise<void> | void)() }
function deferred() {
  let resolve!: (value: string) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<string>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.effectCursor = 0; harness.pending = []; harness.locale = 'ja'
  harness.readText.mockReset(); harness.replace.mockReset()
  harness.readText.mockResolvedValue(insertedSource)
  props = { source: initialSource, onReplace: harness.replace, active: true, disabled: false }
  vi.stubGlobal('navigator', { clipboard: { readText: harness.readText } })
})
afterEach(() => { harness.effects.forEach(effect => effect.cleanup?.()); vi.unstubAllGlobals() })

describe('コード全体のクリップボード貼り付け', () => {
  it('画面表示では読み取らず、全置換・自動実行しないことを説明する', () => {
    const view = render()
    expect(text(view)).toContain('下の内容をすべて置き換えます')
    expect(text(view)).toContain('機器への書き込み・実行はしません')
    expect(text(view)).toContain('安全性や実機での動作を保証するものではありません')
    expect(harness.readText).not.toHaveBeenCalled()
    expect(harness.replace).not.toHaveBeenCalled()
    expect(button().props.type).toBe('button')
  })

  it('クリックの同期処理で読み取りを開始し、コード全体を一度だけ差し替えて通知する', async () => {
    const pending = click()
    expect(harness.readText).toHaveBeenCalledOnce()
    expect(harness.replace).not.toHaveBeenCalled()
    await pending
    expect(harness.replace).toHaveBeenCalledExactlyOnceWith(insertedSource)
    const notices = all(render(), node => node.props.role === 'status')
    expect(notices).toHaveLength(1)
    expect(text(notices[0])).toContain('コピーしたコードをすべて貼り付けました')
    expect(text(notices[0])).toContain('機器への書き込み・実行はしていません')
  })

  it('説明付きのPythonコード枠からコードだけを貼り付ける', async () => {
    harness.readText.mockResolvedValue('以下のコードです。\n```python\n' + insertedSource + '```\n実行して確認してください。')
    await click()
    expect(harness.replace).toHaveBeenCalledExactlyOnceWith(insertedSource)
  })

  it('読み取り中はボタン無効で、再描画前の連打も追加要求しない', async () => {
    const read = deferred()
    harness.readText.mockReturnValue(read.promise)
    const handler = button().props.onClick as () => Promise<void>
    const first = handler(), second = handler()
    expect(button('コピーしたテキストを読み取り中…').props.disabled).toBe(true)
    expect(harness.readText).toHaveBeenCalledOnce()
    read.resolve(insertedSource)
    await Promise.all([first, second])
    expect(harness.replace).toHaveBeenCalledOnce()
    expect(button().props.disabled).toBe(false)
  })

  it.each(['disabled', 'active'] as const)('%sにより利用不可のとき、読み取りもコード変更もしない', async field => {
    props[field] = field === 'disabled'
    expect(button().props.disabled).toBe(true)
    await click()
    expect(harness.readText).not.toHaveBeenCalled()
    expect(harness.replace).not.toHaveBeenCalled()
  })

  it.each([
    ['空文字', '', 'コピーしたテキストが空です'],
    ['説明文', 'すべてのLEDを赤にしてください。', 'Pythonコードとして確認できませんでした'],
    ['複数コード枠', '```python\nprint(1)\n```\n```python\nprint(2)\n```', '複数のコード'],
    ['巨大テキスト', '#'.repeat(1_000_001), 'コピーしたテキストが大きすぎます'],
  ])('%sは現在のコードを維持して案内する', async (_label, copied, expected) => {
    harness.readText.mockResolvedValue(copied)
    await click()
    expect(harness.replace).not.toHaveBeenCalled()
    expect(props.source).toBe(initialSource)
    expect(text(render())).toContain(expected)
  })

  it('クリップボードAPIがない場合は手動貼り付けを案内する', async () => {
    vi.stubGlobal('navigator', {})
    await click()
    expect(text(render())).toContain('このブラウザーではボタンから貼り付けできません')
    expect(text(render())).toContain('通常の貼り付け')
    expect(text(render())).toContain('Ctrl+A → Ctrl+V')
    expect(text(render())).toContain('⌘A → ⌘V')
    expect(harness.replace).not.toHaveBeenCalled()
  })

  it('権限拒否時は手動貼り付けを案内し、エラー内部情報を画面に出さない', async () => {
    harness.readText.mockRejectedValue(new Error('private clipboard payload'))
    await click()
    expect(text(render())).toContain('ブラウザーの許可を確認')
    expect(text(render())).toContain('下のコード欄で全選択して貼り付けます')
    expect(text(render())).not.toContain('private clipboard payload')
    expect(harness.replace).not.toHaveBeenCalled()
    expect(button().props.disabled).toBe(false)
  })

  it('非コードのクリップボード内容を通知に露出しない', async () => {
    harness.readText.mockResolvedValue('秘密のメモ: password: example-secret')
    await click()
    expect(text(render())).not.toContain('example-secret')
    expect(harness.replace).not.toHaveBeenCalled()
  })

  it.each(['edit', 'inactive', 'disabled'] as const)('許可待ちの間に%sになると結果を破棄する', async changed => {
    const read = deferred()
    harness.readText.mockReturnValue(read.promise)
    const pending = click()
    if (changed === 'edit') props.source = 'print("new user edits")\n'
    if (changed === 'inactive') props.active = false
    if (changed === 'disabled') props.disabled = true
    render()
    read.resolve(insertedSource)
    await pending
    expect(harness.replace).not.toHaveBeenCalled()
    expect(text(render())).toContain('貼り付けを中止しました')
  })

  it('許可待ちの間に別画面へ移り戻っても、古い貼り付けを適用しない', async () => {
    const read = deferred()
    harness.readText.mockReturnValue(read.promise)
    const pending = click()
    props.active = false; render()
    props.active = true; render()
    read.resolve(insertedSource)
    await pending
    expect(harness.replace).not.toHaveBeenCalled()
    expect(button().props.disabled).toBe(false)
  })

  it('アンマウント後に読み取りが終わってもコードを差し替えない', async () => {
    const read = deferred()
    harness.readText.mockReturnValue(read.promise)
    const pending = click()
    harness.effects.forEach(effect => effect.cleanup?.())
    read.resolve(insertedSource)
    await pending
    expect(harness.replace).not.toHaveBeenCalled()
  })

  it('親のコールバックが変わるだけなら、最新のコールバックで差し替える', async () => {
    const read = deferred(), latestReplace = vi.fn()
    harness.readText.mockReturnValue(read.promise)
    const pending = click()
    props.onReplace = latestReplace; render()
    read.resolve(insertedSource)
    await pending
    expect(latestReplace).toHaveBeenCalledExactlyOnceWith(insertedSource)
    expect(harness.replace).not.toHaveBeenCalled()
  })

  it('同一コードは差し替えず変更なしを知らせる', async () => {
    harness.readText.mockResolvedValue(initialSource)
    await click()
    expect(harness.replace).not.toHaveBeenCalled()
    expect(text(render())).toContain('今のコードと同じです')
    expect(text(render())).not.toContain('貼り付け前に戻す')
  })

  it('貼り付け内容が残っていれば元の全文へ戻せる', async () => {
    await click()
    props.source = insertedSource; render()
    expect(button('貼り付け前に戻す').props.disabled).toBe(false)
    await click('貼り付け前に戻す')
    expect(harness.replace).toHaveBeenLastCalledWith(initialSource)
    expect(text(render())).toContain('貼り付け前のコードに戻しました')
    expect(harness.readText).toHaveBeenCalledOnce()
  })

  it('貼り付け後に編集した内容をUndoで上書きしない', async () => {
    await click()
    props.source = insertedSource + '# next edit\n'; render()
    expect(button('貼り付け前に戻す').props.disabled).toBe(true)
    await click('貼り付け前に戻す')
    expect(harness.replace).toHaveBeenCalledOnce()
    expect(text(render())).toContain('貼り付け後にコードが変わったため')
  })

  it.each(['en', 'zh'] as const)('%sでもボタン・ヘルプ・成功通知を翻訳する', async locale => {
    harness.locale = locale
    const translatedLabel = pasteMessages['コピーしたテキストをペースト'][locale]
    await click(translatedLabel)
    expect(text(render())).toContain(pasteMessages['コピーしたコードをすべて貼り付けました。機器への書き込み・実行はしていません。'][locale])
    expect(text(render())).not.toContain('コピーしたPythonコードで')
  })
})
