import { WebSerialTransport } from './WebSerialTransport'
import { WebUsbCdcTransport, type NavigatorUsb } from './WebUsbCdcTransport'
import type { SerialTransport } from './SerialTransport'

interface TransportOptions {
  serial?: NavigatorSerial | null
  usb?: NavigatorUsb | null
  secureContext?: boolean
  platform?: string
  userAgent?: string
}

/** AndroidのUSBはWebUSBを優先。許可キャンセル後に別の選択画面を勝手に開かない。 */
export function createSerialTransport(options: TransportOptions = {}): SerialTransport {
  const browserNavigator = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { usb?: NavigatorUsb; userAgentData?: { platform?: string } }
  const serial = options.serial === undefined ? browserNavigator?.serial : options.serial
  const usb = options.usb === undefined ? browserNavigator?.usb : options.usb
  const secure = options.secureContext ?? (typeof window === 'undefined' || window.isSecureContext === true)
  if (!secure) return new WebSerialTransport(null)
  const platform = options.platform ?? browserNavigator?.userAgentData?.platform ?? ''
  const userAgent = options.userAgent ?? browserNavigator?.userAgent ?? ''
  const android = /^Android$/i.test(platform) || /\bAndroid\b/i.test(userAgent)
  // Androidではserialが存在してもBluetooth用／対象外USBしか扱えない端末がある。
  // getPorts()の空配列は未許可とも区別できないため、USB対応の判定には使わない。
  if (android && usb) return new WebUsbCdcTransport(usb)
  if (serial) return new WebSerialTransport(serial)
  if (usb) return new WebUsbCdcTransport(usb)
  return new WebSerialTransport(null)
}
