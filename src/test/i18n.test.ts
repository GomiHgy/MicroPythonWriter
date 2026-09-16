import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocale, isLocale, messages, setLocale, translate } from '../i18n'
import appSource from '../App.tsx?raw'
import preparationSource from '../components/AiPreparationPanel.tsx?raw'
import bluetoothSource from '../components/BluetoothPanel.tsx?raw'
import ts from 'typescript'

afterEach(() => { setLocale('ja'); vi.unstubAllGlobals() })

describe('表示言語', () => {
  it('日本語・英語・簡体字だけを受け付ける', () => {
    expect(['ja', 'en', 'zh'].map(isLocale)).toEqual([true, true, true])
    expect(['fr', 'zh-TW', '', null].some(isLocale)).toBe(false)
  })
  it('言語を保存し、保存拒否でも切り替えられる', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    setLocale('en')
    expect(setItem).toHaveBeenCalledWith('mpw-language', 'en')
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('denied') } })
    expect(() => setLocale('zh')).not.toThrow()
    expect(getLocale()).toBe('zh')
  })
  it('日本語も含めてパラメータを展開し、未知の機器データは変更しない', () => {
    expect(translate('ja', 'コピーに失敗しました: {message}', { message: 'x' })).toBe('コピーに失敗しました: x')
    expect(translate('en', 'コピーに失敗しました: {message}', { message: 'x' })).toBe('Copy failed: x')
    expect(translate('zh', 'NanoLED-001')).toBe('NanoLED-001')
    expect(translate('en', 'main.py が上限 120 bytes を超えています。')).toBe('main.py exceeds the limit of 120 bytes.')
  })
  it('全翻訳が存在し、動的パラメータを保持する', () => {
    const tokens = (value: string) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort()
    for (const [source, translations] of Object.entries(messages)) {
      for (const locale of ['en', 'zh'] as const) {
        expect(translations[locale].trim(), `${locale}: ${source}`).not.toBe('')
        expect(tokens(translations[locale]), `${locale}: ${source}`).toEqual(tokens(source))
      }
    }
  })
  it.each([
    ['受信', 'Receive', '接收'],
    ['常駐プログラム停止', 'Stop running program', '停止运行中的程序'],
    ['常駐プログラム出力', 'Program output', '程序输出'],
    ['常駐プログラム受付', 'Start program', '启动程序'],
    ['Raw REPL同期', 'Raw REPL synchronization', 'Raw REPL 同步'],
    ['Raw REPLプロンプト', 'Raw REPL prompt', 'Raw REPL 提示符'],
    ['有限コマンド受付', 'Accept command', '接受命令'],
    ['有限コマンド標準出力', 'Command output', '命令标准输出'],
    ['有限コマンド標準エラー', 'Command error output', '命令标准错误'],
  ])('ホストの%sタイムアウトは汎用パターンより具体的な操作名を優先して翻訳する', (operation, en, zh) => {
    const message = `${operation}: 受信待機が12345msでタイムアウトしました。`
    expect(translate('ja', message)).toBe(message)
    expect(translate('en', message)).toBe(`${en}: timed out after 12345 ms waiting for data.`)
    expect(translate('zh', message)).toBe(`${zh}：等待接收数据 12345 毫秒后超时。`)
  })
  it('未知の操作名と機器から届いたエラー詳細は勝手に翻訳しない', () => {
    expect(translate('en', '機器が返した名前: 受信待機が42msでタイムアウトしました。')).toBe('機器が返した名前: timed out after 42 ms waiting for data.')
    const details = 'ValueError: 本体ボタン\n  File "main.py", line 2\nGPIO41'
    expect(translate('en', `main.py.tmp の構文確認に失敗しました。\n${details}`)).toBe(`Syntax validation of main.py.tmp failed.\n${details}`)
    expect(translate('zh', `main.py.tmp の構文確認に失敗しました。\n${details}`)).toBe(`main.py.tmp 语法检查失败。\n${details}`)
  })
  it('Appの日本語テキストと画面の固定翻訳キーを網羅する', () => {
    const sources = [['src/App.tsx', appSource], ['src/components/AiPreparationPanel.tsx', preparationSource], ['src/components/BluetoothPanel.tsx', bluetoothSource]]
    for (const [file, text] of sources) {
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text
          if (/[ぁ-んァ-ヶ一-龯]/.test(key)) expect(messages[key], `${file}: ${key}`).toBeDefined()
        }
        if (file === 'src/App.tsx' && ts.isStringLiteral(node) && /[ぁ-んァ-ヶ一-龯]/.test(node.text)) expect(messages[node.text], node.text).toBeDefined()
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
  })
})
