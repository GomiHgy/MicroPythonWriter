import type { ExecutionResult } from '../types'
export class FakeMicroPythonRepl {
  commands: string[] = []; files = new Map<string, Uint8Array>(); failRename = false
  async execute(code: string): Promise<ExecutionResult> {
    this.commands.push(code)
    if (code.includes("open('main.py.tmp','ab')")) { const value = code.match(/base64\(b'([^']+)'/)?.[1] ?? ''; const part = Uint8Array.from(atob(value), char => char.charCodeAt(0)); const old = this.files.get('main.py.tmp') ?? new Uint8Array(); const next = new Uint8Array(old.length + part.length); next.set(old); next.set(part, old.length); this.files.set('main.py.tmp', next) }
    if (code.includes("open('main.py.tmp','rb')")) { const bytes = this.files.get('main.py.tmp') ?? new Uint8Array(); return { stdout: `__SIZE__${bytes.length}\n`, stderr: '', durationMs: 0, completed: true, interrupted: false } }
    if (code.includes("b2a_base64")) { const data = this.files.get('main.py'); return { stdout: `__FILE__${data ? btoa(String.fromCharCode(...data)) : 'None'}\n`, stderr: '', durationMs: 0, completed: true, interrupted: false } }
    return { stdout: '', stderr: '', durationMs: 0, completed: true, interrupted: false }
  }
}
