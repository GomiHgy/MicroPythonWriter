import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { ProgramResult } from '../components/ProgramResult'
import type { ProgramFeedback } from '../types/programFeedback'
import { messages, setLocale, translate } from '../i18n'
import componentSource from '../components/ProgramResult.tsx?raw'

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))

type Element = ReactElement<Record<string, unknown>>
function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : ''
}
const base: ProgramFeedback = { id: 3, operation: 'run', phase: 'running', source: 'known code', saved: true, confirmation: 'startup-marker' }
const render = (patch: Partial<ProgramFeedback> = {}, props: Partial<Parameters<typeof ProgramResult>[0]> = {}) => ProgramResult({ feedback: { ...base, ...patch }, source: base.source, connected: true, ...props })

afterEach(() => setLocale('ja'))

describe('機器への書き込み結果', () => {
  it.each([
    ['preparing', false, '書き込みの準備中です'],
    ['writing', false, '機器へ書き込んでいます…'],
    ['verifying', true, '書き込み成功・実行前の確認中です'],
    ['starting', true, '書き込み成功・実行を開始しています…'],
  ] as const)('%s を待機状態で表示し、保存前に成功とは言わない', (phase, saved, title) => {
    const view = render({ phase, saved })
    expect(view.props).toMatchObject({ role: 'status', 'aria-atomic': 'true', className: 'program-result result-pending' })
    expect(text(all(view, element => element.type === 'h3')[0])).toBe(title)
    if (!saved) expect(text(view)).not.toContain('成功')
    expect(text(view)).not.toMatch(/\d+%/)
  })

  it('保存だけの成功は実行したと言わない', () => {
    const view = render({ phase: 'saved', operation: 'write' })
    expect(text(view)).toContain('書き込みに成功しました')
    expect(text(view)).toContain('今回は保存だけで、実行はしていません')
    expect(text(view)).toContain('今回は実行しません')
    expect(view.props.className).toBe('program-result result-success')
  })

  it.each(['startup-marker', 'execution-accepted', 'still-running'] as const)('実行受付 %s は実際のLEDの動作保証と区別する', confirmation => {
    const view = render({ confirmation })
    expect(text(view)).toContain('書き込み成功・実行を開始しました')
    expect(text(view)).toContain('機器を見て確認してください')
    expect(text(view)).toContain(confirmation === 'startup-marker' ? '起動メッセージを受信しました' : '起動メッセージは未確認')
  })

  it.each(['completed', 'stopped'] as const)('%s 後も結果を残す', phase => {
    const view = render({ phase })
    expect(view.props.className).toBe('program-result result-success')
    expect(text(view)).toContain(phase === 'completed' ? 'プログラムが終了しました' : '実行を停止しました')
  })

  it.each([
    ['prepare', false, '書き込みを開始できませんでした'],
    ['write', false, '書き込みを完了できませんでした'],
    ['verify', true, '書き込み成功・実行でエラーが発生しました'],
    ['start', true, '書き込み成功・実行でエラーが発生しました'],
    ['runtime', true, '書き込み成功・実行でエラーが発生しました'],
    ['stop', true, '書き込み済み・停止を確認できませんでした'],
  ] as const)('%s の失敗を保存結果と分け、対処へ誘導する', (failedAt, saved, title) => {
    const onShowError = vi.fn()
    const view = render({ phase: 'failed', failedAt, saved, message: 'device failed' }, { onShowError })
    expect(view.props).toMatchObject({ role: 'alert', className: 'program-result result-error' })
    expect(text(all(view, element => element.type === 'h3')[0])).toBe(title)
    expect(text(view)).toContain('device failed')
    expect(onShowError).not.toHaveBeenCalled()
    const action = all(view, element => element.type === 'button')[0]
    expect(text(action)).toBe('エラーの詳細・対処を見る')
    ;(action.props.onClick as () => void)()
    expect(onShowError).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('切断では保存の確認有無 %s を区別し、実行継続を断定しない', saved => {
    const view = render({ phase: 'disconnected', saved }, { connected: false })
    expect(view.props).toMatchObject({ role: 'alert', className: 'program-result result-warning' })
    expect(text(view)).toContain(saved ? '切断前の保存完了は確認済み' : '保存が完了したか確認できません')
    expect(text(view)).toContain('つなぎ直して')
    expect(text(all(view, element => element.type === 'dd')[1])).toBe('未確認')
  })

  it('書込み後にコードを編集したら現在のコードへの成功表示と誤認させない', () => {
    expect(text(render({}, { source: 'edited code' }))).toContain('この結果は変更前のコードのものです')
    expect(text(render())).not.toContain('この結果は変更前のコードのものです')
  })
  it('完了後の切断では過去の結果であることを明記する', () => {
    expect(text(render({ phase: 'saved', operation: 'write' }, { connected: false }))).toContain('これは切断前の操作結果です')
  })
  it('失敗時の復帰は明示操作だけで行い、準備中や成功時に復帰操作を出さない', () => {
    const onRecover = vi.fn()
    const view = render({ phase: 'failed', failedAt: 'runtime' }, { onRecover })
    expect(onRecover).not.toHaveBeenCalled()
    expect(text(view)).toContain('機器を停止・再初期化します')
    const action = all(view, element => element.type === 'button')[0]
    expect(text(action)).toBe('再試行の準備')
    ;(action.props.onClick as () => void)()
    expect(onRecover).toHaveBeenCalledTimes(1)
    for (const phase of ['running', 'saved', 'writing', 'disconnected'] as const) {
      expect(text(render({ phase }, { onRecover }))).not.toContain('再試行の準備')
    }
  })
  it('機器からのメッセージをHTMLとして扱わない', () => {
    const view = render({ phase: 'failed', failedAt: 'runtime', message: '<img src=x onerror=alert(1)>' })
    expect(text(view)).toContain('<img src=x onerror=alert(1)>')
    expect(all(view, element => 'dangerouslySetInnerHTML' in element.props || element.type === 'img')).toHaveLength(0)
  })

  it('すべての固定表示を日本語・英語・中国語で提供する', () => {
    const tree = ts.createSourceFile('ProgramResult.tsx', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node: ts.Node) {
      if (ts.isStringLiteral(node) && /[ぁ-んァ-ヶ一-龯]/.test(node.text)) {
        expect(messages[node.text], node.text).toBeDefined()
        for (const locale of ['en', 'zh'] as const) {
          expect(translate(locale, node.text)).toBe(messages[node.text][locale])
          expect(messages[node.text][locale].trim()).not.toBe('')
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  })
  it.each(['ja', 'en', 'zh'] as const)('%s で結果タイトルと状態を翻訳する', locale => {
    setLocale(locale)
    const view = render({ phase: 'saved', operation: 'write' })
    expect(text(view)).toContain(translate(locale, '書き込みに成功しました'))
    expect(view.props['aria-label']).toBe(translate(locale, '書き込み・実行の結果'))
    expect(text(view)).toContain('#3')
  })
})
