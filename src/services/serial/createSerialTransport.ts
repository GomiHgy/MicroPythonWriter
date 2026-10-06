import { WebSerialTransport } from './WebSerialTransport'
import { WebUsbCdcTransport, type NavigatorUsb } from './WebUsbCdcTransport'
import type { SerialTransport } from './SerialTransport'

interface TransportOptions {
  serial?: NavigatorSerial | null
  usb?: NavigatorUsb | null
  secureContext?: boolean
}

/** APIの有無で選ぶ。許可キャンセル・接続失敗を理由に別の機器選択を勝手に開かない。 */
export function createSerialTransport(options: TransportOptions = {}): SerialTransport {
  const browserNavigator = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { usb?: NavigatorUsb }
  const serial = options.serial === undefined ? browserNavigator?.serial : options.serial
  const usb = options.usb === undefined ? browserNavigator?.usb : options.usb
  const secure = options.secureContext ?? (typeof window === 'undefined' || window.isSecureContext === true)
  if (!secure) return new WebSerialTransport(null)
  if (serial) return new WebSerialTransport(serial)
  if (usb) return new WebUsbCdcTransport(usb)
  return new WebSerialTransport(null)
}
