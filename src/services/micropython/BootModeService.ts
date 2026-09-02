import { BootModeUnsupportedError } from '../../types'
import type { RawReplClient } from './RawReplClient'
export class BootModeService {
  private readonly repl: RawReplClient
  constructor(repl: RawReplClient) { this.repl = repl }
  async set(mode: 0 | 1, capabilities: { bootOptionSupported: boolean; nvsFallbackSupported: boolean }) {
    if (capabilities.bootOptionSupported) { await this.repl.execute(`import boot_option\nboot_option.set_boot_option(${mode})`); return }
    if (capabilities.nvsFallbackSupported) { await this.repl.execute(`import esp32\nn=esp32.NVS('uiflow')\nn.set_u8('boot_option',${mode})\nn.commit()`); return }
    throw new BootModeUnsupportedError()
  }
  async reset() { await this.repl.execute('import machine\nmachine.reset()') }
}
