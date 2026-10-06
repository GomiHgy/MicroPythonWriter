import { describe, expect, it, vi } from 'vitest'
import { createSerialTransport } from '../services/serial/createSerialTransport'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { WebUsbCdcTransport } from '../services/serial/WebUsbCdcTransport'

const serialApi = () => ({ requestPort: vi.fn().mockRejectedValue(new Error('cancelled')), getPorts: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() })
const usbApi = () => ({ requestDevice: vi.fn(), getDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() })

describe('USB接続方式の選択', () => {
  it('Web SerialがあるPCではWebUSBより優先する', () => {
    const usb = usbApi()
    const transport = createSerialTransport({ serial: serialApi(), usb: usb as never, secureContext: true })
    expect(transport).toBeInstanceOf(WebSerialTransport)
    expect(transport.kind).toBe('web-serial')
    expect(transport.supported).toBe(true)
    expect(usb.requestDevice).not.toHaveBeenCalled()
    transport.dispose()
  })

  it('Web SerialがなくWebUSBがあるAndroid向け環境ではCDC方式を使う', () => {
    const transport = createSerialTransport({ serial: null, usb: usbApi() as never, secureContext: true })
    expect(transport).toBeInstanceOf(WebUsbCdcTransport)
    expect(transport.kind).toBe('webusb-cdc')
    expect(transport.supported).toBe(true)
    transport.dispose()
  })

  it('どちらもない環境では非対応になる', () => {
    const transport = createSerialTransport({ serial: null, usb: null, secureContext: true })
    expect(transport.supported).toBe(false)
    transport.dispose()
  })

  it('安全でないページではどちらの選択画面も開かない', () => {
    const serial = serialApi()
    const usb = usbApi()
    const transport = createSerialTransport({ serial, usb: usb as never, secureContext: false })
    expect(transport.supported).toBe(false)
    expect(serial.requestPort).not.toHaveBeenCalled()
    expect(usb.requestDevice).not.toHaveBeenCalled()
    transport.dispose()
  })

  it('ポート選択キャンセルの後にWebUSBの機器選択を勝手に開かない', async () => {
    const usb = usbApi()
    const transport = createSerialTransport({ serial: serialApi(), usb: usb as never, secureContext: true })
    await expect(transport.connect()).rejects.toThrow('cancelled')
    expect(usb.requestDevice).not.toHaveBeenCalled()
    transport.dispose()
  })
})
