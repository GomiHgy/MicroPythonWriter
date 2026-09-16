import { afterEach, describe, expect, it, vi } from 'vitest'
import { BluetoothController, type BluetoothApi, type BluetoothCharacteristic, type BluetoothDevice, type BluetoothServer, type BluetoothService } from '../services/bluetooth/BluetoothController'
import { encodeCommand, LedStatusParser, MAX_LED_COUNT, MAX_STATUS_BYTES, NANO_LED_RX_UUID, NANO_LED_SERVICE_UUID, NANO_LED_TX_UUID, parseLedStatus } from '../services/bluetooth/protocol'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const state = { v: 1, mode: 'PINK', brightness: 50, speed: 20, pixels: '7f0040000000' }
const line = (value: unknown = state) => `${JSON.stringify(value)}\n`

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve() }

class FakeCharacteristic extends EventTarget implements BluetoothCharacteristic {
  value: DataView | null = null
  writes: string[] = []
  activeWrites = 0
  maxActiveWrites = 0
  notificationsStarted = 0
  write: (text: string) => Promise<void> = async () => undefined
  start: () => Promise<void> = async () => undefined

  async writeValueWithResponse(data: BufferSource): Promise<void> {
    const text = decoder.decode(data)
    this.writes.push(text)
    this.activeWrites++
    this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites)
    try { await this.write(text) } finally { this.activeWrites-- }
  }

  async startNotifications(): Promise<BluetoothCharacteristic> {
    this.notificationsStarted++
    await this.start()
    return this
  }

  notify(text: string | Uint8Array): void {
    const bytes = typeof text === 'string' ? encoder.encode(text) : text
    const padded = new Uint8Array(bytes.length + 6)
    padded.set(bytes, 3)
    this.value = new DataView(padded.buffer, 3, bytes.length)
    this.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

class FakeService implements BluetoothService {
  rx = new FakeCharacteristic()
  tx = new FakeCharacteristic()
  requests: string[] = []
  async getCharacteristic(uuid: string): Promise<BluetoothCharacteristic> {
    this.requests.push(uuid)
    if (uuid === NANO_LED_RX_UUID) return this.rx
    if (uuid === NANO_LED_TX_UUID) return this.tx
    throw new DOMException('missing', 'NotFoundError')
  }
}

class FakeServer implements BluetoothServer {
  service = new FakeService()
  connects = 0
  disconnects = 0
  requests: string[] = []
  onConnect: () => Promise<BluetoothServer> = async () => this
  onService: () => Promise<BluetoothService> = async () => this.service
  async connect(): Promise<BluetoothServer> { this.connects++; return this.onConnect() }
  disconnect(): void { this.disconnects++ }
  async getPrimaryService(uuid: string): Promise<BluetoothService> { this.requests.push(uuid); return this.onService() }
}

class FakeDevice extends EventTarget implements BluetoothDevice {
  name = 'NanoLED-01'
  gatt = new FakeServer()
  loseConnection(): void { this.dispatchEvent(new Event('gattserverdisconnected')) }
}

const clients: BluetoothController[] = []
function setup(options: { timeoutMs?: number; pollMs?: number; api?: BluetoothApi } = {}) {
  const device = new FakeDevice()
  const requestDevice = vi.fn(async () => device)
  const client = new BluetoothController({ bluetooth: options.api ?? { requestDevice }, secureContext: true, timeoutMs: options.timeoutMs ?? 100, pollMs: options.pollMs ?? 0 })
  clients.push(client)
  return { client, device, rx: device.gatt.service.rx, tx: device.gatt.service.tx, requestDevice }
}

afterEach(() => {
  clients.splice(0).forEach(client => client.dispose())
  vi.useRealTimers()
})

describe('NanoLED commands', () => {
  it('標準操作・追加の合図を改行付きASCIIで符号化する', () => {
    for (const command of ['OFF', 'PINK', 'BLUE', 'MAGIC', 'RAINBOW', 'STATUS', 'BRIGHTNESS 0', 'BRIGHTNESS 100', 'SPEED 100', 'MAGIC_2']) {
      const bytes = encodeCommand(command)
      expect(decoder.decode(bytes)).toBe(`${command}\n`)
      expect(bytes.length).toBeLessThanOrEqual(20)
    }
    expect(decoder.decode(encodeCommand(' pink '))).toBe('PINK\n')
    expect(decoder.decode(encodeCommand('BRIGHTNESS 050'))).toBe('BRIGHTNESS 50\n')
  })

  it.each(['', '0BLUE', 'A'.repeat(17), 'PINK\nOFF', 'SPEED -1', 'SPEED 101', 'BRIGHTNESS 0.5', 'BRIGHTNESS NaN', 'SPEED', 'BRIGHTNESS', 'BRIGHTNESS 1000', 'LED ON', 'ピンク'])('不正な送信を拒否する: %s', command => {
    expect(() => encodeCommand(command)).toThrow()
  })
})

describe('NanoLED telemetry', () => {
  it('実RGBを小文字に正規化し、状態を不変として返す', () => {
    const parsed = parseLedStatus(JSON.stringify({ ...state, pixels: '7F0040' }))
    expect(parsed).toEqual({ ...state, pixels: '7f0040' })
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it.each([
    {}, null, [], { ...state, v: 2 }, { ...state, v: '1' }, { ...state, mode: 'pink' }, { ...state, mode: 'OFF\nON' },
    { ...state, brightness: -1 }, { ...state, brightness: 101 }, { ...state, brightness: 1.5 }, { ...state, brightness: '50' },
    { ...state, speed: false }, { ...state, speed: null }, { ...state, speed: 101 }, { ...state, pixels: '' },
    { ...state, pixels: 'fff' }, { ...state, pixels: 'gg0000' }, { ...state, pixels: 'ff0000\n' }, { ...state, pixels: 'ffffff'.repeat(MAX_LED_COUNT + 1) },
  ])('不正な状態を採用しない: %j', value => {
    expect(parseLedStatus(JSON.stringify(value))).toBeNull()
  })

  it('LED個数の上下限と0/100の設定値を受け入れる', () => {
    expect(parseLedStatus(JSON.stringify({ ...state, pixels: '000000', brightness: 0, speed: 100 }))).not.toBeNull()
    expect(parseLedStatus(JSON.stringify({ ...state, pixels: 'ff00aa'.repeat(MAX_LED_COUNT), brightness: 100, speed: 0 }))).not.toBeNull()
  })

  it('1バイト単位の断片でも改行が届くまで反映しない', () => {
    const parser = new LedStatusParser()
    const bytes = encoder.encode(line())
    for (const byte of bytes.slice(0, -1)) expect(parser.push(new Uint8Array([byte]))).toEqual({ statuses: [], rejected: 0 })
    expect(parser.push(bytes.slice(-1))).toEqual({ statuses: [state], rejected: 0 })
  })

  it('複数フレームの一括受信、破損行、CRLFから回復する', () => {
    const parser = new LedStatusParser()
    expect(parser.push(encoder.encode(`${line()}broken\n${JSON.stringify({ ...state, mode: 'BLUE' })}\r\n`))).toEqual({ statuses: [state, { ...state, mode: 'BLUE' }], rejected: 1 })
  })

  it('不正なUTF-8と未知バージョンは捨て、次の正常な状態へ回復する', () => {
    const parser = new LedStatusParser()
    expect(parser.push(new Uint8Array([0xff, 10]))).toEqual({ statuses: [], rejected: 1 })
    expect(parser.push(encoder.encode(line({ ...state, v: 3 }) + line()))).toEqual({ statuses: [state], rejected: 1 })
  })

  it('上限超えは次の改行まで捨て、末尾を新しいJSONとして誤読しない', () => {
    const parser = new LedStatusParser()
    expect(parser.push(new Uint8Array(MAX_STATUS_BYTES + 1).fill(65))).toEqual({ statuses: [], rejected: 1 })
    expect(parser.push(encoder.encode(line()))).toEqual({ statuses: [], rejected: 0 })
    expect(parser.push(encoder.encode(line()))).toEqual({ statuses: [state], rejected: 0 })
  })

  it('切断時に未完フレームを破棄する', () => {
    const parser = new LedStatusParser()
    parser.push(encoder.encode('{"v":'))
    parser.reset()
    expect(parser.push(encoder.encode(line()))).toEqual({ statuses: [state], rejected: 0 })
  })
})

describe('Web Bluetooth controller', () => {
  it('API非対応と安全でないページを区別する', () => {
    const unsupported = new BluetoothController({ secureContext: true })
    expect(unsupported.getSnapshot()).toMatchObject({ phase: 'unsupported', error: expect.stringContaining('ブラウザ') })
    const insecure = new BluetoothController({ bluetooth: { requestDevice: vi.fn() }, secureContext: false })
    expect(insecure.getSnapshot()).toMatchObject({ phase: 'unsupported', error: expect.stringContaining('HTTPS') })
  })

  it('ユーザー操作まで接続せず、名前で選択しNUSを許可する', async () => {
    const { client, device, rx, tx, requestDevice } = setup()
    expect(requestDevice).not.toHaveBeenCalled()
    await client.connect()
    expect(requestDevice).toHaveBeenCalledExactlyOnceWith({ filters: [{ namePrefix: 'NanoLED-' }], optionalServices: [NANO_LED_SERVICE_UUID] })
    expect(device.gatt.requests).toEqual([NANO_LED_SERVICE_UUID])
    expect(device.gatt.service.requests).toEqual([NANO_LED_RX_UUID, NANO_LED_TX_UUID])
    expect(tx.notificationsStarted).toBe(1)
    expect(rx.writes).toEqual(['STATUS\n'])
    expect(client.getSnapshot()).toMatchObject({ phase: 'connected', deviceName: 'NanoLED-01', status: null, receivedAt: null, sending: false })
  })

  it('購読と安定したsnapshotを提供し、購読解除できる', async () => {
    const { client } = setup()
    const before = client.getSnapshot()
    expect(client.getSnapshot()).toBe(before)
    expect(Object.isFrozen(before)).toBe(true)
    const listener = vi.fn()
    const unsubscribe = client.subscribe(listener)
    await client.connect()
    expect(listener).toHaveBeenCalled()
    expect(client.getSnapshot()).not.toBe(before)
    unsubscribe()
    listener.mockClear()
    client.disconnect()
    expect(listener).not.toHaveBeenCalled()
  })

  it('DataViewのoffsetと通知断片を尊重し、送信だけでは状態を変更しない', async () => {
    const { client, tx } = setup()
    await client.connect()
    const text = line()
    tx.notify(text.slice(0, 20))
    expect(client.getSnapshot().status).toBeNull()
    tx.notify(text.slice(20))
    const snapshot = client.getSnapshot()
    expect(snapshot.status).toEqual(state)
    expect(snapshot.receivedAt).toEqual(expect.any(Number))
    expect(await client.send('OFF')).toBe(true)
    expect(client.getSnapshot().status).toBe(snapshot.status)
    expect(client.getSnapshot().receivedAt).toBe(snapshot.receivedAt)
  })

  it('不正な状態は警告し、正常な通知で警告を解除する', async () => {
    const { client, tx } = setup()
    await client.connect()
    tx.notify(line())
    const previous = client.getSnapshot().status
    tx.notify(line({ ...state, v: 2 }))
    expect(client.getSnapshot().error).toContain('読み取れません')
    expect(client.getSnapshot().status).toBe(previous)
    tx.notify(line({ ...state, mode: 'BLUE' }))
    expect(client.getSnapshot().error).toBeNull()
    expect(client.getSnapshot().status?.mode).toBe('BLUE')
  })

  it('未接続の操作と不正な合図は送信しない', async () => {
    const { client, rx } = setup()
    expect(await client.send('PINK')).toBe(false)
    expect(client.getSnapshot().error).toContain('先に')
    expect(rx.writes).toEqual([])
    await client.connect()
    expect(await client.send('PINK\nOFF')).toBe(false)
    expect(rx.writes).toEqual(['STATUS\n'])
  })

  it('機器選択キャンセルはエラーにせず再接続できる', async () => {
    const fake = new FakeDevice()
    const requestDevice = vi.fn<() => Promise<BluetoothDevice>>().mockRejectedValueOnce(new DOMException('cancelled', 'NotFoundError')).mockResolvedValue(fake)
    const { client } = setup({ api: { requestDevice } })
    await client.connect()
    expect(client.getSnapshot()).toMatchObject({ phase: 'disconnected', error: null })
    await client.connect()
    expect(client.getSnapshot().phase).toBe('connected')
  })

  it('権限拒否と通信仕様の不一致を区別して表示する', async () => {
    const { client } = setup({ api: { requestDevice: async () => { throw new DOMException('denied', 'NotAllowedError') } } })
    await client.connect()
    expect(client.getSnapshot().error).toContain('許可されません')
    const incompatible = setup()
    incompatible.device.gatt.onService = async () => { throw new DOMException('missing', 'NotFoundError') }
    await incompatible.client.connect()
    expect(incompatible.client.getSnapshot()).toMatchObject({ phase: 'disconnected', error: expect.stringContaining('対応していません') })
  })

  it('接続連打でも選択画面を重複しない', async () => {
    const selection = deferred<BluetoothDevice>()
    const requestDevice = vi.fn(() => selection.promise)
    const { client } = setup({ api: { requestDevice } })
    const first = client.connect()
    await client.connect()
    expect(requestDevice).toHaveBeenCalledTimes(1)
    selection.resolve(new FakeDevice())
    await first
    expect(client.getSnapshot().phase).toBe('connected')
  })

  it('機器選択中のキャンセル後に返った機器へ接続しない', async () => {
    const selection = deferred<BluetoothDevice>()
    const { client } = setup({ api: { requestDevice: () => selection.promise } })
    const connecting = client.connect()
    client.disconnect()
    await connecting
    const lateDevice = new FakeDevice()
    selection.resolve(lateDevice)
    await flush()
    expect(lateDevice.gatt.connects).toBe(0)
    expect(client.getSnapshot().phase).toBe('disconnected')
  })

  it('接続をキャンセルしても後から成立したGATT接続を残さない', async () => {
    const { client, device } = setup()
    const pending = deferred<BluetoothServer>()
    device.gatt.onConnect = () => pending.promise
    const connecting = client.connect()
    await flush()
    client.disconnect()
    await connecting
    pending.resolve(device.gatt)
    await flush()
    expect(device.gatt.disconnects).toBe(2)
    expect(device.gatt.requests).toEqual([])
    expect(client.getSnapshot().phase).toBe('disconnected')
  })

  it('同じ機器へ再接続中に古いGATT接続が完了しても新しい接続を切らない', async () => {
    const { client, device } = setup()
    const pending = deferred<BluetoothServer>()
    device.gatt.onConnect = () => pending.promise
    const first = client.connect()
    await flush()
    client.disconnect()
    await first
    device.gatt.onConnect = async () => device.gatt
    await client.connect()
    pending.resolve(device.gatt)
    await flush()
    expect(device.gatt.disconnects).toBe(1)
    expect(client.getSnapshot().phase).toBe('connected')
  })

  it('途中のサービス探索をキャンセル後、古いハンドルを採用しない', async () => {
    const { client, device } = setup()
    const oldService = new FakeService()
    const discovering = deferred<BluetoothService>()
    device.gatt.onService = () => discovering.promise
    const first = client.connect()
    await flush()
    client.disconnect()
    await first
    const newService = new FakeService()
    device.gatt.onService = async () => newService
    await client.connect()
    discovering.resolve(oldService)
    await flush()
    expect(oldService.requests).toEqual([])
    expect(await client.send('PINK')).toBe(true)
    expect(newService.rx.writes).toEqual(['STATUS\n', 'PINK\n'])
  })

  it('切断イベントで操作待ち・表示状態を消し、旧通知を無視する', async () => {
    const { client, device, rx, tx } = setup()
    await client.connect()
    tx.notify(line())
    const blocked = deferred<void>()
    rx.write = () => blocked.promise
    const first = client.send('BLUE')
    const second = client.send('MAGIC')
    device.loseConnection()
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(client.getSnapshot()).toMatchObject({ phase: 'disconnected', status: null, receivedAt: null, sending: false, error: expect.stringContaining('接続が切れました') })
    const disconnected = client.getSnapshot()
    tx.notify(line())
    expect(client.getSnapshot()).toBe(disconnected)
    blocked.resolve(undefined)
    await flush()
    expect(rx.writes).toEqual(['STATUS\n', 'BLUE\n'])
  })

  it('再接続はサービスとCharacteristicを取得し直し、旧通知を採用しない', async () => {
    const { client, device, tx } = setup()
    await client.connect()
    tx.notify('{"v":')
    device.loseConnection()
    const fresh = new FakeService()
    device.gatt.service = fresh
    await client.connect()
    tx.notify(line())
    expect(client.getSnapshot().status).toBeNull()
    fresh.tx.notify(line())
    expect(client.getSnapshot().status).toEqual(state)
    expect(device.gatt.requests).toHaveLength(2)
    expect(fresh.requests).toEqual([NANO_LED_RX_UUID, NANO_LED_TX_UUID])
  })

  it('GATT書込みを直列化し、未送信スライダーは最新値だけ送る', async () => {
    const { client, rx } = setup()
    await client.connect()
    const blocked = deferred<void>()
    rx.write = text => text === 'PINK\n' ? blocked.promise : Promise.resolve()
    const pink = client.send('PINK')
    const oldBrightness = client.send('BRIGHTNESS 10')
    const brightness = client.send('BRIGHTNESS 80')
    const oldSpeed = client.send('SPEED 25')
    const speed = client.send('SPEED 90')
    expect(await oldBrightness).toBe(false)
    expect(await oldSpeed).toBe(false)
    expect(rx.writes).toEqual(['STATUS\n', 'PINK\n'])
    expect(client.getSnapshot().sending).toBe(true)
    blocked.resolve(undefined)
    expect(await Promise.all([pink, brightness, speed])).toEqual([true, true, true])
    expect(rx.writes).toEqual(['STATUS\n', 'PINK\n', 'BRIGHTNESS 80\n', 'SPEED 90\n'])
    expect(rx.maxActiveWrites).toBe(1)
    expect(client.getSnapshot().sending).toBe(false)
  })

  it('OFFは未送信の点灯操作を破棄し、実行中の1件の直後に送る', async () => {
    const { client, rx } = setup()
    await client.connect()
    const blocked = deferred<void>()
    rx.write = text => text === 'PINK\n' ? blocked.promise : Promise.resolve()
    const pending = client.send('PINK')
    const blue = client.send('BLUE')
    const brightness = client.send('BRIGHTNESS 100')
    const off = client.send('OFF')
    expect(await blue).toBe(false)
    expect(await brightness).toBe(false)
    blocked.resolve(undefined)
    expect(await Promise.all([pending, off])).toEqual([true, true])
    expect(rx.writes).toEqual(['STATUS\n', 'PINK\n', 'OFF\n'])
  })

  it('送信キューを有界にして連打から回復できる', async () => {
    const { client, rx } = setup()
    await client.connect()
    const blocked = deferred<void>()
    rx.write = () => blocked.promise
    const initial = client.send('PINK')
    const pending = Array.from({ length: 24 }, () => client.send('BLUE'))
    expect(await client.send('MAGIC')).toBe(false)
    expect(client.getSnapshot().error).toContain('混み合っています')
    const off = client.send('OFF')
    expect(await Promise.all(pending)).toEqual(Array(24).fill(false))
    client.disconnect()
    expect(await Promise.all([initial, off])).toEqual([false, false])
    blocked.resolve(undefined)
  })

  it('書込み失敗で切断し、残りを送らず再接続できる状態にする', async () => {
    const { client, rx } = setup()
    await client.connect()
    rx.write = async () => { throw new Error('GATT failed') }
    const first = client.send('BLUE')
    const second = client.send('PINK')
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(client.getSnapshot()).toMatchObject({ phase: 'disconnected', sending: false, error: expect.stringContaining('送れません') })
    expect(rx.writes).toEqual(['STATUS\n', 'BLUE\n'])
  })

  it('GATT接続のタイムアウト後に再接続用の状態へ戻す', async () => {
    vi.useFakeTimers()
    const { client, device } = setup({ timeoutMs: 100 })
    device.gatt.onConnect = () => new Promise(() => undefined)
    const connecting = client.connect()
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    await connecting
    expect(client.getSnapshot()).toMatchObject({ phase: 'disconnected', error: expect.stringContaining('応答がありません') })
  })

  it('GATT書込みのタイムアウトで後続を中止しsendingを解除する', async () => {
    vi.useFakeTimers()
    const { client, rx } = setup({ timeoutMs: 100 })
    await client.connect()
    rx.write = () => new Promise(() => undefined)
    const first = client.send('PINK')
    const second = client.send('BLUE')
    await vi.advanceTimersByTimeAsync(100)
    expect(await Promise.all([first, second])).toEqual([false, false])
    expect(client.getSnapshot()).toMatchObject({ phase: 'disconnected', sending: false, error: expect.stringContaining('応答がありません') })
    expect(rx.writes).toEqual(['STATUS\n', 'PINK\n'])
  })

  it('機器選択は人の操作を待ち、GATTの短いタイムアウトを適用しない', async () => {
    vi.useFakeTimers()
    const selection = deferred<BluetoothDevice>()
    const { client } = setup({ api: { requestDevice: () => selection.promise }, timeoutMs: 100 })
    const connecting = client.connect()
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.getSnapshot().phase).toBe('connecting')
    client.disconnect()
    await connecting
  })

  it('状態が届かない時だけ定期STATUS要求し、切断で停止する', async () => {
    vi.useFakeTimers()
    const { client, rx, tx } = setup({ pollMs: 2000 })
    await client.connect()
    await vi.advanceTimersByTimeAsync(1900)
    tx.notify(line())
    await vi.advanceTimersByTimeAsync(100)
    expect(rx.writes).toEqual(['STATUS\n'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(rx.writes).toEqual(['STATUS\n', 'STATUS\n'])
    client.disconnect()
    await vi.advanceTimersByTimeAsync(10000)
    expect(rx.writes).toEqual(['STATUS\n', 'STATUS\n'])
    expect(vi.getTimerCount()).toBe(0)
  })
})
