import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebUsbCdcTransport, WebUsbCdcUnsupportedError, type NavigatorUsb, type WebUsbAlternate, type WebUsbConfiguration, type WebUsbDevice, type WebUsbInResult, type WebUsbOutResult } from '../services/serial/WebUsbCdcTransport'
import { DeviceTimeoutError, SerialDisconnectedError, SerialPermissionError } from '../types'
import { beginPwaUpdate, endPwaUpdate, getPwaActivity, PWA_UPDATE_BUSY_MESSAGE } from '../services/pwa/PwaActivity'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function flush() { for (let step = 0; step < 8; step++) await Promise.resolve() }

function configuration(): WebUsbConfiguration {
  const control: WebUsbAlternate = { alternateSetting: 2, interfaceClass: 0x02, interfaceSubclass: 0x02, endpoints: [{ endpointNumber: 3, direction: 'in', type: 'interrupt', packetSize: 8 }] }
  const empty: WebUsbAlternate = { alternateSetting: 0, interfaceClass: 0x0a, interfaceSubclass: 0, endpoints: [] }
  const data: WebUsbAlternate = { alternateSetting: 5, interfaceClass: 0x0a, interfaceSubclass: 0, endpoints: [
    { endpointNumber: 9, direction: 'in', type: 'bulk', packetSize: 64 },
    { endpointNumber: 8, direction: 'out', type: 'bulk', packetSize: 64 },
  ] }
  const jtag: WebUsbAlternate = { alternateSetting: 0, interfaceClass: 0xff, interfaceSubclass: 0, endpoints: [
    { endpointNumber: 6, direction: 'in', type: 'bulk', packetSize: 64 },
    { endpointNumber: 6, direction: 'out', type: 'bulk', packetSize: 64 },
  ] }
  return { configurationValue: 3, interfaces: [
    { interfaceNumber: 11, alternates: [jtag], alternate: jtag },
    { interfaceNumber: 4, alternates: [control], alternate: control },
    { interfaceNumber: 7, alternates: [empty, data], alternate: empty },
  ] }
}

function device(serialNumber: string | undefined = 'native-test') {
  const config = configuration()
  const reads: ReturnType<typeof deferred<WebUsbInResult>>[] = []
  const value: WebUsbDevice = {
    vendorId: 0x303a, productId: 0x1001, serialNumber, opened: false,
    configuration: null, configurations: [config],
    open: vi.fn(async () => { value.opened = true }),
    close: vi.fn(async () => { value.opened = false; reads.splice(0).forEach(read => read.reject(new DOMException('closed', 'AbortError'))) }),
    selectConfiguration: vi.fn(async number => { value.configuration = value.configurations.find(candidate => candidate.configurationValue === number)! }),
    claimInterface: vi.fn(async () => undefined),
    selectAlternateInterface: vi.fn(async () => undefined),
    controlTransferOut: vi.fn<WebUsbDevice['controlTransferOut']>(async (_setup, data) => ({ status: 'ok', bytesWritten: data?.byteLength ?? 0 })),
    transferIn: vi.fn(() => { const read = deferred<WebUsbInResult>(); reads.push(read); return read.promise }),
    transferOut: vi.fn<WebUsbDevice['transferOut']>(async (_endpoint, data) => ({ status: 'ok', bytesWritten: data.byteLength })),
  }
  return { value, reads, config }
}

function api(value: WebUsbDevice) {
  const listeners = new Set<(event: Event & { device: WebUsbDevice }) => void>()
  const usb: NavigatorUsb = {
    requestDevice: vi.fn(async () => value), getDevices: vi.fn(async () => [value]),
    addEventListener: vi.fn((_type, listener) => { listeners.add(listener) }),
    removeEventListener: vi.fn((_type, listener) => { listeners.delete(listener) }),
  }
  const emitDisconnect = (disconnected: WebUsbDevice = value) => listeners.forEach(listener => listener({ device: disconnected } as Event & { device: WebUsbDevice }))
  return { usb, emitDisconnect, listeners }
}
const clients: WebUsbCdcTransport[] = []
function transport(usb?: NavigatorUsb) { const value = new WebUsbCdcTransport(usb); clients.push(value); return value }
afterEach(async () => {
  await Promise.all(clients.splice(0).map(async client => { await client.disconnect(); client.dispose() }))
  await flush()
  endPwaUpdate()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('WebUSB CDC native transport', () => {
  it('reports unsupported without an API and exposes the selected transport kind', async () => {
    vi.stubGlobal('navigator', {})
    const client = transport()
    expect(client.supported).toBe(false)
    expect(client.connected).toBe(false)
    expect(client.kind).toBe('webusb-cdc')
    await expect(client.connect()).rejects.toThrow()
    expect(getPwaActivity().active).toBe(false)
  })

  it('uses navigator.usb when no injected API is supplied', async () => {
    const fixture = device(), usb = api(fixture.value).usb
    vi.stubGlobal('navigator', { usb })
    const client = transport()
    expect(client.supported).toBe(true)
    await client.connect()
    expect(client.connected).toBe(true)
  })

  it('opens the real CDC interfaces and bulk endpoints, ignoring vendor-specific JTAG', async () => {
    const fixture = device(), usb = api(fixture.value).usb, client = transport(usb)
    const connecting = client.connect(230400)
    expect(usb.requestDevice).toHaveBeenCalledWith({ filters: [{ vendorId: 0x303a }] })
    await connecting
    expect(fixture.value.selectConfiguration).toHaveBeenCalledWith(3)
    expect(fixture.value.claimInterface).toHaveBeenNthCalledWith(1, 4)
    expect(fixture.value.claimInterface).toHaveBeenNthCalledWith(2, 7)
    expect(fixture.value.selectAlternateInterface).toHaveBeenCalledWith(7, 5)
    expect(fixture.value.transferIn).toHaveBeenCalledWith(9, 64)
    await client.write(new Uint8Array([3, 3, 1]))
    expect(fixture.value.transferOut).toHaveBeenCalledWith(8, new Uint8Array([3, 3, 1]))
    const [setup, coding] = vi.mocked(fixture.value.controlTransferOut).mock.calls[0]
    expect(setup).toEqual({ requestType: 'class', recipient: 'interface', request: 0x20, value: 0, index: 4 })
    expect(coding).toHaveLength(7)
    expect(new DataView(coding!.buffer).getUint32(0, true)).toBe(230400)
    expect(Array.from(coding!.slice(4))).toEqual([0, 0, 8])
    expect(vi.mocked(fixture.value.controlTransferOut).mock.calls.filter(([request]) => request.request === 0x22).every(([request]) => (request.value & 2) === 0)).toBe(true)
  })

  it('does not reselect an already active configuration or active data alternate', async () => {
    const fixture = device()
    fixture.value.configuration = fixture.config
    fixture.config.interfaces[2].alternate = fixture.config.interfaces[2].alternates[1]
    const client = transport(api(fixture.value).usb)
    await client.connect()
    expect(fixture.value.selectConfiguration).not.toHaveBeenCalled()
    expect(fixture.value.selectAlternateInterface).not.toHaveBeenCalled()
  })

  it.each([{ productId: 0x1001, lineValue: 0 }, { productId: 0x8000, lineValue: 1 }])('sets safe normal-mode line state for product $productId', async ({ productId, lineValue }) => {
    const fixture = device(); fixture.value.productId = productId
    const client = transport(api(fixture.value).usb)
    await client.connect()
    expect(fixture.value.controlTransferOut).toHaveBeenCalledWith({ requestType: 'class', recipient: 'interface', request: 0x22, value: lineValue, index: 4 })
    expect(vi.mocked(fixture.value.controlTransferOut).mock.calls.every(([setup]) => setup.request === 0x20 || setup.request === 0x22)).toBe(true)
  })

  it('keeps the initial chooser failure as a permission error, not a lost connection', async () => {
    const fixture = device(), usb = api(fixture.value).usb, client = transport(usb), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    vi.mocked(usb.requestDevice).mockRejectedValue(new DOMException('cancelled', 'NotFoundError'))
    await expect(client.connect()).rejects.toBeInstanceOf(SerialPermissionError)
    expect(disconnected).not.toHaveBeenCalled()
    expect(client.connected).toBe(false)
    expect(fixture.value.open).not.toHaveBeenCalled()
    expect(getPwaActivity().active).toBe(false)
  })

  it('rejects a non-Espressif device before opening it', async () => {
    const fixture = device(); fixture.value.vendorId = 0x10c4
    const client = transport(api(fixture.value).usb)
    await expect(client.connect()).rejects.toBeInstanceOf(WebUsbCdcUnsupportedError)
    expect(fixture.value.open).not.toHaveBeenCalled()
    expect(fixture.value.controlTransferOut).not.toHaveBeenCalled()
  })

  it('rejects a vendor-specific bulk interface without CDC and never mistakes JTAG for a serial port', async () => {
    const fixture = device(); fixture.config.interfaces = fixture.config.interfaces.slice(0, 1)
    const client = transport(api(fixture.value).usb)
    await expect(client.connect()).rejects.toBeInstanceOf(WebUsbCdcUnsupportedError)
    expect(fixture.value.open).not.toHaveBeenCalled()
    expect(fixture.value.claimInterface).not.toHaveBeenCalled()
  })

  it.each(['control', 'data'] as const)('rejects ambiguous multiple CDC %s interfaces', async duplicate => {
    const fixture = device()
    const source = fixture.config.interfaces[duplicate === 'control' ? 1 : 2]
    fixture.config.interfaces = [...fixture.config.interfaces, { ...source, interfaceNumber: 12 }]
    const client = transport(api(fixture.value).usb)
    await expect(client.connect()).rejects.toThrow('複数')
    expect(fixture.value.open).not.toHaveBeenCalled()
  })

  it.each(['missing-in', 'missing-out', 'duplicate-in', 'bad-endpoint', 'bad-packet'] as const)('rejects unsupported endpoint layout: %s', async issue => {
    const fixture = device(), alternate = fixture.config.interfaces[2].alternates[1]
    if (issue === 'missing-in') alternate.endpoints = alternate.endpoints.filter(endpoint => endpoint.direction !== 'in')
    if (issue === 'missing-out') alternate.endpoints = alternate.endpoints.filter(endpoint => endpoint.direction !== 'out')
    if (issue === 'duplicate-in') alternate.endpoints = [...alternate.endpoints, { ...alternate.endpoints[0], endpointNumber: 10 }]
    if (issue === 'bad-endpoint') alternate.endpoints[0].endpointNumber = 0
    if (issue === 'bad-packet') alternate.endpoints[0].packetSize = 0
    const client = transport(api(fixture.value).usb)
    await expect(client.connect()).rejects.toBeInstanceOf(WebUsbCdcUnsupportedError)
  })

  it('rejects ambiguous usable data alternates when neither is active', async () => {
    const fixture = device(), iface = fixture.config.interfaces[2]
    iface.alternates = [...iface.alternates, { ...iface.alternates[1], alternateSetting: 6 }]
    const client = transport(api(fixture.value).usb)
    await expect(client.connect()).rejects.toThrow('複数')
    expect(fixture.value.open).not.toHaveBeenCalled()
  })

  it('rejects multiple compatible configurations unless one is already active', async () => {
    const fixture = device(), other = { ...configuration(), configurationValue: 8 }
    fixture.value.configurations = [fixture.config, other]
    const client = transport(api(fixture.value).usb)
    await expect(client.connect()).rejects.toThrow('複数')
    fixture.value.configuration = other
    await client.connect()
    expect(client.connected).toBe(true)
    expect(fixture.value.selectConfiguration).not.toHaveBeenCalled()
  })

  it.each(['open', 'claim', 'coding', 'line'] as const)('cleans up an initial %s failure without reporting a connected-device disconnect', async stage => {
    const fixture = device(), client = transport(api(fixture.value).usb), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    if (stage === 'open') vi.mocked(fixture.value.open).mockRejectedValue(new DOMException('device busy', 'NetworkError'))
    if (stage === 'claim') vi.mocked(fixture.value.claimInterface).mockRejectedValue(new DOMException('device busy', 'NetworkError'))
    if (stage === 'coding') vi.mocked(fixture.value.controlTransferOut).mockResolvedValueOnce({ status: 'stall', bytesWritten: 0 })
    if (stage === 'line') vi.mocked(fixture.value.controlTransferOut).mockResolvedValueOnce({ status: 'ok', bytesWritten: 7 }).mockResolvedValueOnce({ status: 'stall', bytesWritten: 0 })
    await expect(client.connect()).rejects.toThrow()
    expect(fixture.value.close).toHaveBeenCalled()
    expect(client.connected).toBe(false)
    expect(disconnected).not.toHaveBeenCalled()
    expect(getPwaActivity().active).toBe(false)
  })

  it('rejects incomplete line coding instead of claiming the USB connection succeeded', async () => {
    const fixture = device(), client = transport(api(fixture.value).usb)
    vi.mocked(fixture.value.controlTransferOut).mockResolvedValueOnce({ status: 'ok', bytesWritten: 6 })
    await expect(client.connect()).rejects.toThrow('通信速度')
    expect(client.connected).toBe(false)
    expect(fixture.value.transferIn).not.toHaveBeenCalled()
    expect(getPwaActivity().active).toBe(false)
  })

  it('does not report an unplug during initial interface setup as a formerly connected session', async () => {
    const fixture = device(), source = api(fixture.value), client = transport(source.usb), claim = deferred<void>(), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    vi.mocked(fixture.value.claimInterface).mockImplementationOnce(() => claim.promise)
    const connecting = client.connect(), rejected = expect(connecting).rejects.toBeInstanceOf(SerialDisconnectedError)
    await flush()
    source.emitDisconnect()
    claim.resolve()
    await rejected
    expect(disconnected).not.toHaveBeenCalled()
    expect(fixture.value.controlTransferOut).not.toHaveBeenCalled()
    expect(getPwaActivity().active).toBe(false)
  })

  it('buffers received chunks byte-wise and respects DataView offsets', async () => {
    const fixture = device(), client = transport(api(fixture.value).usb), receive = vi.fn()
    const remove = client.onData(receive)
    await client.connect()
    const bytes = new Uint8Array([99, 79, 75, 0, 88])
    fixture.reads[0].resolve({ status: 'ok', data: new DataView(bytes.buffer, 1, 3) })
    await expect(client.waitFor(new Uint8Array([79, 75, 0]), 100)).resolves.toEqual(new Uint8Array([79, 75, 0]))
    expect(receive).toHaveBeenCalledWith(new Uint8Array([79, 75, 0]))
    remove()
    expect(fixture.value.transferIn).toHaveBeenCalledTimes(2)
  })

  it('ignores zero-length packets without treating them as a disconnect', async () => {
    vi.useFakeTimers()
    const fixture = device(), client = transport(api(fixture.value).usb), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    await client.connect()
    fixture.reads[0].resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) })
    await flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.connected).toBe(true)
    expect(disconnected).not.toHaveBeenCalled()
    expect(fixture.value.transferIn).toHaveBeenCalledTimes(2)
  })

  it('serializes writes and continues after positive partial transfers', async () => {
    const fixture = device(), client = transport(api(fixture.value).usb), first = deferred<WebUsbOutResult>()
    await client.connect()
    vi.mocked(fixture.value.transferOut).mockImplementationOnce(() => first.promise)
    const writing = client.write(new Uint8Array([1, 2, 3, 4]))
    const next = client.write(new Uint8Array([5]))
    await flush()
    expect(fixture.value.transferOut).toHaveBeenCalledTimes(1)
    first.resolve({ status: 'ok', bytesWritten: 2 })
    await Promise.all([writing, next])
    expect(vi.mocked(fixture.value.transferOut).mock.calls.map(([, bytes]) => Array.from(bytes))).toEqual([[1, 2, 3, 4], [3, 4], [5]])
  })

  it('invalidates old queued writes and receives after reconnect without corrupting the new session', async () => {
    const fixture = device(), source = api(fixture.value), client = transport(source.usb), firstWrite = deferred<WebUsbOutResult>()
    await client.connect()
    const oldRead = fixture.reads[0]
    vi.mocked(fixture.value.transferOut).mockImplementationOnce(() => firstWrite.promise)
    const oldWriting = client.write(new Uint8Array([10])), queued = client.write(new Uint8Array([11]))
    const oldFailure = expect(oldWriting).rejects.toBeInstanceOf(SerialDisconnectedError), queuedFailure = expect(queued).rejects.toBeInstanceOf(SerialDisconnectedError)
    await flush()
    await client.disconnect()
    const again = device()
    vi.mocked(source.usb.getDevices).mockResolvedValue([again.value])
    await client.reconnect()
    firstWrite.resolve({ status: 'ok', bytesWritten: 1 })
    oldRead.resolve({ status: 'ok', data: new DataView(new Uint8Array([99]).buffer) })
    await Promise.all([oldFailure, queuedFailure])
    await client.write(new Uint8Array([12]))
    expect(fixture.value.transferOut).toHaveBeenCalledTimes(1)
    expect(again.value.transferOut).toHaveBeenCalledTimes(1)
    expect(again.value.transferOut).toHaveBeenCalledWith(8, new Uint8Array([12]))
    expect(client.queue.length).toBe(0)
    expect(client.connected).toBe(true)
  })

  it('limits large outgoing transfers without changing their byte order', async () => {
    const fixture = device(), client = transport(api(fixture.value).usb)
    await client.connect()
    const bytes = new Uint8Array(40000).map((_, index) => index % 251)
    await client.write(bytes)
    const sent = vi.mocked(fixture.value.transferOut).mock.calls.flatMap(([, chunk]) => Array.from(chunk))
    expect(sent).toEqual(Array.from(bytes))
    expect(vi.mocked(fixture.value.transferOut).mock.calls.every(([, chunk]) => chunk.length <= 16 * 1024)).toBe(true)
  })

  it.each([{ status: 'stall', bytesWritten: 0 }, { status: 'ok', bytesWritten: 0 }, { status: 'ok', bytesWritten: 4 }, { status: 'ok', bytesWritten: 0.5 }] as WebUsbOutResult[])('closes and signals disconnect on an invalid outgoing result %o', async result => {
    const fixture = device(), client = transport(api(fixture.value).usb), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    await client.connect()
    vi.mocked(fixture.value.transferOut).mockResolvedValueOnce(result)
    await expect(client.write(new Uint8Array([1, 2]))).rejects.toBeInstanceOf(SerialDisconnectedError)
    expect(client.connected).toBe(false)
    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(fixture.value.close).toHaveBeenCalled()
  })

  it.each(['stall', 'babble', 'missing-data', 'reject'] as const)('closes and releases Raw REPL queue waiters on an incoming %s failure', async issue => {
    const fixture = device(), client = transport(api(fixture.value).usb), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    await client.connect()
    const waiting = client.waitFor(new Uint8Array([79, 75]), Infinity)
    const rejected = expect(waiting).rejects.toBeInstanceOf(SerialDisconnectedError)
    if (issue === 'reject') fixture.reads[0].reject(new DOMException('gone', 'NetworkError'))
    else fixture.reads[0].resolve({ status: issue === 'missing-data' ? 'ok' : issue })
    await rejected
    expect(client.connected).toBe(false)
    expect(disconnected).toHaveBeenCalledTimes(1)
  })

  it('detects only the active device being unplugged and makes queued commands fail', async () => {
    const fixture = device(), source = api(fixture.value), client = transport(source.usb), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    await client.connect()
    source.emitDisconnect(device('other').value)
    expect(client.connected).toBe(true)
    const waiting = client.queue.readChunk(Infinity), failed = expect(waiting).rejects.toBeInstanceOf(SerialDisconnectedError)
    source.emitDisconnect()
    await failed
    expect(client.connected).toBe(false)
    expect(disconnected).toHaveBeenCalledTimes(1)
    await expect(client.write(new Uint8Array([3]))).rejects.toBeInstanceOf(SerialDisconnectedError)
    expect(getPwaActivity().active).toBe(false)
  })

  it('closes before awaiting pending transferIn and does not emit a disconnect on an intentional close', async () => {
    const fixture = device(), client = transport(api(fixture.value).usb), disconnected = vi.fn()
    client.onDisconnectDetected(disconnected)
    await client.connect()
    expect(fixture.reads).toHaveLength(1)
    await client.disconnect()
    expect(fixture.value.close).toHaveBeenCalledTimes(1)
    expect(disconnected).not.toHaveBeenCalled()
    expect(client.connected).toBe(false)
    expect(getPwaActivity().active).toBe(false)
  })

  it('reconnects a re-enumerated device by serialNumber rather than choosing a different authorized device', async () => {
    const first = device('target'), source = api(first.value), client = transport(source.usb)
    await client.connect()
    await client.disconnect()
    const other = device('different'), again = device('target')
    vi.mocked(source.usb.getDevices).mockResolvedValue([other.value, again.value])
    await client.reconnect()
    expect(again.value.open).toHaveBeenCalledTimes(1)
    expect(other.value.open).not.toHaveBeenCalled()
    expect(source.usb.requestDevice).toHaveBeenCalledTimes(1)
  })

  it('requires explicit selection when the remembered device is missing or ambiguously identified', async () => {
    const fixture = device('target'), source = api(fixture.value), client = transport(source.usb)
    await client.connect()
    await client.disconnect()
    const other = device('other')
    vi.mocked(source.usb.getDevices).mockResolvedValue([other.value])
    await expect(client.reconnect()).rejects.toBeInstanceOf(SerialPermissionError)
    expect(other.value.open).not.toHaveBeenCalled()
    vi.mocked(source.usb.getDevices).mockResolvedValue([device('target').value, device('target').value])
    await expect(client.reconnect()).rejects.toBeInstanceOf(SerialPermissionError)
    expect(source.usb.requestDevice).toHaveBeenCalledTimes(1)
  })

  it('does not identify a replacement with no serialNumber by VID/PID alone', async () => {
    const fixture = device(''); fixture.value.serialNumber = undefined
    const source = api(fixture.value), client = transport(source.usb)
    await client.connect()
    await client.disconnect()
    const replacement = device(''); replacement.value.serialNumber = undefined
    vi.mocked(source.usb.getDevices).mockResolvedValue([replacement.value])
    await expect(client.reconnect()).rejects.toBeInstanceOf(SerialPermissionError)
    expect(replacement.value.open).not.toHaveBeenCalled()
    vi.mocked(source.usb.getDevices).mockResolvedValue([fixture.value])
    await client.reconnect()
    expect(client.connected).toBe(true)
  })

  it('does not choose among multiple authorized devices on a fresh transport', async () => {
    const fixture = device(), source = api(fixture.value), client = transport(source.usb)
    vi.mocked(source.usb.getDevices).mockResolvedValue([fixture.value, device('another').value])
    await expect(client.reconnect()).rejects.toBeInstanceOf(SerialPermissionError)
    expect(fixture.value.open).not.toHaveBeenCalled()
    expect(getPwaActivity().active).toBe(false)
  })

  it('keeps a receive timeout distinct from device removal', async () => {
    vi.useFakeTimers()
    const fixture = device(), client = transport(api(fixture.value).usb)
    await client.connect()
    const waiting = client.expect(new Uint8Array([79, 75]), 50), rejected = expect(waiting).rejects.toBeInstanceOf(DeviceTimeoutError)
    await vi.advanceTimersByTimeAsync(50)
    await rejected
    expect(client.connected).toBe(true)
  })

  it('tracks a pending chooser and an active connection in the PWA update interlock', async () => {
    const fixture = device(), source = api(fixture.value), selecting = deferred<WebUsbDevice>(), client = transport(source.usb)
    vi.mocked(source.usb.requestDevice).mockImplementationOnce(() => selecting.promise)
    const connecting = client.connect()
    expect(beginPwaUpdate()).toBe(false)
    selecting.resolve(fixture.value)
    await connecting
    expect(beginPwaUpdate()).toBe(false)
    await client.disconnect()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('rejects a concurrent chooser and keeps the first picker responsible for activity', async () => {
    const fixture = device(), source = api(fixture.value), selecting = deferred<WebUsbDevice>(), client = transport(source.usb)
    vi.mocked(source.usb.requestDevice).mockImplementationOnce(() => selecting.promise)
    const connecting = client.connect(), rejected = expect(connecting).rejects.toBeInstanceOf(SerialPermissionError)
    await expect(client.connect()).rejects.toThrow('接続処理中')
    expect(source.usb.requestDevice).toHaveBeenCalledTimes(1)
    expect(beginPwaUpdate()).toBe(false)
    selecting.reject(new DOMException('cancel', 'NotFoundError'))
    await rejected
    expect(beginPwaUpdate()).toBe(true)
  })

  it('interlocks authorized-device lookup and ignores its late result after disposal', async () => {
    const fixture = device(), source = api(fixture.value), finding = deferred<WebUsbDevice[]>(), client = transport(source.usb)
    vi.mocked(source.usb.getDevices).mockImplementationOnce(() => finding.promise)
    const reconnecting = client.reconnect(), rejected = expect(reconnecting).rejects.toBeInstanceOf(SerialDisconnectedError)
    expect(beginPwaUpdate()).toBe(false)
    client.dispose()
    expect(beginPwaUpdate()).toBe(false)
    finding.resolve([fixture.value])
    await rejected
    expect(fixture.value.open).not.toHaveBeenCalled()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('keeps pending close activity until native close settles', async () => {
    const fixture = device(), client = transport(api(fixture.value).usb), closing = deferred<void>()
    await client.connect()
    vi.mocked(fixture.value.close).mockImplementationOnce(() => closing.promise)
    const disconnecting = client.disconnect()
    expect(beginPwaUpdate()).toBe(false)
    closing.resolve()
    await disconnecting
    expect(beginPwaUpdate()).toBe(true)
  })

  it('does not open a chooser or reconnect during an app update', async () => {
    const fixture = device(), source = api(fixture.value), client = transport(source.usb)
    expect(beginPwaUpdate()).toBe(true)
    await expect(client.connect()).rejects.toThrow(PWA_UPDATE_BUSY_MESSAGE)
    await expect(client.reconnect()).rejects.toThrow(PWA_UPDATE_BUSY_MESSAGE)
    expect(source.usb.requestDevice).not.toHaveBeenCalled()
    expect(source.usb.getDevices).not.toHaveBeenCalled()
  })

  it('invalidates a selected device after disposal while keeping the pending chooser interlocked', async () => {
    const fixture = device(), source = api(fixture.value), selecting = deferred<WebUsbDevice>(), client = transport(source.usb)
    vi.mocked(source.usb.requestDevice).mockImplementationOnce(() => selecting.promise)
    const connecting = client.connect(), rejected = expect(connecting).rejects.toBeInstanceOf(SerialDisconnectedError)
    client.dispose()
    expect(beginPwaUpdate()).toBe(false)
    selecting.resolve(fixture.value)
    await rejected
    expect(fixture.value.open).not.toHaveBeenCalled()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('closes a late-successful open again after disposal without leaking an opened USB device', async () => {
    const fixture = device(), source = api(fixture.value), opening = deferred<void>(), client = transport(source.usb)
    vi.mocked(fixture.value.open).mockImplementationOnce(async () => { await opening.promise; fixture.value.opened = true })
    const connecting = client.connect(), rejected = expect(connecting).rejects.toBeInstanceOf(SerialDisconnectedError)
    await flush()
    client.dispose()
    await flush()
    expect(fixture.value.close).toHaveBeenCalledTimes(1)
    expect(beginPwaUpdate()).toBe(false)
    opening.resolve()
    await rejected
    expect(fixture.value.close).toHaveBeenCalledTimes(2)
    expect(fixture.value.opened).toBe(false)
    expect(fixture.value.claimInterface).not.toHaveBeenCalled()
    expect(beginPwaUpdate()).toBe(true)
  })

  it('removes disconnect listeners on dispose and reattaches them before a new connection', async () => {
    const fixture = device(), source = api(fixture.value), client = transport(source.usb)
    expect(source.listeners.size).toBe(1)
    client.dispose()
    expect(source.listeners.size).toBe(0)
    await client.connect()
    expect(source.listeners.size).toBe(1)
    const disconnected = vi.fn(), remove = client.onDisconnectDetected(disconnected)
    remove()
    source.emitDisconnect()
    expect(disconnected).not.toHaveBeenCalled()
  })
})
