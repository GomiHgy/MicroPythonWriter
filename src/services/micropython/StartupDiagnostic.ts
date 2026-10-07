import { pythonLanguage } from '@codemirror/lang-python'

type Node = ReturnType<typeof pythonLanguage.parser.parse>['topNode']
export interface StartupDiagnostic { source: string; points: number; skipped: number }

// 収集・リセット・Wi-Fi/BLE操作はしない。観測APIがない環境でも作品を続ける。
const helper = `# MicroPython Writer startup diagnostic (not a crash fix)
_mpw_diag_seen = set()
def _mpw_diag_mark(number, label):
    if number in _mpw_diag_seen:
        return
    _mpw_diag_seen.add(number)
    print("[MPW DIAG %02d] %s" % (number, label))
    try:
        import gc as _mpw_diag_gc
        print("[MPW MEM %02d] PYTHON allocated=%s free=%s" % (number, _mpw_diag_gc.mem_alloc(), _mpw_diag_gc.mem_free()))
    except Exception:
        print("[MPW MEM %02d] PYTHON unavailable" % number)
    try:
        import esp32 as _mpw_diag_esp32
        print("[MPW MEM %02d] IDF_HEAPS" % number, _mpw_diag_esp32.idf_heap_info(_mpw_diag_esp32.HEAP_DATA))
    except Exception:
        print("[MPW MEM %02d] IDF unavailable" % number)
_mpw_diag_mark(0, "FILE_ENTER")
`

function walk(node: Node, visit: (node: Node) => void) {
  visit(node)
  for (let child = node.firstChild; child; child = child.nextSibling) walk(child, visit)
}

/** 実行せず構文木の文の前後へログを挿入する。式の評価・引数・順序は変更しない。 */
export function buildStartupDiagnostic(source: string): StartupDiagnostic | null {
  try { return buildDiagnostic(source) } catch { return null }
}

function buildDiagnostic(source: string): StartupDiagnostic | null {
  if (!source.trim() || source.length > 1_000_000) return null
  const tree = pythonLanguage.parser.parse(source)
  let invalid = false
  const bleReceivers = new Set<string>()
  const statements: Node[] = []
  const calls = (node: Node) => {
    const result: string[] = []
    const visit = (child: Node) => {
      // 遅延評価される式の定義を、ハードウェアAPIの実行として記録しない。
      if (['LambdaExpression', 'ComprehensionExpression', 'GeneratorExpression'].includes(child.name)) return
      if (child.name === 'CallExpression' && child.firstChild) result.push(source.slice(child.firstChild.from, child.firstChild.to).replace(/\s/g, ''))
      for (let next = child.firstChild; next; next = next.nextSibling) visit(next)
    }
    visit(node)
    return result
  }
  walk(tree.topNode, node => {
    if (node.type.isError || (node.name === 'VariableName' && source.slice(node.from, node.to).startsWith('_mpw_diag_'))) invalid = true
    if (node.name === 'AssignStatement' && calls(node).includes('bluetooth.BLE') && node.firstChild) bleReceivers.add(source.slice(node.firstChild.from, node.firstChild.to).replace(/\s/g, ''))
    if (['AssignStatement', 'ExpressionStatement', 'ImportStatement'].includes(node.name)) statements.push(node)
  })
  if (invalid) return null
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const edits: { from: number; text: string }[] = []
  let points = 0
  let skipped = 0
  for (const node of statements) {
    const text = source.slice(node.from, node.to)
    const label = node.name === 'ImportStatement' && /\b(machine|neopixel|bluetooth)\b/.test(text) ? 'HARDWARE_IMPORT'
      : calls(node).find(callee => ['machine.Pin', 'Pin', 'machine.bitstream', 'bluetooth.BLE', 'LedProgram', 'NanoBle', 'NeoPixel', 'program.step', 'radio.step'].includes(callee)
        || [...bleReceivers].some(receiver => ['active', 'config', 'gap_advertise', 'gatts_register_services', 'gatts_set_buffer', 'irq'].some(method => callee === `${receiver}.${method}`)))
    if (!label) continue
    const from = source.lastIndexOf('\n', node.from - 1) + 1
    const indent = source.slice(from, node.from)
    const lineEnd = source.indexOf('\n', node.to)
    const to = lineEnd < 0 ? source.length : lineEnd + 1
    // 一行suite/セミコロン文へは挿入しない。文・制御構造を壊してまで計測しない。
    if (!/^[ \t]*$/.test(indent) || !/^[ \t\r]*(?:#[^\n]*)?(?:\n)?$/.test(source.slice(node.to, to)) || points >= 32) { skipped++; continue }
    const before = ++points * 2 - 1
    edits.push({ from, text: `${indent}_mpw_diag_mark(${before}, ${JSON.stringify(`${label} BEFORE`)})${newline}` })
    edits.push({ from: to, text: `${lineEnd < 0 ? newline : ''}${indent}_mpw_diag_mark(${before + 1}, ${JSON.stringify(`${label} AFTER`)})${newline}` })
  }
  let preamble = tree.topNode.firstChild
  while (preamble?.name === 'Comment') preamble = preamble.nextSibling
  if (preamble?.name === 'StatementGroup' && preamble.firstChild?.name === 'ExpressionStatement'
    && ['String', 'StringConcat'].includes(preamble.firstChild.firstChild?.name ?? '')) return null
  // モジュールドキュメントとfuture importの位置を維持する。
  if (preamble?.name === 'ExpressionStatement' && ['String', 'StringConcat'].includes(preamble.firstChild?.name ?? '')) preamble = preamble.nextSibling
  while (preamble && (preamble.name === 'Comment' || (preamble.name === 'ImportStatement' && /^from\s+__future__\s+import\b/.test(source.slice(preamble.from, preamble.to))))) preamble = preamble.nextSibling
  if (preamble?.name === 'StatementGroup' && /^from\s+__future__\s+import\b/.test(source.slice(preamble.from, preamble.to))) return null
  const position = preamble ? source.lastIndexOf('\n', preamble.from - 1) + 1 : source.length
  if (preamble && !/^[ \t]*$/.test(source.slice(position, preamble.from))) return null
  // 同じ位置では補助関数を先頭へ。挿入だけなので元の文・コメントはそのまま残る。
  edits.unshift({ from: position, text: `${position === source.length && !source.endsWith('\n') ? newline : ''}${helper.replaceAll('\n', newline)}` })
  const diagnostic = edits.map((edit, order) => ({ ...edit, order })).sort((a, b) => b.from - a.from || b.order - a.order).reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.from), source)
  return { source: diagnostic, points, skipped }
}
