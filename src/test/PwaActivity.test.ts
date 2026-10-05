import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginPwaUpdate, endPwaUpdate, getPwaActivity, PWA_UPDATE_BUSY_MESSAGE, setPwaActivity, subscribePwaActivity } from '../services/pwa/PwaActivity'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { BluetoothController, type BluetoothDevice } from '../services/bluetooth/BluetoothController'
import { initialSimulationSnapshot, SimulationClient } from '../services/simulation/SimulationClient'
import type { SimulationConfig, SimulationInput, SimulationOutput, SimulationSnapshot } from '../services/simulation/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const cleanups: (() => void)[] = []
const owner = () => { const value = {}; cleanups.push(() => setPwaActivity(value, false)); return value }
const register = <T extends { dispose(): void }>(client: T): T => { cleanups.push(() => client.dispose()); return client }
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  endPwaUpdate()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const port = (): SerialPort => ({
  readable: new ReadableStream<Uint8Array>(), writable: new WritableStream<Uint8Array>(),
  open: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
})
const serial = (device: SerialPort): NavigatorSerial => ({
  requestPort: vi.fn(async () => device), getPorts: vi.fn(async () => [device]),
  addEventListener: vi.fn(), removeEventListener: vi.fn(),
})

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<SimulationOutput>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  messages: SimulationInput[] = []
  constructor() { FakeWorker.instances.push(this) }
  postMessage(input: SimulationInput) { this.messages.push(input) }
  terminate() {}
  emit(phase: SimulationSnapshot['phase']) { this.onmessage?.({ data: { type: 'snapshot', snapshot: { ...initialSimulationSnapshot(), phase } } } as MessageEvent<SimulationOutput>) }
}

const simulationConfig: SimulationConfig = { boardId: 'm5nanoc6', ledPin: 2, ledCount: 10, buttonPin: 9 }
function simulation(changed = vi.fn()) {
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('WebAssembly', { Suspending: () => {}, promising: () => {} })
  vi.stubGlobal('document', { baseURI: 'https://example.test/MicroPythonWriter/' })
  vi.stubEnv('BASE_URL', './')
  FakeWorker.instances = []
  return register(new SimulationClient(changed))
}

describe('PWA update activity interlock', () => {
  it('publishes stable snapshots and combines multiple owners without duplicate notifications', () => {
    const changed = vi.fn()
    cleanups.push(subscribePwaActivity(changed))
    const first = owner(), second = owner()
    const idle = getPwaActivity()
    expect(getPwaActivity()).toBe(idle)
    setPwaActivity(first, true)
    const active = getPwaActivity()
    setPwaActivity(first, true)
    setPwaActivity(second, true)
    setPwaActivity(first, false)
    expect(getPwaActivity()).toBe(active)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(beginPwaUpdate()).toBe(false)
    setPwaActivity(second, false)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(beginPwaUpdate()).toBe(true)
  })

  it('atomically reserves an idle update and releases it on cancellation', () => {
    expect(beginPwaUpdate()).toBe(true)
    expect(getPwaActivity()).toEqual({ active: false, updating: true })
    expect(beginPwaUpdate()).toBe(false)
    endPwaUpdate()
    expect(getPwaActivity()).toEqual({ active: false, updating: false })
    expect(beginPwaUpdate()).toBe(true)
  })

  it('blocks updates while the USB picker is pending and permits cancelled selection', async () => {
    const selecting = deferred<SerialPort>()
    const api = serial(port())
    api.requestPort = vi.fn(() => selecting.promise)
    const client = register(new WebSerialTransport(api))
    const connected = client.connect()
    expect(getPwaActivity().active).toBe(true)
    expect(beginPwaUpdate()).toBe(false)
    selecting.reject(new Error('cancel'))
    await expect(connected).rejects.toThrow('cancel')
    expect(beginPwaUpdate()).toBe(true)
  })

  it('tracks reconnect lookup, open, and disconnect completion rather than just UI status', async () => {
    const device = port()
    const authorized = deferred<SerialPort[]>()
    const closing = deferred<void>()
    const api = serial(device)
    api.getPorts = vi.fn(() => authorized.promise)
    device.close = vi.fn(() => closing.promise)
    const client = register(new WebSerialTransport(api))
    const connecting = client.reconnect()
    expect(beginPwaUpdate()).toBe(false)
    authorized.resolve([device])
    await connecting
    expect(beginPwaUpdate()).toBe(false)
    const disconnecting = client.disconnect()
    await Promise.resolve()
    expect(beginPwaUpdate()).toBe(false)
    closing.resolve()
    await disconnecting
    expect(beginPwaUpdate()).toBe(true)
  })

  it('does not hide a failed USB open with a retained port and clears disposal', async () => {
    const device = port()
    device.open = vi.fn(async () => { throw new Error('open failed') })
    const client = register(new WebSerialTransport(serial(device)))
    await expect(client.connect()).rejects.toThrow('open failed')
    expect(beginPwaUpdate()).toBe(false)
    client.dispose()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('does not start USB selection or reconnect while a PWA update is reserved', async () => {
    const api = serial(port())
    const client = register(new WebSerialTransport(api))
    expect(beginPwaUpdate()).toBe(true)
    await expect(client.connect()).rejects.toThrow(PWA_UPDATE_BUSY_MESSAGE)
    await expect(client.reconnect()).rejects.toThrow(PWA_UPDATE_BUSY_MESSAGE)
    expect(api.requestPort).not.toHaveBeenCalled()
    expect(api.getPorts).not.toHaveBeenCalled()
  })

  it('keeps a cancelled BLE picker active until the native promise settles', async () => {
    const selecting = deferred<BluetoothDevice>()
    const client = register(new BluetoothController({ bluetooth: { requestDevice: () => selecting.promise }, secureContext: true, pollMs: 0 }))
    const connecting = client.connect()
    expect(beginPwaUpdate()).toBe(false)
    client.disconnect()
    await connecting
    expect(client.getSnapshot().phase).toBe('disconnected')
    expect(beginPwaUpdate()).toBe(false)
    selecting.reject(new Error('cancel'))
    await Promise.resolve()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('tracks active BLE connections and resets on disposal', async () => {
    const characteristic = { writeValueWithResponse: async () => undefined, startNotifications: async () => characteristic, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const server = { connect: async () => server, disconnect: vi.fn(), getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }
    const device = { name: 'NanoLED-test', gatt: server, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const client = register(new BluetoothController({ bluetooth: { requestDevice: async () => device }, secureContext: true, pollMs: 0 }))
    await client.connect()
    expect(client.getSnapshot().phase).toBe('connected')
    expect(beginPwaUpdate()).toBe(false)
    client.dispose()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('does not open a BLE picker while a PWA update is reserved', async () => {
    const requestDevice = vi.fn(async () => { throw new Error('must not be requested') })
    const client = register(new BluetoothController({ bluetooth: { requestDevice }, secureContext: true, pollMs: 0 }))
    expect(beginPwaUpdate()).toBe(true)
    await client.connect()
    expect(requestDevice).not.toHaveBeenCalled()
    expect(client.getSnapshot().error).toBe(PWA_UPDATE_BUSY_MESSAGE)
  })

  it('tracks simulator loading, running, acknowledged pause, and pending resume', () => {
    const client = simulation()
    client.start('pass', simulationConfig)
    expect(beginPwaUpdate()).toBe(false)
    const worker = FakeWorker.instances[0]
    worker.emit('running')
    client.pause()
    expect(beginPwaUpdate()).toBe(false)
    worker.emit('paused')
    expect(beginPwaUpdate()).toBe(true)
    endPwaUpdate()
    client.resume()
    expect(beginPwaUpdate()).toBe(false)
    worker.emit('paused')
    expect(beginPwaUpdate()).toBe(false)
    worker.emit('running')
    expect(beginPwaUpdate()).toBe(false)
    client.reset()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('does not start or resume a simulator during update and clears disposed activity', () => {
    const changed = vi.fn()
    const client = simulation(changed)
    expect(beginPwaUpdate()).toBe(true)
    client.start('pass', simulationConfig)
    expect(FakeWorker.instances).toHaveLength(0)
    expect(changed.mock.calls.at(-1)?.[0].error).toBe(PWA_UPDATE_BUSY_MESSAGE)
    endPwaUpdate()
    client.start('pass', simulationConfig)
    const worker = FakeWorker.instances[0]
    worker.emit('paused')
    expect(beginPwaUpdate()).toBe(true)
    client.resume()
    expect(worker.messages.some(message => message.type === 'resume')).toBe(false)
    endPwaUpdate()
    client.resume()
    expect(getPwaActivity().active).toBe(true)
    client.dispose()
    expect(beginPwaUpdate()).toBe(true)
  })
})
