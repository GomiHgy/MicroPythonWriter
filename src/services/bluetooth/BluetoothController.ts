import { encodeCommand, LedStatusParser, NANO_LED_RX_UUID, NANO_LED_SERVICE_UUID, NANO_LED_TX_UUID, type LedStatus } from './protocol'

export interface BluetoothCharacteristic {
  value?: DataView | null
  writeValueWithResponse(data: BufferSource): Promise<void>
  startNotifications(): Promise<BluetoothCharacteristic>
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface BluetoothService {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>
}

export interface BluetoothServer {
  connect(): Promise<BluetoothServer>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BluetoothService>
}

export interface BluetoothDevice {
  name?: string
  gatt?: BluetoothServer
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface BluetoothApi {
  requestDevice(options: { filters: Array<{ namePrefix: string }>; optionalServices: string[] }): Promise<BluetoothDevice>
}

export interface BluetoothSnapshot {
  readonly phase: 'unsupported' | 'disconnected' | 'connecting' | 'connected'
  readonly deviceName: string | null
  readonly status: LedStatus | null
  readonly receivedAt: number | null
  readonly error: string | null
  readonly sending: boolean
}

export interface BluetoothControllerOptions {
  bluetooth?: BluetoothApi
  secureContext?: boolean
  timeoutMs?: number
  pollMs?: number
}

interface QueuedCommand {
  command: string
  bytes: Uint8Array<ArrayBuffer>
  key: string | null
  resolve: (sent: boolean) => void
}

class SessionCancelledError extends Error {}
class BluetoothTimeoutError extends Error {}
class IncompatibleDeviceError extends Error {}

const EMPTY_STATE = { deviceName: null, status: null, receivedAt: null, sending: false }
const defaultBluetooth = (): BluetoothApi | undefined => typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth

export class BluetoothController {
  private readonly bluetooth: BluetoothApi | undefined
  private readonly supported: boolean
  private readonly timeoutMs: number
  private readonly pollMs: number
  private snapshot: BluetoothSnapshot
  private listeners = new Set<() => void>()
  private generation = 0
  private device: BluetoothDevice | undefined
  private rx: BluetoothCharacteristic | undefined
  private tx: BluetoothCharacteristic | undefined
  private disconnectedListener: EventListener | undefined
  private notificationListener: EventListener | undefined
  private cancellations = new Set<() => void>()
  private parser = new LedStatusParser()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private queue: QueuedCommand[] = []
  private currentCommand: QueuedCommand | undefined
  private processingGeneration: number | null = null

  constructor(options: BluetoothControllerOptions = {}) {
    this.bluetooth = options.bluetooth ?? defaultBluetooth()
    const secure = options.secureContext ?? (typeof isSecureContext !== 'undefined' && isSecureContext)
    this.supported = secure && !!this.bluetooth
    this.timeoutMs = options.timeoutMs ?? 10000
    this.pollMs = options.pollMs ?? 2000
    this.snapshot = Object.freeze({
      ...EMPTY_STATE,
      phase: this.supported ? 'disconnected' : 'unsupported',
      error: this.supported ? null : !secure ? 'Bluetooth接続にはHTTPSまたはlocalhostで開いてください。' : 'このブラウザではBluetoothに接続できません。パソコンやAndroidの対応するChrome・Edgeで開いてください。',
    })
  }

  getSnapshot = (): BluetoothSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async connect(): Promise<void> {
    if (!this.supported || !this.bluetooth || this.snapshot.phase === 'connecting' || this.snapshot.phase === 'connected') return
    const generation = ++this.generation
    let stage: 'selection' | 'connection' | 'service' = 'selection'
    this.update({ ...EMPTY_STATE, phase: 'connecting', error: null })
    try {
      const device = await this.guard(this.bluetooth.requestDevice({ filters: [{ namePrefix: 'NanoLED-' }], optionalServices: [NANO_LED_SERVICE_UUID] }), generation, false)
      this.assertCurrent(generation)
      if (!device.gatt) throw new IncompatibleDeviceError()
      stage = 'connection'
      this.device = device
      this.update({ deviceName: device.name || 'NanoLED' })
      this.disconnectedListener = () => {
        if (this.isCurrent(generation)) this.resetConnection('Bluetoothの接続が切れました。機器の電源と距離を確認して、もう一度つないでください。')
      }
      device.addEventListener('gattserverdisconnected', this.disconnectedListener)
      const connecting = device.gatt.connect()
      void connecting.then(server => {
        if (!this.isCurrent(generation) && this.device !== device) this.closeServer(server)
      }, () => undefined)
      const server = await this.guard(connecting, generation)
      this.assertCurrent(generation)
      stage = 'service'
      const service = await this.guard(server.getPrimaryService(NANO_LED_SERVICE_UUID), generation)
      this.assertCurrent(generation)
      const rx = await this.guard(service.getCharacteristic(NANO_LED_RX_UUID), generation)
      this.assertCurrent(generation)
      const tx = await this.guard(service.getCharacteristic(NANO_LED_TX_UUID), generation)
      this.assertCurrent(generation)
      if (typeof rx.writeValueWithResponse !== 'function') throw new IncompatibleDeviceError()
      this.rx = rx
      this.tx = tx
      this.notificationListener = () => {
        if (!this.isCurrent(generation) || !tx.value) return
        const { statuses, rejected } = this.parser.push(new Uint8Array(tx.value.buffer, tx.value.byteOffset, tx.value.byteLength))
        const status = statuses.at(-1)
        if (status) this.update({ status, receivedAt: Date.now(), error: null })
        else if (rejected) this.update({ error: '機器から届いたLEDの状態を読み取れません。コントローラ対応のBLEプログラムか確認してください。' })
      }
      tx.addEventListener('characteristicvaluechanged', this.notificationListener)
      await this.guard(tx.startNotifications(), generation)
      this.assertCurrent(generation)
      this.update({ phase: 'connected' })
      if (this.pollMs > 0) this.pollTimer = setInterval(() => {
        if (!this.isCurrent(generation) || this.snapshot.phase !== 'connected') return
        if (this.snapshot.receivedAt !== null && Date.now() - this.snapshot.receivedAt < this.pollMs) return
        if (this.currentCommand?.command === 'STATUS' || this.queue.some(item => item.command === 'STATUS')) return
        void this.send('STATUS')
      }, this.pollMs)
      await this.send('STATUS')
    } catch (error) {
      if (!this.isCurrent(generation) || error instanceof SessionCancelledError) return
      const cancelled = stage === 'selection' && error instanceof Error && error.name === 'NotFoundError'
      this.resetConnection(cancelled ? null : this.errorMessage(error, stage))
    }
  }

  disconnect(): void {
    this.resetConnection(null)
  }

  dispose(): void {
    this.disconnect()
    this.listeners.clear()
  }

  send(input: string): Promise<boolean> {
    if (this.snapshot.phase !== 'connected' || !this.rx) {
      if (this.supported) this.update({ error: '先にBluetoothで機器をつないでください。' })
      return Promise.resolve(false)
    }
    let bytes: Uint8Array<ArrayBuffer>
    try { bytes = new Uint8Array(encodeCommand(input)) } catch (error) {
      this.update({ error: error instanceof Error ? error.message : 'この合図は送れません。' })
      return Promise.resolve(false)
    }
    const command = new TextDecoder().decode(bytes).trim()
    const token = command.split(' ')[0]
    const key = token === 'BRIGHTNESS' || token === 'SPEED' || token === 'STATUS' ? token : null
    if (token === 'OFF') {
      this.queue.splice(0).forEach(item => item.resolve(false))
    }
    return new Promise<boolean>(resolve => {
      const item = { command, bytes, key, resolve }
      const replacing = key ? this.queue.findIndex(queued => queued.key === key) : -1
      if (replacing >= 0) {
        this.queue[replacing].resolve(false)
        this.queue[replacing] = item
      } else if (this.queue.length >= 24) {
        this.update({ error: '操作が混み合っています。少し待ってからもう一度試してください。' })
        resolve(false)
        return
      } else this.queue.push(item)
      void this.drainQueue(this.generation)
    })
  }

  private async drainQueue(generation: number): Promise<void> {
    if (this.processingGeneration === generation) return
    this.processingGeneration = generation
    try {
      while (this.isCurrent(generation) && this.rx && this.queue.length) {
        const item = this.queue.shift()!
        this.currentCommand = item
        this.update({ sending: true })
        try {
          await this.guard(this.rx.writeValueWithResponse(item.bytes), generation)
          this.assertCurrent(generation)
          item.resolve(true)
        } catch (error) {
          item.resolve(false)
          if (this.isCurrent(generation) && !(error instanceof SessionCancelledError)) this.resetConnection(this.errorMessage(error, 'write'))
          return
        } finally {
          if (this.isCurrent(generation)) this.currentCommand = undefined
        }
      }
    } finally {
      if (this.processingGeneration === generation) this.processingGeneration = null
      if (this.isCurrent(generation)) this.update({ sending: false })
    }
  }

  private guard<T>(promise: Promise<T>, generation: number, timed = true): Promise<T> {
    if (!this.isCurrent(generation)) return Promise.reject(new SessionCancelledError())
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer)
        this.cancellations.delete(cancel)
      }
      const cancel = () => { cleanup(); reject(new SessionCancelledError()) }
      this.cancellations.add(cancel)
      if (timed) timer = setTimeout(() => { cleanup(); reject(new BluetoothTimeoutError()) }, this.timeoutMs)
      promise.then(value => {
        cleanup()
        if (this.isCurrent(generation)) resolve(value)
        else reject(new SessionCancelledError())
      }, error => { cleanup(); reject(error) })
    })
  }

  private resetConnection(error: string | null): void {
    this.generation++
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    this.pollTimer = undefined
    const device = this.device
    if (this.disconnectedListener) device?.removeEventListener('gattserverdisconnected', this.disconnectedListener)
    if (this.notificationListener) this.tx?.removeEventListener('characteristicvaluechanged', this.notificationListener)
    this.device = undefined
    this.rx = undefined
    this.tx = undefined
    this.disconnectedListener = undefined
    this.notificationListener = undefined
    for (const cancel of [...this.cancellations]) cancel()
    this.queue.splice(0).forEach(item => item.resolve(false))
    this.currentCommand?.resolve(false)
    this.currentCommand = undefined
    this.processingGeneration = null
    this.parser.reset()
    this.closeServer(device?.gatt)
    if (this.supported) this.update({ ...EMPTY_STATE, phase: 'disconnected', error })
  }

  private closeServer(server: BluetoothServer | undefined): void {
    try { server?.disconnect() } catch { return }
  }

  private errorMessage(error: unknown, stage: 'selection' | 'connection' | 'service' | 'write'): string {
    if (error instanceof BluetoothTimeoutError) return 'Bluetoothの応答がありません。機器の電源と距離を確認して、もう一度つないでください。'
    if (error instanceof IncompatibleDeviceError || (stage === 'service' && error instanceof Error && error.name === 'NotFoundError')) return 'この機器はコントローラ用の通信に対応していません。prompt.mdのBLE対応プログラムを実行してください。'
    if (error instanceof Error && (error.name === 'SecurityError' || error.name === 'NotAllowedError')) return 'Bluetooth接続が許可されませんでした。ブラウザの設定と機器の電源を確認して、もう一度試してください。'
    if (stage === 'write') return 'Bluetoothで操作を送れませんでした。機器の電源を確認して、つなぎ直してください。'
    return 'Bluetoothにつなげませんでした。機器の電源とBLE対応プログラムを確認して、もう一度試してください。'
  }

  private isCurrent(generation: number): boolean { return this.generation === generation }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new SessionCancelledError()
  }

  private update(next: Partial<BluetoothSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...next })
    this.listeners.forEach(listener => listener())
  }
}
