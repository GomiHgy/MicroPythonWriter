import { pythonLanguage } from '@codemirror/lang-python'
import { isArduinoSource } from './sourceLanguage'

export type ClipboardSourceResult =
  | { ok: true; source: string }
  | { ok: false; reason: 'empty' | 'too-large' | 'not-python' | 'ambiguous' | 'arduino' }

export const MAX_CLIPBOARD_SOURCE_LENGTH = 1_000_000

const statementNames = new Set([
  'ImportStatement', 'FunctionDefinition', 'ClassDefinition', 'DecoratedStatement',
  'IfStatement', 'ForStatement', 'WhileStatement', 'TryStatement', 'WithStatement',
  'MatchStatement', 'UpdateStatement', 'DeleteStatement', 'AssertStatement', 'RaiseStatement',
])

/** エディターと同じ構文解析で、文章やログの全置換をできるだけ避ける。実行はしない。 */
function looksLikePython(source: string): boolean {
  try {
    const tree = pythonLanguage.parser.parse(source)
    const cursor = tree.cursor()
    do {
      if (cursor.type.isError) return false
    } while (cursor.next())

    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
      if (statementNames.has(node.name)) return true
      // 「Error: failed」なども型注釈として解析されるので、代入演算子を必須にする。
      if (node.name === 'AssignStatement' && node.getChild('AssignOp')) return true
      if (node.name === 'ExpressionStatement') {
        const expression = node.cursor()
        do {
          if (expression.name === 'CallExpression') return true
        } while (expression.next())
      }
    }
  } catch {
    // 極端な入力などで解析できない場合も、元のコードを残す。
  }
  return false
}

/**
 * コピーした Python、または Markdown の単一 Python コードブロックを取り出す。
 * インデントと前後の空行は維持し、先頭 BOM と改行コードだけを正規化する。
 * 構文判定は保守的な補助であり、安全性・実行成功・MicroPython 互換性の保証ではない。
 */
export function extractClipboardSource(text: string): ClipboardSourceResult {
  if (text.length > MAX_CLIPBOARD_SOURCE_LENGTH) return { ok: false, reason: 'too-large' }
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return { ok: false, reason: 'empty' }
  for (const character of source) {
    const value = character.charCodeAt(0)
    if ((value < 32 && value !== 9 && value !== 10) || value === 127) return { ok: false, reason: 'not-python' }
  }

  // 先に生コードとして試す。docstring 内に Markdown があっても壊さない。
  if (looksLikePython(source)) return { ok: true, source }

  const lines = source.split('\n')
  const candidates: string[] = []
  let hasArduinoBlock = false
  for (let index = 0; index < lines.length; index++) {
    const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(lines[index])
    if (!opening) continue
    const fence = opening[1]
    const language = opening[2].trim().toLowerCase()
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`)
    const start = index + 1
    index = start
    while (index < lines.length && !closing.test(lines[index])) index++
    if (index === lines.length) return { ok: false, reason: 'not-python' }
    const block = lines.slice(start, index).join('\n') + (index > start ? '\n' : '')
    if (['', 'python', 'py', 'micropython'].includes(language)) {
      // コードブロックの改行も含め、コード部分の空白はそのまま保つ。
      candidates.push(block)
    }
    else if (['cpp', 'c++', 'c', 'arduino', 'ino'].includes(language)) hasArduinoBlock ||= isArduinoSource(block)
  }
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous' }
  if (candidates.length === 0) return { ok: false, reason: hasArduinoBlock || isArduinoSource(source) ? 'arduino' : 'not-python' }
  if (!candidates[0].trim()) return { ok: false, reason: 'empty' }
  if (isArduinoSource(candidates[0])) return { ok: false, reason: 'arduino' }
  return looksLikePython(candidates[0])
    ? { ok: true, source: candidates[0] }
    : { ok: false, reason: 'not-python' }
}
