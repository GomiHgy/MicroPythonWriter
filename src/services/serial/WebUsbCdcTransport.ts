import { ByteQueue } from './ByteQueue'
import { DeviceTimeoutError, SerialDisconnectedError, SerialNotSupportedError, SerialPermissionError } from '../../types'
import { getPwaActivity, PWA_UPDATE_BUSY_MESSAGE, setPwaActivity } from '../pwa/PwaActivity'

// WebUSBの型は局所的に扱う。USB-UART変換器や、任意のvendor-specific interfaceには対応しない。
export interface WebUsbEndpoint {
  endpointNumber: number
  direction: 'in' | 'out'
  type: 'bulk' | 'interrupt' | 'isochronous'
  packetSize: number
}
export interface WebUsbAlternate {
  alternateSetting: number
  interfaceClass: number
  interfaceSubclass: number
  endpoints: readonly WebUsbEndpoint[]
}
export interface WebUsbInterface {
  interfaceNumber: number
  alternate?: WebUsbAlternate
  alternates: readonly WebUsbAlternate[]
}
export interface WebUsbConfiguration { configurationValue: number; interfaces: readonly WebUsbInterface[] }
export interface WebUsbControlSetup {
  requestType: 'class'
  recipient: 'interface'
  request: number
  value: number
  index: number
}
export interface WebUsbOutResult { status: 'ok' | 'stall' | 'babble'; bytesWritten: number }
export interface WebUsbInResult { status: 'ok' | 'stall' | 'babble'; data?: DataView }
export interface WebUsbDevice {
  vendorId: number
  productId: number
  serialNumber?: string
  opened: boolean
  configuration: WebUsbConfiguration | null
  configurations: readonly WebUsbConfiguration[]
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>
  controlTransferOut(setup: WebUsbControlSetup, data?: Uint8Array): Promise<WebUsbOutResult>
  transferIn(endpointNumber: number, length: number): Promise<WebUsbInResult>
  transferOut(endpointNumber: number, data: Uint8Array): Promise<WebUsbOutResult>
}
export interface NavigatorUsb {
  requestDevice(options: { filters: Array<{ vendorId: number }> }): Promise<WebUsbDevice>
  getDevices(): Promise<WebUsbDevice[]>
  addEventListener(type: 'disconnect', listener: (event: Event & { device: WebUsbDevice }) => void): void
  removeEventListener(type: 'disconnect', listener: (event: Event & { device: WebUsbDevice }) => void): void
}

interface CdcLayout {
  configuration: WebUsbConfiguration
  control: WebUsbInterface
  controlAlternate: WebUsbAlternate
  data: WebUsbInterface
  dataAlternate: WebUsbAlternate
  input: WebUsbEndpoint
  output: WebUsbEndpoint
}
interface DeviceIdentity { device: WebUsbDevice; vendorId: number; productId: number; serialNumber?: string }

export class WebUsbCdcUnsupportedError extends Error {
  constructor(message = 'このUSB機器の接続方式には対応していません。UIFlow2が通常起動しているM5NanoC6／AtomS3Liteを選んでください。') { super(message) }
}

const ESPRESSIF_VENDOR_ID = 0x303a
const TRANSFER_SIZE = 16 * 1024
const ambiguousCdc = () => new WebUsbCdcUnsupportedError('USB通信の候補が複数あるため、安全に接続先を選べません。パソコン版Chrome／EdgeのUSB接続を使用してください。')
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

function chooseAlternate(iface: WebUsbInterface, candidates: WebUsbAlternate[]): WebUsbAlternate {
  if (candidates.length === 1) return candidates[0]
  const active = candidates.find(alternate => alternate.alternateSetting === iface.alternate?.alternateSetting)
  if (active) return active
  throw ambiguousCdc()
}

/** 高レベルdescriptor APIだけではUnion/IADが分からないため、ACMとdataが各1 interfaceの構成だけ許可する。 */
function configurationLayout(configuration: WebUsbConfiguration): CdcLayout | undefined {
  const controls = configuration.interfaces.flatMap(iface => {
    const alternates = iface.alternates.filter(alternate => alternate.interfaceClass === 0x02 && alternate.interfaceSubclass === 0x02)
    return alternates.length ? [{ iface, alternates }] : []
  })
  const datas = configuration.interfaces.filter(iface => iface.alternates.some(alternate => alternate.interfaceClass === 0x0a))
  if (!controls.length || !datas.length) return undefined
  if (controls.length !== 1 || datas.length !== 1) throw ambiguousCdc()
  const control = controls[0].iface
  const controlAlternate = chooseAlternate(control, controls[0].alternates)
  const data = datas[0]
  const dataAlternates = data.alternates.filter(alternate => alternate.interfaceClass === 0x0a &&
    alternate.endpoints.filter(endpoint => endpoint.type === 'bulk' && endpoint.direction === 'in').length === 1 &&
    alternate.endpoints.filter(endpoint => endpoint.type === 'bulk' && endpoint.direction === 'out').length === 1)
  if (!dataAlternates.length || control.interfaceNumber === data.interfaceNumber) return undefined
  const dataAlternate = chooseAlternate(data, dataAlternates)
  const input = dataAlternate.endpoints.find(endpoint => endpoint.type === 'bulk' && endpoint.direction === 'in')!
  const output = dataAlternate.endpoints.find(endpoint => endpoint.type === 'bulk' && endpoint.direction === 'out')!
  if (!Number.isInteger(input.endpointNumber) || input.endpointNumber < 1 || input.endpointNumber > 15 ||
    !Number.isInteger(output.endpointNumber) || output.endpointNumber < 1 || output.endpointNumber > 15 ||
    !Number.isInteger(input.packetSize) || input.packetSize <= 0) return undefined
  return { configuration, control, controlAlternate, data, dataAlternate, input, output }
}

function deviceLayout(device: WebUsbDevice): CdcLayout {
  if (device.vendorId !== ESPRESSIF_VENDOR_ID) throw new WebUsbCdcUnsupportedError()
  if (device.configuration) {
    const current = configurationLayout(device.configuration)
    if (current) return current
  }
  const candidates = device.configurations.map(configurationLayout).filter((layout): layout is CdcLayout => Boolean(layout))
  if (!candidates.length) throw new WebUsbCdcUnsupportedError()
  if (candidates.length !== 1) throw ambiguousCdc()
  return candidates[0]
}

/** Native USB CDC-ACM用のバイト通信。main.py転送／Raw REPLは既存の上位処理を共用する。 */
export class WebUsbCdcTransport {
  readonly kind = 'webusb-cdc' as const
  queue = new ByteQueue()
  private readonly usb: NavigatorUsb | undefined
  private device?: WebUsbDevice
  private layout?: CdcLayout
  private previous?: DeviceIdentity
  private subscribers = new Set<(data: Uint8Array) => void>()
  private disconnectSubscribers = new Set<() => void>()
  private writeChain: Promise<void> = Promise.resolve()
  private generation = 0
  private pendingConnections = 0
  private pendingCloses = 0
  private disposed = false
  private listening = false
  private ready = false
  private stopReader?: () => void
  private closings = new WeakMap<WebUsbDevice, Promise<void>>()
  private readonly onUsbDisconnect = (event: Event & { device: WebUsbDevice }) => {
    if (event.device === this.device) this.failConnection(new SerialDisconnectedError())
  }

  constructor(usb: NavigatorUsb | undefined = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { usb?: NavigatorUsb }).usb) {
    this.usb = usb
    this.attachListener()
  }
  get supported() { return Boolean(this.usb) }
  get connected() { return this.ready && Boolean(this.device?.opened) && !this.disposed }
  onData(callback: (data: Uint8Array) => void) { this.subscribers.add(callback); return () => { this.subscribers.delete(callback) } }
  onDisconnectDetected(callback: () => void) { this.disconnectSubscribers.add(callback); return () => { this.disconnectSubscribers.delete(callback) } }

  async connect(baudRate = 115200) {
    const usb = this.beginConnection()
    const generation = ++this.generation
    try {
      // requestDeviceより前にawaitしない。Androidのタップに含まれるユーザー操作権限を維持する。
      let selected: WebUsbDevice
      try { selected = await usb.requestDevice({ filters: [{ vendorId: ESPRESSIF_VENDOR_ID }] }) }
      catch (error) { throw new SerialPermissionError(`USB機器の選択がキャンセルされたか、許可されませんでした。${errorText(error)}`) }
      this.assertCurrent(generation)
      this.device = selected
      await this.open(baudRate)
      this.assertCurrent(generation)
      this.previous = { device: selected, vendorId: selected.vendorId, productId: selected.productId, serialNumber: selected.serialNumber || undefined }
    } catch (error) {
      if (generation === this.generation) await this.closeConnection()
      throw error
    } finally { this.pendingConnections--; this.updateActivity() }
  }

  async reconnect(baudRate = 115200) {
    const usb = this.beginConnection()
    const generation = ++this.generation
    try {
      const authorized = (await usb.getDevices()).filter(device => device.vendorId === ESPRESSIF_VENDOR_ID)
      this.assertCurrent(generation)
      const previous = this.previous
      const matches = previous ? authorized.filter(device => previous.serialNumber
        ? device.vendorId === previous.vendorId && device.productId === previous.productId && device.serialNumber === previous.serialNumber
        : device === previous.device) : authorized
      if (matches.length !== 1) throw new SerialPermissionError('前回のUSB機器を安全に特定できません。「USBを選び直す」を押して機器を選んでください。')
      this.device = matches[0]
      await this.open(baudRate)
      this.assertCurrent(generation)
      this.previous = { device: matches[0], vendorId: matches[0].vendorId, productId: matches[0].productId, serialNumber: matches[0].serialNumber || undefined }
    } catch (error) {
      if (generation === this.generation) await this.closeConnection()
      throw error
    } finally { this.pendingConnections--; this.updateActivity() }
  }

  async open(baudRate: number) {
    if (getPwaActivity().updating) throw new Error(PWA_UPDATE_BUSY_MESSAGE)
    const device = this.device
    const generation = this.generation
    if (!device) throw new SerialDisconnectedError()
    if (!Number.isInteger(baudRate) || baudRate <= 0 || baudRate > 0xffffffff) throw new Error('USBの通信速度が正しくありません。')
    const layout = deviceLayout(device)
    this.queue = new ByteQueue()
    this.writeChain = Promise.resolve()
    try {
      await device.open()
      this.assertCurrent(generation)
    } catch (error) {
      // open待ち中のcloseでは、あとから成功したopenを閉じられない。元のdevice自身を再度閉じる。
      if (generation !== this.generation || this.disposed) await this.closeDevice(device)
      throw error
    }
    if (device.configuration?.configurationValue !== layout.configuration.configurationValue) {
      await device.selectConfiguration(layout.configuration.configurationValue)
      this.assertCurrent(generation)
    }
    for (const [iface, alternate] of [[layout.control, layout.controlAlternate], [layout.data, layout.dataAlternate]] as const) {
      await device.claimInterface(iface.interfaceNumber)
      this.assertCurrent(generation)
      if (iface.alternate?.alternateSetting !== alternate.alternateSetting) {
        await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting)
        this.assertCurrent(generation)
      }
    }
    const coding = new Uint8Array(7)
    new DataView(coding.buffer).setUint32(0, baudRate, true)
    coding[6] = 8 // 8 data bits / 1 stop bit / no parity
    const codingResult = await device.controlTransferOut({ requestType: 'class', recipient: 'interface', request: 0x20, value: 0, index: layout.control.interfaceNumber }, coding)
    this.assertCurrent(generation)
    if (codingResult.status !== 'ok' || codingResult.bytesWritten !== coding.length) throw new Error('USBの通信速度を設定できませんでした。')
    // RTSは必ずfalse。303a:1001のhardware USB Serial/JTAGではDTRもfalseにする。
    // C6はDTR=trueでdownload-mode flagが立ち、次のmachine.reset()がROM起動になり得る。
    // TinyUSB CDCではDTR=trueが必要なため、それ以外のCDC構成に限りDTRだけを立てる。
    const lineValue = device.productId === 0x1001 ? 0 : 1
    const lineResult = await device.controlTransferOut({ requestType: 'class', recipient: 'interface', request: 0x22, value: lineValue, index: layout.control.interfaceNumber })
    this.assertCurrent(generation)
    if (lineResult.status !== 'ok') throw new Error('USBの通常通信を開始できませんでした。')
    this.layout = layout
    this.ready = true
    this.updateActivity()
    this.startReader(device, layout, generation)
  }

  async write(data: Uint8Array) {
    const device = this.device, layout = this.layout, generation = this.generation
    if (!this.connected || !device || !layout) throw new SerialDisconnectedError()
    const action = async () => {
      this.assertCurrent(generation)
      try {
        for (let offset = 0; offset < data.length;) {
          this.assertCurrent(generation)
          const chunk = data.slice(offset, offset + TRANSFER_SIZE)
          const result = await device.transferOut(layout.output.endpointNumber, chunk)
          this.assertCurrent(generation)
          if (result.status !== 'ok' || !Number.isInteger(result.bytesWritten) || result.bytesWritten <= 0 || result.bytesWritten > chunk.length) throw new SerialDisconnectedError('USBへの送信を完了できませんでした。ケーブルを確認して、つなぎ直してください。')
          offset += result.bytesWritten
        }
      } catch (error) {
        const disconnected = error instanceof SerialDisconnectedError ? error : new SerialDisconnectedError(`USBへの送信中に接続が切れました。${errorText(error)}`)
        if (generation === this.generation) this.failConnection(disconnected)
        throw disconnected
      }
    }
    const next = this.writeChain.then(action, action)
    this.writeChain = next.catch(() => undefined)
    return next
  }

  waitFor(pattern: Uint8Array, timeoutMs: number, signal?: AbortSignal) { return this.queue.readUntil(pattern, timeoutMs, signal) }
  async expect(pattern: Uint8Array, timeoutMs: number) {
    try { return await this.waitFor(pattern, timeoutMs) }
    catch (error) { if (error instanceof DeviceTimeoutError) throw error; throw new SerialDisconnectedError() }
  }
  async disconnect() { await this.closeConnection() }
  dispose() {
    this.disposed = true
    if (this.listening) { this.usb?.removeEventListener('disconnect', this.onUsbDisconnect); this.listening = false }
    void this.closeConnection()
  }

  private beginConnection(): NavigatorUsb {
    if (getPwaActivity().updating) throw new Error(PWA_UPDATE_BUSY_MESSAGE)
    if (!this.usb) throw new SerialNotSupportedError()
    if (this.pendingConnections || this.connected || this.pendingCloses) throw new Error('USBの接続処理中です。少し待ってから、もう一度操作してください。')
    this.disposed = false
    this.attachListener()
    this.pendingConnections++
    this.updateActivity()
    return this.usb
  }
  private attachListener() {
    if (!this.listening && this.usb) { this.usb.addEventListener('disconnect', this.onUsbDisconnect); this.listening = true }
  }
  private assertCurrent(generation: number) {
    if (generation !== this.generation || this.disposed) throw new SerialDisconnectedError()
  }
  private updateActivity() { setPwaActivity(this, this.pendingConnections > 0 || this.pendingCloses > 0 || this.connected) }
  private async closeDevice(device: WebUsbDevice): Promise<void> {
    const existing = this.closings.get(device)
    if (existing) return existing
    this.pendingCloses++
    this.updateActivity()
    const closing = (async () => {
      // close()は未完了transferを中止し、claimed interfaceも解放する。read pumpの終了より先に呼ぶ。
      try { await device.close() } catch { /* 抜線済みの機器はcloseも失敗することがある */ }
      finally { this.pendingCloses--; this.closings.delete(device); this.updateActivity() }
    })()
    this.closings.set(device, closing)
    return closing
  }
  private async closeConnection(error = new SerialDisconnectedError()) {
    this.generation++
    this.ready = false
    this.queue.close(error)
    this.stopReader?.()
    this.stopReader = undefined
    const device = this.device
    this.device = undefined
    this.layout = undefined
    if (device) await this.closeDevice(device)
    this.updateActivity()
  }
  private failConnection(error: SerialDisconnectedError) {
    const notify = this.ready
    void this.closeConnection(error)
    if (notify) this.disconnectSubscribers.forEach(callback => callback())
  }
  private startReader(device: WebUsbDevice, layout: CdcLayout, generation: number) {
    const cancelled = new Promise<undefined>(resolve => { this.stopReader = () => resolve(undefined) })
    void (async () => {
      try {
        while (generation === this.generation && this.connected) {
          const result = await Promise.race([device.transferIn(layout.input.endpointNumber, layout.input.packetSize), cancelled])
          if (!result || generation !== this.generation) return
          if (result.status !== 'ok' || !result.data) throw new SerialDisconnectedError('USBからの受信を継続できませんでした。ケーブルを確認して、つなぎ直してください。')
          if (!result.data.byteLength) { await new Promise(resolve => setTimeout(resolve, 0)); continue }
          const bytes = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength).slice()
          this.queue.push(bytes)
          this.subscribers.forEach(callback => callback(bytes))
        }
      } catch (error) {
        if (generation === this.generation) this.failConnection(error instanceof SerialDisconnectedError ? error : new SerialDisconnectedError(`USBからの受信中に接続が切れました。${errorText(error)}`))
      }
    })()
  }
}
