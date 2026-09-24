import { DeviceCompileError, RawReplProtocolError } from '../../types'
import { BootModeService } from './BootModeService'
import { DeviceProbe } from './DeviceProbe'
import { FileTransferService } from './FileTransferService'
import { RawReplClient, type LongRunningCallbacks, type LongRunningCompletion, type LongRunningStartResult } from './RawReplClient'
import type { WebSerialTransport } from '../serial/WebSerialTransport'
import { clearPreparedProgramCommand, startPreparedProgramCommand, verifyPreparedProgramCommand } from './ProgramCommands'

function expectedKeyboardInterrupt(result: LongRunningCompletion): boolean {
  if (!result.intentionalStop) return false
  const lines = result.stderr.trim().split(/\r?\n/)
  return /^KeyboardInterrupt:?$/.test(lines.at(-1) ?? '') && lines.slice(0, -1).every(line =>
    !line.trim() || /^Traceback(?: \(most recent call last\))?:$/.test(line) || /^\s+File ".+", line \d+(?:, in .+)?$/.test(line))
}

export class MicroPythonDevice {
  readonly repl: RawReplClient
  readonly files: FileTransferService
  readonly probe: DeviceProbe
  readonly boot: BootModeService
  constructor(transport: WebSerialTransport) { this.repl = new RawReplClient(transport); this.files = new FileTransferService(this.repl); this.probe = new DeviceProbe(this.repl); this.boot = new BootModeService(this.repl) }

  async enterNormalMode() {
    this.files.invalidatePreparedProgram()
    if (this.repl.hasLongRunningSession()) {
      const result = await this.stopMain()
      if (result?.hostError) throw result.hostError
      if (!result || result.state === 'error' || (result.stderr.trim() && !expectedKeyboardInterrupt(result))) {
        throw new RawReplProtocolError(result?.stderr || 'プログラムの停止を確認できませんでした。USB操作の復旧を中止します。')
      }
    }
    // 自動起動されたmain.pyもCtrl-Cで止める。起動処理を再実行するリセットは送らない。
    await this.repl.interrupt()
    this.repl.discardPendingInput()
    await this.repl.enterRawRepl()
    // Raw REPL確保後だけ旧Writerの参照を解放する。NVSや作品ファイルには触れない。
    const result = await this.repl.execute(`${clearPreparedProgramCommand()}\nprint('__M5_NORMAL_MODE_READY__')`)
    if (result.stderr.trim() || !result.completed || result.interrupted || !result.stdout.split(/\r?\n/).includes('__M5_NORMAL_MODE_READY__')) {
      throw new RawReplProtocolError(result.stderr || '通常動作の準備を確認できませんでした。USB接続を確認して、もう一度お試しください。')
    }
  }
  async prepareForWrite() {
    if (this.repl.hasLongRunningSession()) {
      const result = await this.stopMain()
      if (result?.hostError) throw result.hostError
      if (!result || result.state === 'error' || (result.stderr.trim() && !expectedKeyboardInterrupt(result))) {
        throw new RawReplProtocolError(result?.stderr || 'プログラムの停止を確認できませんでした。書込みを中止します。')
      }
    }
    this.repl.discardPendingInput()
  }
  async validateMain() {
    const prepared = this.files.peekPreparedProgram()
    if (!prepared) throw new DeviceCompileError('DEVICE_COMPILE_ERROR: 実行準備がありません。もう一度「実行」を押してください。')
    try {
      const result = await this.repl.execute(verifyPreparedProgramCommand(prepared))
      if (result.stderr || !result.stdout.includes('__M5_COMPILE_OK__')) throw new DeviceCompileError(result.stderr || 'DEVICE_COMPILE_ERROR: 保存したプログラムと実行準備を確認できませんでした。')
    } catch (error) {
      await this.files.discardPreparedProgram().catch(() => undefined)
      throw error
    }
  }
  async startMain(callbacks: LongRunningCallbacks = {}): Promise<LongRunningStartResult> {
    const prepared = this.files.takePreparedProgram()
    if (!prepared) throw new DeviceCompileError('DEVICE_COMPILE_ERROR: 実行準備がありません。もう一度「実行」を押してください。')
    return this.repl.startLongRunning(startPreparedProgramCommand(prepared), callbacks)
  }
  async stopMain(): Promise<LongRunningCompletion | undefined> { if (!this.repl.hasLongRunningSession()) return undefined; return this.repl.stopLongRunning() }
}
