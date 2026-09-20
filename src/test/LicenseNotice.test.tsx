import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LicenseNotice } from '../components/LicenseNotice'
import { licenseMessages } from '../i18n/licenseMessages'
import { setLocale, translate } from '../i18n'
import source from '../components/LicenseNotice.tsx?raw'
import ts from 'typescript'

type Element = ReactElement<Record<string, unknown>>

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))

function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}

function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode)
  return String(node)
}

beforeEach(() => { setLocale('ja'); vi.stubEnv('PROD', false) })
afterEach(() => { setLocale('ja'); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('共通のライセンス・商標欄', () => {
  it('初期状態は閉じたネイティブdetailsで、開閉のアプリ操作ハンドラーを持たない', () => {
    const view = LicenseNotice()
    expect(view.type).toBe('details')
    expect(view.props.open).toBeUndefined()
    expect(all(view, element => element.type === 'details')).toHaveLength(1)
    const summaries = all(view, element => element.type === 'summary')
    expect(summaries).toHaveLength(1)
    expect(text(summaries[0])).toBe('ライセンス・商標')
    expect(all(view, element => Object.keys(element.props).some(key => /^on[A-Z]/u.test(key)))).toHaveLength(0)
    expect(summaries[0].props.tabIndex).not.toBe(-1)
    expect(source).not.toMatch(/\b(?:useState|useEffect|localStorage|fetch|navigator|BluetoothController|useProgrammer)\b/u)
    const css = readFileSync(new URL('../components/LicenseNotice.css', import.meta.url), 'utf8')
    expect(css).toContain('summary:focus-visible')
    expect(css).toContain('a:focus-visible')
    expect(css).toContain('overflow-wrap: anywhere')
  })

  it.each(['ja', 'en', 'zh'] as const)('%sで必要な説明を表示し、第三者一覧と独自部分の許諾を区別する', locale => {
    setLocale(locale)
    const view = LicenseNotice()
    const displayed = text(view)
    for (const key of Object.keys(licenseMessages).filter(key => key !== '第三者ライセンス全文を開く（別タブ）')) {
      expect(displayed).toContain(translate(locale, key))
    }
    for (const name of ['MicroPython Writer', 'EdelWorks', 'M5Stack', 'MicroPython', 'Bluetooth SIG, Inc.']) expect(displayed).toContain(name)
    expect(displayed).not.toMatch(/Bluetooth認証取得済み|M5Stack公認|すべてのライセンスに適合|無料なので認証や許諾は不要|EdelWorksはBluetooth SIGのライセンスに基づき使用/u)
    expect(displayed).not.toMatch(/Bluetooth certified|officially approved by M5Stack|used by EdelWorks under license|fully license compliant|已获得蓝牙认证|M5Stack 官方认可|EdelWorks 根据许可使用/u)
    if (locale !== 'ja') expect(displayed).not.toMatch(/[ぁ-んァ-ヶ]/u)
    expect(all(view, element => element.type === 'img')).toHaveLength(0)
  })

  it('開発環境では生成されないファイルへリンクせず、生成後の確認方法を案内する', () => {
    const view = LicenseNotice()
    expect(all(view, element => element.type === 'a')).toHaveLength(0)
    expect(text(view)).toContain('本番ビルド後のプレビューまたは公開ページ')
  })

  it.each(['/', './', '/MicroPythonWriter/'])('本番はbase=%sの同梱TXTを安全に別タブで開く', base => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('BASE_URL', base)
    const view = LicenseNotice()
    const links = all(view, element => element.type === 'a')
    expect(links).toHaveLength(1)
    expect(links[0].props).toMatchObject({ href: `${base}third-party-licenses.txt`, target: '_blank', rel: 'noopener noreferrer' })
    expect(text(links[0])).toBe('第三者ライセンス全文を開く（別タブ）')
    expect(text(view)).not.toContain('開発サーバーでは')
  })

  it.each(['ja', 'en', 'zh'] as const)('%sでも本番のリンク名を翻訳し、配信ファイル名は変えない', locale => {
    setLocale(locale)
    vi.stubEnv('PROD', true)
    vi.stubEnv('BASE_URL', '/MicroPythonWriter/')
    const link = all(LicenseNotice(), element => element.type === 'a')[0]
    expect(text(link)).toBe(translate(locale, '第三者ライセンス全文を開く（別タブ）'))
    expect(link.props.href).toBe('/MicroPythonWriter/third-party-licenses.txt')
  })

  it('全UI文言に英語・簡体字訳があり、アプリの翻訳辞書へ登録されている', () => {
    const tree = ts.createSourceFile('LicenseNotice.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const keys: string[] = []
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && ts.isStringLiteral(node.arguments[0])) keys.push(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(keys).toHaveLength(Object.keys(licenseMessages).length)
    for (const key of keys) for (const locale of ['en', 'zh'] as const) {
      expect(licenseMessages[key][locale]).not.toBe('')
      expect(translate(locale, key)).toBe(licenseMessages[key][locale])
    }
  })
})
