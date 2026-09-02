import { DeviceCompileError } from '../../types'
import { BootModeService } from './BootModeService'
import { DeviceProbe } from './DeviceProbe'
import { FileTransferService } from './FileTransferService'
import { RawReplClient, type LongRunningCallbacks, type LongRunningCompletion, type LongRunningStartResult } from './RawReplClient'
import type { WebSerialTransport } from '../serial/WebSerialTransport'

export class MicroPythonDevice {
  readonly repl: RawReplClient
  readonly files: FileTransferService
  readonly probe: DeviceProbe
  readonly boot: BootModeService
  constructor(transport: WebSerialTransport) { this.repl = new RawReplClient(transport); this.files = new FileTransferService(this.repl); this.probe = new DeviceProbe(this.repl); this.boot = new BootModeService(this.repl) }

  async enterNormalMode() { await this.stopMain().catch(() => undefined); await this.repl.interrupt(); await this.repl.enterRawRepl(); await this.repl.execute('import machine\nmachine.soft_reset()').catch(() => undefined); await this.repl.enterRawRepl() }
  async prepareForWrite() { if (this.repl.hasLongRunningSession()) await this.stopMain(); this.repl.discardPendingInput() }
  async validateMain() {
    const code = `source=open('/flash/main.py','r').read()\ncompile(source,'/flash/main.py','exec')\nprint('__M5_COMPILE_OK__')`
    const result = await this.repl.execute(code)
    if (result.stderr || !result.stdout.includes('__M5_COMPILE_OK__')) throw new DeviceCompileError(result.stderr || 'DEVICE_COMPILE_ERROR: /flash/main.py の構文確認に失敗しました。')
  }
  async startMain(callbacks: LongRunningCallbacks = {}): Promise<LongRunningStartResult> {
    const code = `namespace={'__name__':'__main__','__file__':'/flash/main.py'}\nsource=open('/flash/main.py','r').read()\nexec(compile(source,'/flash/main.py','exec'),namespace)`
    return this.repl.startLongRunning(code, callbacks)
  }
  async stopMain(): Promise<LongRunningCompletion | undefined> { if (!this.repl.hasLongRunningSession()) return undefined; return this.repl.stopLongRunning() }
}
