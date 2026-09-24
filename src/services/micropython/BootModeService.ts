import { BootModeUnsupportedError } from '../../types'
import type { RawReplClient } from './RawReplClient'

const confirmationMarker = '__M5_BOOT_MODE_SAVED__'

export class BootModeService {
  private readonly repl: RawReplClient
  constructor(repl: RawReplClient) { this.repl = repl }
  async set(mode: 0 | 1, capabilities: { bootOptionSupported: boolean; nvsFallbackSupported: boolean }) {
    if (mode !== 0 && mode !== 1) throw new BootModeUnsupportedError()
    // 検出済みの方式を一つだけ使う。書込失敗後に別方式で上書きしない。
    let body: string
    if (capabilities.bootOptionSupported) {
      body = ` import boot_option
 boot_option.set_boot_option(${mode})
 actual=boot_option.get_boot_option()`
    } else if (capabilities.nvsFallbackSupported) {
      body = ` import esp32
 n=esp32.NVS('uiflow')
 n.set_u8('boot_option',${mode})
 n.commit()
 actual=n.get_u8('boot_option')`
    } else {
      throw new BootModeUnsupportedError()
    }
    const code = `def _mpw_set_boot_mode():
${body}
 if actual!=${mode}:
  raise RuntimeError('BOOT_MODE_READBACK_MISMATCH')
 print('${confirmationMarker}'+str(actual))
try:
 _mpw_set_boot_mode()
finally:
 del _mpw_set_boot_mode`
    const result = await this.repl.execute(code)
    const confirmed = result.stdout.split(/\r?\n/).includes(`${confirmationMarker}${mode}`)
    if (result.stderr.trim() || !result.completed || result.interrupted || !confirmed) {
      const detail = result.stderr.trim()
      throw new Error(`起動設定の変更を確認できませんでした。USB接続を確認し、もう一度お試しください。${detail ? `\n${detail}` : ''}`)
    }
  }
  async reset() { await this.repl.reset() }
}
