import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { StartupDiagnosticsPanel } from '../components/StartupDiagnosticsPanel'
import { setLocale, supportedLocales, translate } from '../i18n'
import { diagnosticMessages } from '../i18n/diagnosticMessages'

type Element = ReactElement<Record<string, unknown>>
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = initial
    return [h.slots[i], (value: unknown) => { h.slots[i] = value }]
  },
}))
const props = { source: 'import bluetooth\nble=bluetooth.BLE()\nble.active(True)\n', log: 'ESP-ROM:esp32c6\nAccess Code: private\n', disabled: false }
const anchors: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[] = []
function render() { h.cursor = 0; return StartupDiagnosticsPanel(props) }
function all(node: ReactNode, predicate: (e: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function button(label: string) { return all(render(), e => e.type === 'button' && text(e) === label)[0] }
beforeEach(() => {
  h.slots = []; h.cursor = 0; anchors.length = 0; props.disabled = false
  props.source = 'import bluetooth\nble=bluetooth.BLE()\nble.active(True)\n'
  setLocale('ja')
  vi.stubGlobal('confirm', vi.fn(() => true))
  vi.stubGlobal('document', { createElement: () => { const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }; anchors.push(anchor); return anchor }, body: { appendChild: vi.fn() } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagnostic')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocale('ja') })
describe('起動診断の書き出しUI', () => {
  it('通常は閉じ、元コードの保管確認前は診断版を保存できない', () => {
    const view = render()
    expect(view.props.open).toBeUndefined()
    expect(button('診断版を保存').props.disabled).toBe(true)
    expect(text(view)).toContain('main.pyを上書き')
    expect(text(view)).toContain('自動実行がON')
    expect(text(view)).toContain('診断はクラッシュの修正ではありません')
  })
  it('別ファイルを書き出すだけで、原コードを変更しない。変更後は保管確認を解除する', async () => {
    const source = props.source
    ;(button('元コードを保存').props.onClick as () => void)()
    const checkbox = all(render(), e => e.type === 'input')[0]
    ;(checkbox.props.onChange as (e: unknown) => void)({ target: { checked: true } })
    expect(button('診断版を保存').props.disabled).toBe(false)
    ;(button('診断版を保存').props.onClick as () => void)()
    const blobs = vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => blob as Blob)
    expect(await blobs[0].text()).toBe(source)
    expect(await blobs[1].text()).toContain('FILE_ENTER')
    expect(anchors.map(a => a.download)).toEqual(['main-original.py', 'main-diagnostic.py'])
    expect(anchors.every(a => a.click.mock.calls.length === 1 && a.remove.mock.calls.length === 1)).toBe(true)
    expect(props.source).toBe(source)
    props.source += '# edit\n'
    expect(button('診断版を保存').props.disabled).toBe(true)
  })
  it('ログ保存前に秘密情報の確認を出し、キャンセル時は保存しない', async () => {
    vi.mocked(confirm).mockReturnValueOnce(false)
    ;(button('診断ログを保存').props.onClick as () => void)()
    expect(confirm).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    ;(button('診断ログを保存').props.onClick as () => void)()
    expect(anchors[0].download).toBe('MicroPython-diagnostic-log.txt')
    expect(await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text()).toBe(props.log)
  })
  it('無効な構文や実行操作中は書き出しを無効にする', () => {
    props.source = 'if :'
    expect(button('診断版を保存').props.disabled).toBe(true)
    expect(text(render())).toContain('自動でログを追加できません')
    props.disabled = true
    expect(button('元コードを保存').props.disabled).toBe(true)
  })
  it.each(supportedLocales.map(locale => locale.id))('%s の診断案内にも翻訳があり、差し込み変数を維持する', locale => {
    for (const key of Object.keys(diagnosticMessages)) {
      const translated = translate(locale, key, { count: 3, skipped: 0 })
      expect(translated.trim()).not.toBe('')
      if (locale !== 'ja') expect(translated).not.toBe(key)
      expect(translated).not.toMatch(/\{(?:count|skipped)\}/)
    }
  })
})
