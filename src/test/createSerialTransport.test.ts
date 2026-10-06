import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSerialTransport } from '../services/serial/createSerialTransport'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { WebUsbCdcTransport } from '../services/serial/WebUsbCdcTransport'

const serialApi = () => ({ requestPort: vi.fn().mockRejectedValue(new Error('cancelled')), getPorts: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() })
const usbApi = () => ({ requestDevice: vi.fn(), getDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() })

afterEach(() => { vi.unstubAllGlobals() })

describe('USB接続方式の選択', () => {
  it('Web SerialがあるPCではWebUSBより優先する', () => {
    const usb = usbApi()
    const transport = createSerialTransport({ serial: serialApi(), usb, secureContext: true, platform: 'Windows', userAgent: '' })
    expect(transport).toBeInstanceOf(WebSerialTransport)
    expect(transport.kind).toBe('web-serial')
    expect(transport.supported).toBe(true)
    expect(usb.requestDevice).not.toHaveBeenCalled()
    transport.dispose()
  })

  it('Web SerialがなくWebUSBがあるAndroid向け環境ではCDC方式を使う', () => {
    const transport = createSerialTransport({ serial: null, usb: usbApi(), secureContext: true, platform: 'Android' })
    expect(transport).toBeInstanceOf(WebUsbCdcTransport)
    expect(transport.kind).toBe('webusb-cdc')
    expect(transport.supported).toBe(true)
    transport.dispose()
  })

  it.each([
    { platform: 'Android', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0.0.0' },
    { platform: '', userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) Chrome/150.0.0.0 Mobile' },
    { platform: 'Linux', userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/150.0.0.0 Mobile' },
  ])('両APIがあるAndroidはWebUSBを優先する: $platform / $userAgent', ({ platform, userAgent }) => {
    const serial = serialApi(), usb = usbApi()
    const transport = createSerialTransport({ serial, usb, secureContext: true, platform, userAgent })
    expect(transport).toBeInstanceOf(WebUsbCdcTransport)
    expect(transport.kind).toBe('webusb-cdc')
    expect(transport.supported).toBe(true)
    // factoryは方式を選ぶだけ。画面表示や能力判定だけでは機器選択・列挙・通信を行わない。
    expect(serial.requestPort).not.toHaveBeenCalled()
    expect(serial.getPorts).not.toHaveBeenCalled()
    expect(usb.requestDevice).not.toHaveBeenCalled()
    expect(usb.getDevices).not.toHaveBeenCalled()
    transport.dispose()
  })

  it.each([
    { userAgentData: { platform: 'Android' }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
    { userAgent: 'Mozilla/5.0 (Linux; Android 16)' },
  ])('実際のnavigatorからAndroidを判定し、USBの選択画面だけをタップ時に開く', async environment => {
    const serial = serialApi(), usb = usbApi()
    usb.requestDevice.mockRejectedValueOnce(new Error('USB selection cancelled'))
    vi.stubGlobal('navigator', { ...environment, serial, usb })
    vi.stubGlobal('window', { isSecureContext: true })
    const transport = createSerialTransport()
    expect(transport.kind).toBe('webusb-cdc')
    expect(usb.requestDevice).not.toHaveBeenCalled()
    const connecting = transport.connect()
    // requestDeviceを最初のawait前に呼び、ユーザー操作の権限を失わない。
    expect(usb.requestDevice).toHaveBeenCalledExactlyOnceWith({ filters: [{ vendorId: 0x303a }] })
    await expect(connecting).rejects.toThrow('USB selection cancelled')
    expect(serial.requestPort).not.toHaveBeenCalled()
    expect(serial.getPorts).not.toHaveBeenCalled()
    transport.dispose()
  })

  it('AndroidでもWebUSBがなければ、端末が提供するWeb Serial経路を残す', () => {
    const transport = createSerialTransport({ serial: serialApi(), usb: null, secureContext: true, platform: 'Android' })
    expect(transport).toBeInstanceOf(WebSerialTransport)
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
    const transport = createSerialTransport({ serial, usb, secureContext: false, platform: 'Android' })
    expect(transport.supported).toBe(false)
    expect(serial.requestPort).not.toHaveBeenCalled()
    expect(usb.requestDevice).not.toHaveBeenCalled()
    transport.dispose()
  })

  it('ポート選択キャンセルの後にWebUSBの機器選択を勝手に開かない', async () => {
    const usb = usbApi()
    const transport = createSerialTransport({ serial: serialApi(), usb, secureContext: true, platform: 'Windows', userAgent: '' })
    await expect(transport.connect()).rejects.toThrow('cancelled')
    expect(usb.requestDevice).not.toHaveBeenCalled()
    transport.dispose()
  })
})
