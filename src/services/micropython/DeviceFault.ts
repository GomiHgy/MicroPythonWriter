import { DeviceRestartError } from '../../types'

/** 行頭のファームウェア出力だけを判定。通常の文章中の「reboot」等では終了させない。 */
export function detectDeviceFault(output: string): DeviceRestartError | undefined {
  if (/^Guru Meditation Error:\s+Core\s+\d+\s+panic'ed\s+\([^)]+\)/m.test(output)
    || /^A fatal error occurred\. The crash dump printed below/m.test(output)) return new DeviceRestartError('panic')
  if (/^ESP-ROM:esp32[a-z0-9]*-\d{8}\r?$/m.test(output) || /^MPY: soft reboot\r?$/m.test(output)) return new DeviceRestartError('restart')
}

/** USBチャンク境界をまたぐ行を保持する。巨大な通常出力は保持し続けない。 */
export class DeviceFaultMonitor {
  private line = ''
  private overflow = false
  consume(byte: number): DeviceRestartError | undefined {
    if (byte === 10 || byte === 4) {
      const fault = this.overflow ? undefined : detectDeviceFault(this.line)
      this.line = ''; this.overflow = false
      return fault
    }
    if (this.overflow) return
    if (this.line.length >= 512) { this.line = ''; this.overflow = true; return }
    this.line += String.fromCharCode(byte)
    // ROM名は改行まで待つ。他のエラーは識別に足る文字が届いた時点で検知する。
    if ((this.line.startsWith('ESP-ROM:') || this.line.startsWith('MPY:')) && byte !== 13) return
    return detectDeviceFault(this.line)
  }
}
