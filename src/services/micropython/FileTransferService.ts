import { FileSystemError } from '../../types'
import type { RawReplClient } from './RawReplClient'

const quote = (value: string) => JSON.stringify(value)
export class FileTransferService {
  private readonly repl: RawReplClient
  private readonly chunkBytes: number
  constructor(repl: RawReplClient, chunkBytes = 384) { this.repl = repl; this.chunkBytes = chunkBytes }
  async readMain(maxBytes = 256 * 1024): Promise<string> {
    const command = `import os,binascii\np=${quote('main.py')}\ntry:\n s=open(p,'rb').read()\n print('__FILE__'+binascii.b2a_base64(s).decode().strip())\nexcept OSError:\n print('__FILE__None')`
    const { stdout } = await this.repl.execute(command); const data = stdout.match(/__FILE__(.*)/)?.[1]?.trim()
    if (!data || data === 'None') return ''
    let bytes: Uint8Array; try { bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0)) } catch { throw new FileSystemError('main.py のBase64データを安全に解析できませんでした。') }
    if (bytes.length > maxBytes) throw new FileSystemError(`main.py が上限 ${maxBytes} bytes を超えています。`)
    return new TextDecoder().decode(bytes)
  }
  async writeMain(source: string, keepTempOnSyntaxError = true) {
    const bytes = new TextEncoder().encode(source); const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data))
    await this.repl.execute("import os,binascii\ntry: os.remove('main.py.tmp')\nexcept OSError: pass\nopen('main.py.tmp','wb').close()")
    for (let offset = 0; offset < bytes.length; offset += this.chunkBytes) {
      const encoded = base64(bytes.slice(offset, offset + this.chunkBytes))
      await this.repl.execute(`import binascii\nf=open('main.py.tmp','ab');f.write(binascii.a2b_base64(b'${encoded}'));f.close()`)
    }
    const validate = await this.repl.execute("s=open('main.py.tmp','rb').read()\nprint('__SIZE__'+str(len(s)))\ncompile(s,'main.py','exec')")
    const reported = Number(validate.stdout.match(/__SIZE__(\d+)/)?.[1]); if (reported !== bytes.length) throw new FileSystemError(`書込みサイズが一致しません: PC=${bytes.length}, device=${reported}`)
    if (validate.stderr) { if (!keepTempOnSyntaxError) await this.repl.execute("import os\ntry: os.remove('main.py.tmp')\nexcept OSError: pass"); throw new FileSystemError(`main.py.tmp の構文確認に失敗しました。\n${validate.stderr}`) }
    try { await this.repl.execute("import os\ntry: os.remove('main.py.bak')\nexcept OSError: pass\ntry: os.rename('main.py','main.py.bak')\nexcept OSError: pass\nos.rename('main.py.tmp','main.py')\ntry: os.sync()\nexcept AttributeError: pass") } catch (error) { await this.repl.execute("import os\ntry: os.rename('main.py.bak','main.py')\nexcept OSError: pass").catch(() => undefined); throw error }
  }
  async restoreBackup() { await this.repl.execute("import os\nos.rename('main.py.bak','main.py')") }
  async removeMain() { await this.repl.execute("import os\nos.remove('main.py')") }
}
