import { DeviceCompileError, RawReplProtocolError } from '../../types'
import { BootModeService } from './BootModeService'
import { DeviceProbe } from './DeviceProbe'
import { FileTransferService } from './FileTransferService'
import { RawReplClient, type LongRunningCallbacks, type LongRunningCompletion, type LongRunningStartResult } from './RawReplClient'
import type { WebSerialTransport } from '../serial/WebSerialTransport'
import { startPreparedProgramCommand, verifyPreparedProgramCommand } from './ProgramCommands'

export class MicroPythonDevice {
  readonly repl: RawReplClient
  readonly files: FileTransferService
  readonly probe: DeviceProbe
  readonly boot: BootModeService
  constructor(transport: WebSerialTransport) { this.repl = new RawReplClient(transport); this.files = new FileTransferService(this.repl); this.probe = new DeviceProbe(this.repl); this.boot = new BootModeService(this.repl) }

  async enterNormalMode() { this.files.invalidatePreparedProgram(); await this.stopMain().catch(() => undefined); await this.repl.interrupt(); await this.repl.enterRawRepl(); await this.repl.execute('import machine\nmachine.soft_reset()').catch(() => undefined); await this.repl.enterRawRepl() }
  async prepareForWrite() {
    if (this.repl.hasLongRunningSession()) {
      const result = await this.stopMain()
      if (result?.hostError) throw result.hostError
      if (!result || result.state === 'error' || (result.stderr && !result.intentionalStop)) {
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
