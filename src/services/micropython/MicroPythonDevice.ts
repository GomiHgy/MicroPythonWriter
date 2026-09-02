import { BootModeService } from './BootModeService'
import { DeviceProbe } from './DeviceProbe'
import { FileTransferService } from './FileTransferService'
import { RawReplClient } from './RawReplClient'
import type { WebSerialTransport } from '../serial/WebSerialTransport'
export class MicroPythonDevice {
  readonly repl: RawReplClient; readonly files: FileTransferService; readonly probe: DeviceProbe; readonly boot: BootModeService
  constructor(transport: WebSerialTransport) { this.repl = new RawReplClient(transport); this.files = new FileTransferService(this.repl); this.probe = new DeviceProbe(this.repl); this.boot = new BootModeService(this.repl) }
  async temporaryDevelopmentMode() { await this.repl.interrupt(); await this.repl.enterRawRepl(); await this.repl.execute('import machine\nmachine.soft_reset()').catch(() => undefined); await this.repl.enterRawRepl() }
  async runMain() { return this.repl.execute("namespace={'__name__':'__main__','__file__':'main.py'}\nsource=open('main.py','r').read()\nexec(compile(source,'main.py','exec'),namespace)") }
}
