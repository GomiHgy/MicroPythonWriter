import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { BootModePanel } from '../components/BootModePanel'
import componentSource from '../components/BootModePanel.tsx?raw'
import { messages, setLocale, translate } from '../i18n'
import type { BootFeedback } from '../types/bootFeedback'

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof BootModePanel>[0]
let props: Props
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
function render() { return BootModePanel(props) }
function button(label: string) {
  const found = all(render(), element => element.type === 'button' && text(element) === label)
  expect(found, label).toHaveLength(1)
  return found[0]
}
function click(element: Element) { (element.props.onClick as () => void)() }
function noOperations() {
  for (const operation of [props.onDisable, props.onEnable, props.onConnect, props.onRecover, props.onReset]) expect(operation).not.toHaveBeenCalled()
}

beforeEach(() => {
  setLocale('ja')
  props = {
    state: 'disconnected', supported: true, bootSupported: false,
    onDisable: vi.fn(), onEnable: vi.fn(), onConnect: vi.fn(), onRecover: vi.fn(), onReset: vi.fn(),
  }
})
afterEach(() => setLocale('ja'))

describe('自動起動解除の安全な案内', () => {
  it('未接続でも解除の手順と無効な解除ボタンを表示し、作品を消さないことを説明する', () => {
    const view = render()
    expect(all(view, element => element.type === 'li')).toHaveLength(3)
    expect(text(view)).toContain('接続しただけでは自動起動の設定は変わりません')
    expect(text(view)).toContain('作品のプログラムは消しません')
    const disable = button('自動実行しない設定に戻す')
    expect(disable.props.disabled).toBe(true)
    click(disable)
    noOperations()
    click(button('USBで接続して設定を確認'))
    expect(props.onConnect).toHaveBeenCalledOnce()
    expect(props.onDisable).not.toHaveBeenCalled()
  })

  it.each(['raw-repl-ready', 'stopped', 'running', 'running-no-marker'] as const)('%sでは停止ボタンを先に要求せず明示クリックで解除を依頼する', state => {
    props.state = state
    props.bootOption = 0
    props.bootSupported = true
    const disable = button('自動実行しない設定に戻す')
    expect(disable.props.disabled).toBe(false)
    expect(text(render())).toContain('自動実行 ON')
    noOperations()
    click(disable)
    expect(props.onDisable).toHaveBeenCalledOnce()
    for (const operation of [props.onEnable, props.onConnect, props.onRecover, props.onReset]) expect(operation).not.toHaveBeenCalled()
  })

  it('既に自動実行OFFなら再設定せず、再びONにする明示操作を残す', () => {
    props.state = 'stopped'
    props.bootOption = 1
    props.bootSupported = true
    expect(text(render())).toContain('自動実行 OFF')
    const disable = button('自動実行しない設定に戻す')
    expect(disable.props.disabled).toBe(true)
    click(disable)
    noOperations()
    const enable = button('電源を入れたら自動で実行する')
    expect(enable.props.disabled).toBe(false)
    click(enable)
    expect(props.onEnable).toHaveBeenCalledOnce()
    expect(props.onDisable).not.toHaveBeenCalled()
  })

  it('接続前の古い起動設定を現在の機器の確認済み表示に使わない', () => {
    props.bootOption = 0
    props.bootSupported = true
    expect(text(render())).toContain('起動設定は未確認')
    expect(all(render(), element => String(element.props.className).includes('boot-mode-badge')).map(text)).toEqual(['起動設定は未確認'])
  })

  it.each(['unsupported', 'disconnected', 'connection-lost', 'reconnecting', 'requesting-port', 'opening', 'connected', 'interrupting', 'entering-raw-repl', 'probing', 'uploading', 'verifying', 'starting', 'stopping', 'setting-boot-mode', 'resetting', 'error'] as const)('%sでは起動設定ボタンのハンドラーを直接呼んでも変更しない', state => {
    props.state = state
    props.bootSupported = true
    props.bootOption = undefined
    for (const label of ['自動実行しない設定に戻す', '電源を入れたら自動で実行する']) {
      const action = button(label)
      expect(action.props.disabled).toBe(true)
      click(action)
    }
    noOperations()
  })

  it.each(['supported', 'bootSupported'] as const)('%sが未対応なら接続済みでも設定を変更せず理由を示す', unsupported => {
    props.state = 'stopped'
    props.bootOption = 0
    props.bootSupported = true
    props[unsupported] = false
    expect(text(render())).toContain(unsupported === 'supported' ? 'パソコン版ChromeまたはEdge' : 'このファームウェアでは起動設定の変更方法を確認できません')
    const action = button('自動実行しない設定に戻す')
    expect(action.props.disabled).toBe(true)
    click(action)
    noOperations()
  })

  it('Web Serial非対応では接続ハンドラーを直接呼んでも接続しない', () => {
    props.supported = false
    const connect = button('USBで接続して設定を確認')
    expect(connect.props.disabled).toBe(true)
    click(connect)
    noOperations()
  })

  it.each(['disconnected', 'connection-lost', 'unsupported', 'running', 'stopped', 'error'] as const)('%sで表示するだけでは機器設定を変更しない', state => {
    props.state = state
    props.bootOption = 0
    props.bootSupported = true
    expect(text(render())).not.toBe('')
    noOperations()
  })

  it.each(['saving', 'resetting'] as const)('%sでは現在の処理を表示し、起動設定・復旧・再起動の二重操作を防ぐ', phase => {
    props.state = 'stopped'
    props.bootSupported = true
    props.feedback = { phase, mode: 1, saved: phase === 'resetting' }
    const view = render()
    const result = all(view, element => element.props.role === 'status')
    expect(result).toHaveLength(1)
    expect(text(result[0])).toContain(phase === 'saving' ? '起動設定を変更しています' : '設定を保存しました。再起動を指示しています')
    for (const action of all(view, element => element.type === 'button')) {
      expect(action.props.disabled).toBe(true)
      click(action)
    }
    noOperations()
  })

  it.each([0, 1] as const)('保存成功 mode=%s を機器の現在状態とは分けて通知し、再接続を案内する', mode => {
    props.feedback = { mode, phase: 'saved', saved: true }
    const result = all(render(), element => element.props.role === 'status')
    expect(result).toHaveLength(1)
    expect(text(result[0])).toContain(mode === 1 ? '自動実行しない設定を保存しました' : '自動実行する設定を保存しました')
    expect(text(result[0])).toContain('直前にUSB接続した機器への設定結果')
    expect(text(result[0])).toContain('USBをつなぎ直して現在の設定を確認')
    expect(text(render())).toContain('起動設定は未確認')
    noOperations()
  })

  it.each([false, true])('失敗では設定保存の確認有無=%sを区別し、機器の再起動成功を断定しない', saved => {
    props.state = 'error'
    props.feedback = { mode: 1, phase: 'failed', saved, message: '<img src=x onerror=alert(1)>' }
    const view = render()
    const result = all(view, element => element.props.role === 'alert')
    expect(result).toHaveLength(1)
    expect(text(result[0])).toContain('設定変更の完了を確認できませんでした')
    expect(text(result[0])).toContain(saved ? '設定の保存は確認済みですが、再起動手順は完了していません' : '現在の設定は未確認です')
    expect(text(result[0])).toContain('<img src=x onerror=alert(1)>')
    expect(all(view, element => element.type === 'img' || 'dangerouslySetInnerHTML' in element.props)).toHaveLength(0)
    noOperations()
    click(button('USB操作をやり直す（起動設定は変えません）'))
    expect(props.onRecover).toHaveBeenCalledOnce()
    expect(props.onDisable).not.toHaveBeenCalled()
    expect(props.onReset).not.toHaveBeenCalled()
  })

  it.each(['en', 'zh'] as const)('%sでもガイド・状態・操作を翻訳し、機器を自動操作しない', locale => {
    setLocale(locale)
    for (const state of ['disconnected', 'running', 'error', 'setting-boot-mode'] as const) {
      props.state = state
      props.bootSupported = true
      for (const bootOption of [undefined, 0, 1]) {
        props.bootOption = bootOption
        expect(text(render())).not.toMatch(/[ぁ-んァ-ヶ]/u)
      }
    }
    noOperations()
  })

  it.each((['en', 'zh'] as const).flatMap(locale => (['saving', 'resetting', 'saved', 'failed'] as const).map(phase => [locale, phase] as const)))('%sで%s結果を翻訳する', (locale, phase) => {
    setLocale(locale)
    for (const mode of [0, 1] as const) {
      for (const saved of [false, true]) {
        props.feedback = { mode, phase, saved } satisfies BootFeedback
        expect(text(render())).not.toMatch(/[ぁ-んァ-ヶ]/u)
      }
    }
    noOperations()
  })

  it('全固定表示の英語・中国語翻訳と置換変数が揃う', () => {
    const tree = ts.createSourceFile('BootModePanel.tsx', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let count = 0
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && /[ぁ-んァ-ヶ一-龯]/u.test(node.text)) {
        count++
        expect(messages[node.text], node.text).toBeDefined()
        for (const locale of ['en', 'zh'] as const) {
          const translated = translate(locale, node.text)
          expect(translated.trim(), node.text).not.toBe('')
          expect(translated, node.text).not.toMatch(/[ぁ-んァ-ヶ]/u)
          expect([...translated.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()).toEqual([...node.text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort())
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(count).toBeGreaterThan(10)
  })
})
