import { FileSystemError } from '../../types'
import type { RawReplClient } from './RawReplClient'
import { clearPreparedProgramCommand, prepareProgramCommand, type PreparedProgram } from './ProgramCommands'

const quote = (value: string) => JSON.stringify(value)
export class FileTransferService {
  private readonly repl: RawReplClient
  private readonly chunkBytes: number
  readonly mainPath: string
  private readonly tempPath: string
  private readonly backupPath: string
  private preparedProgram?: PreparedProgram

  constructor(repl: RawReplClient, chunkBytes = 384, mainPath = '/flash/main.py') {
    this.repl = repl
    this.chunkBytes = chunkBytes
    this.mainPath = mainPath
    this.tempPath = `${mainPath}.tmp`
    this.backupPath = `${mainPath}.bak`
  }

  async readMain(maxBytes = 256 * 1024): Promise<string> {
    const command = `def _mpw_read():
 import os,binascii
 try:
  with open(${quote(this.mainPath)},'rb') as f:
   if os.stat(${quote(this.mainPath)})[6]>${maxBytes}:
    raise ValueError('PROGRAM_TOO_LARGE')
   print('__FILE__',end='')
   while True:
    chunk=f.read(384)
    if not chunk:
     break
    print(binascii.b2a_base64(chunk).decode().strip(),end='')
   print()
 except OSError:
  print('__FILE__None')
try:
 _mpw_read()
finally:
 del _mpw_read
 import gc
 gc.collect()`
    const { stdout, stderr } = await this.repl.execute(command)
    if (stderr) throw new FileSystemError(stderr)
    const data = stdout.match(/__FILE__(.*)/)?.[1]?.trim()
    if (!data || data === 'None') return ''
    let bytes: Uint8Array; try { bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0)) } catch { throw new FileSystemError('main.py のBase64データを安全に解析できませんでした。') }
    if (bytes.length > maxBytes) throw new FileSystemError(`main.py が上限 ${maxBytes} bytes を超えています。`)
    return new TextDecoder().decode(bytes)
  }

  async writeMain(source: string, keepTempOnSyntaxError = true, prepareExecution = false): Promise<number> {
    this.invalidatePreparedProgram()
    const bytes = new TextEncoder().encode(source); const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data))
    const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const prepared: PreparedProgram = { token: crypto.randomUUID(), path: this.mainPath, byteLength: bytes.length, digest: Array.from(digestBytes, byte => byte.toString(16).padStart(2, '0')).join('') }
    await this.executeWrite(`${clearPreparedProgramCommand()}\nimport os\ntry: os.remove(${quote(this.tempPath)})\nexcept OSError: pass\nopen(${quote(this.tempPath)},'wb').close()`)
    for (let offset = 0; offset < bytes.length; offset += this.chunkBytes) {
      const encoded = base64(bytes.slice(offset, offset + this.chunkBytes))
      await this.executeWrite(`import binascii\nf=open(${quote(this.tempPath)},'ab');f.write(binascii.a2b_base64(b'${encoded}'));f.close()`)
    }
    try {
      const validate = await this.repl.execute(prepareProgramCommand(this.tempPath, prepared, prepareExecution))
      if (validate.stderr || !validate.stdout.includes('__M5_COMPILE_OK__')) {
        if (!keepTempOnSyntaxError) await this.repl.execute(`import os\ntry: os.remove(${quote(this.tempPath)})\nexcept OSError: pass`)
        throw new FileSystemError(`main.py.tmp の構文確認に失敗しました。\n${validate.stderr || '構文確認の完了を受信できませんでした。'}`)
      }
      const reported = Number(validate.stdout.match(/__SIZE__(\d+)/)?.[1])
      if (reported !== bytes.length) throw new FileSystemError(`書込みサイズが一致しません: PC=${bytes.length}, device=${reported}`)
      try { await this.executeWrite(`import os\ntry: os.remove(${quote(this.backupPath)})\nexcept OSError: pass\ntry: os.rename(${quote(this.mainPath)},${quote(this.backupPath)})\nexcept OSError: pass\nos.rename(${quote(this.tempPath)},${quote(this.mainPath)})\ntry: os.sync()\nexcept AttributeError: pass`) } catch (error) { await this.repl.execute(`import os\ntry: os.rename(${quote(this.backupPath)},${quote(this.mainPath)})\nexcept OSError: pass`).catch(() => undefined); throw error }
      await this.verifyMainSize(bytes.length)
      // 昇格・保存確認が済むまではホスト側で実行可能にしない。
      if (prepareExecution) this.preparedProgram = prepared
      return bytes.length
    } catch (error) {
      if (prepareExecution) await this.discardPreparedProgram().catch(() => undefined)
      throw error
    }
  }

  peekPreparedProgram(): PreparedProgram | undefined { return this.preparedProgram ? { ...this.preparedProgram } : undefined }
  takePreparedProgram(): PreparedProgram | undefined { const prepared = this.peekPreparedProgram(); this.invalidatePreparedProgram(); return prepared }
  invalidatePreparedProgram() { this.preparedProgram = undefined }
  async discardPreparedProgram() { this.invalidatePreparedProgram(); await this.executeWrite(clearPreparedProgramCommand()) }

  private async executeWrite(command: string) {
    const { stderr } = await this.repl.execute(command)
    // Raw REPLの機器側例外はPromiseのrejectではなくstderrで返る。
    if (stderr) throw new FileSystemError(stderr)
  }

  async verifyMainSize(expectedBytes: number) {
    const { stdout, stderr } = await this.repl.execute(`import os\nprint('__MAIN_SIZE__'+str(os.stat(${quote(this.mainPath)})[6]))`)
    if (stderr) throw new FileSystemError(stderr)
    const actualBytes = Number(stdout.match(/__MAIN_SIZE__(\d+)/)?.[1])
    if (actualBytes !== expectedBytes) throw new FileSystemError(`保存後のmain.pyサイズが一致しません: PC=${expectedBytes}, device=${actualBytes}`)
  }

  async restoreBackup() { await this.discardPreparedProgram(); await this.executeWrite(`import os\nos.rename(${quote(this.backupPath)},${quote(this.mainPath)})`) }
  async removeMain() { await this.discardPreparedProgram(); await this.executeWrite(`import os\nos.remove(${quote(this.mainPath)})`) }
}
