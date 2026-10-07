import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { pythonLanguage } from '@codemirror/lang-python'
import { buildStartupDiagnostic } from '../services/micropython/StartupDiagnostic'

describe('元作品を残した起動診断版の生成', () => {
  it('複数行のAPI呼び出しへ同じインデントで前後のログを追加する', () => {
    const original = 'import machine\nimport bluetooth\nble = bluetooth.BLE()\ndef main():\n    try:\n        ble.active(\n            True\n        )\n        machine.bitstream(pin, 0, timing, data)\n    finally:\n        ble.active(False)\nmain()\n'
    const result = buildStartupDiagnostic(original)!
    expect(result.points).toBe(6)
    expect(result.skipped).toBe(0)
    expect(result.source.indexOf('FILE_ENTER')).toBeLessThan(result.source.indexOf('HARDWARE_IMPORT BEFORE'))
    expect(result.source).toContain('        _mpw_diag_mark(7, "ble.active BEFORE")\n        ble.active(\n            True\n        )\n        _mpw_diag_mark(8, "ble.active AFTER")')
    const errors: string[] = []
    const cursor = pythonLanguage.parser.parse(result.source).cursor()
    do { if (cursor.type.isError) errors.push(cursor.name) } while (cursor.next())
    expect(errors).toEqual([])
    // 元の文やコメントを削除・置換せず挿入だけ行っている。
    const restored = result.source.slice(result.source.indexOf('import machine')).replace(/^\s*_mpw_diag_mark\([^\n]+\)\r?\n/gm, '')
    expect(restored).toBe(original)
  })
  it.each(['"""module doc"""\nfrom __future__ import annotations\nimport machine\n', '# coding: utf-8\r\nimport machine\r\n'])('ヘッダー・docstring・future import・改行を維持する', original => {
    const result = buildStartupDiagnostic(original)!
    expect(result.source.indexOf('_mpw_diag_seen')).toBeGreaterThan(result.source.indexOf(original.split(/\r?\n/)[0]))
    if (original.includes('__future__')) expect(result.source.indexOf('_mpw_diag_seen')).toBeGreaterThan(result.source.indexOf('from __future__'))
    if (original.includes('\r\n')) expect(result.source.replaceAll('\r\n', '')).not.toContain('\n')
  })
  it('文字列・コメント・一行suite・複数文は壊さず残す', () => {
    const original = '# machine.bitstream(a)\ntext="bluetooth.BLE()"\nimport bluetooth\nble=bluetooth.BLE()\nif ok: ble.active(True)\nble.active(False); print("done")\n'
    const result = buildStartupDiagnostic(original)!
    expect(result.points).toBe(2)
    expect(result.skipped).toBeGreaterThan(0)
    expect(result.source).toContain('if ok: ble.active(True)\nble.active(False); print("done")')
  })
  it.each(['', 'if :', '_mpw_diag_seen = 1\n', '"module doc"; import machine\n', 'from __future__ import annotations; import machine\n'])('安全に追加できないコードは拒否する: %s', source => expect(buildStartupDiagnostic(source)).toBeNull())
  it('計測点は上限を設け、GC・リセット・無線操作を追加しない', () => {
    const result = buildStartupDiagnostic('import machine\n' + 'machine.bitstream(pin,0,timing,data)\n'.repeat(40))!
    expect(result.points).toBe(32)
    expect(result.skipped).toBe(9)
    expect(result.source).not.toMatch(/gc\.collect\(|machine\.reset\(|network\.WLAN/)
  })
  it('今回の作品と同じ複数行・クラス形式も構文解析できる', () => {
    // 過去の診断用原本を編集せず、同形式の構文のみ確認する。
    const original = 'import machine\nimport bluetooth\nclass NanoBle:\n    def __init__(self):\n        self.ble = bluetooth.BLE()\n        try:\n            self.ble.active(\n                True\n            )\n            (\n                (self.tx_handle, self.rx_handle),\n            ) = (\n                self.ble\n                .gatts_register_services(services)\n            )\n        except BaseException:\n            self.ble.active(False)\n            raise\ndef main():\n    radio = NanoBle()\n    while True:\n        radio.step(now)\n'
    const result = buildStartupDiagnostic(original)!
    expect(result).not.toBeNull()
    expect(result.points).toBeGreaterThan(5)
    const cursor = pythonLanguage.parser.parse(result.source).cursor()
    do { expect(cursor.type.isError).toBe(false) } while (cursor.next())
  })
  it('ホストPythonで追加ログを除いた構文木が一致し、APIの呼び出し順も維持する', () => {
    const python = [process.env.PYTHON, 'python', 'python3', 'py', ...(process.platform === 'win32' ? [`${process.env.USERPROFILE}/.platformio/penv/Scripts/python.exe`] : [])].filter(Boolean).find(command => spawnSync(command!, ['--version'], { timeout: 5000 }).status === 0)
    expect(python, '診断コードのホスト検証用Pythonが必要').toBeTruthy()
    const original = '"""test"""\nfrom __future__ import annotations\nimport bluetooth\nble = bluetooth.BLE()\nble.active(True)\nble.active(False)\n'
    const diagnostic = buildStartupDiagnostic(original)!.source
    const harness = `import ast,json,sys,types
d=json.load(sys.stdin)
class Strip(ast.NodeTransformer):
 def visit_Expr(self,n):
  if isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='_mpw_diag_mark': return None
  return self.generic_visit(n)
t=ast.parse(d['diagnostic'])
t.body=[n for n in t.body if not (isinstance(n,ast.FunctionDef) and n.name=='_mpw_diag_mark') and not (isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='_mpw_diag_seen' for x in n.targets))]
assert ast.dump(Strip().visit(t))==ast.dump(ast.parse(d['original']))
events=[]
class BLE:
 def __init__(self): events.append('BLE')
 def active(self,x): events.append(('active',x))
sys.modules['bluetooth']=types.SimpleNamespace(BLE=BLE)
exec(compile(d['diagnostic'],'main-diagnostic.py','exec'),{'__name__':'__main__'})
assert events==['BLE',('active',True),('active',False)],events
`
    const result = spawnSync(python!, ['-X', 'utf8', '-B', '-c', harness], { input: JSON.stringify({ original, diagnostic }), encoding: 'utf8', timeout: 15000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('bluetooth.BLE BEFORE')
    expect(result.stdout).toContain('IDF unavailable')
  })
})
