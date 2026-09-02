import { ByteQueue } from './ByteQueue'
import { DeviceTimeoutError, SerialDisconnectedError, SerialNotSupportedError, SerialPermissionError } from '../../types'

export class WebSerialTransport {
  queue = new ByteQueue()
  private port?: SerialPort
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private subscribers = new Set<(data: Uint8Array) => void>()
  private disconnectSubscribers = new Set<() => void>()
  private writeChain: Promise<void> = Promise.resolve()
  private disconnected = false
  private readonly serial: NavigatorSerial | undefined
  private readonly onDisconnect = (event: Event & { port?: SerialPort }) => { if (!event.port || event.port === this.port) this.markDisconnected() }
  constructor(serial: NavigatorSerial | undefined = typeof navigator === 'undefined' ? undefined : navigator.serial) { this.serial = serial; this.serial?.addEventListener('disconnect', this.onDisconnect) }
  get supported() { return Boolean(this.serial) }
  get connected() { return Boolean(this.port) && !this.disconnected }
  onData(callback: (data: Uint8Array) => void) { this.subscribers.add(callback); return () => { this.subscribers.delete(callback) } }
  onDisconnectDetected(callback: () => void) { this.disconnectSubscribers.add(callback); return () => { this.disconnectSubscribers.delete(callback) } }

  async connect(baudRate = 115200) {
    if (!this.serial) throw new SerialNotSupportedError()
    try { this.port = await this.serial.requestPort() } catch (error) { throw new SerialPermissionError(error instanceof Error ? error.message : undefined) }
    await this.open(baudRate)
  }
  async reconnect(baudRate = 115200) {
    if (!this.serial) throw new SerialNotSupportedError()
    const ports = await this.serial.getPorts(); if (!ports[0]) throw new SerialPermissionError('再接続できる許可済みポートがありません。USB接続を押してください。')
    this.port = ports[0]; await this.open(baudRate)
  }
  async open(baudRate: number) {
    if (!this.port) throw new SerialDisconnectedError()
    this.disconnected = false; this.queue = new ByteQueue(); await this.port.open({ baudRate, bufferSize: 65536 }); this.startReader()
  }
  async write(data: Uint8Array) {
    if (!this.port?.writable || this.disconnected) throw new SerialDisconnectedError()
    const action = async () => { const writer = this.port?.writable?.getWriter(); if (!writer) throw new SerialDisconnectedError(); try { await writer.write(data) } finally { writer.releaseLock() } }
    const next = this.writeChain.then(action, action); this.writeChain = next.catch(() => undefined); return next
  }
  waitFor(pattern: Uint8Array, timeoutMs: number, signal?: AbortSignal) { return this.queue.readUntil(pattern, timeoutMs, signal) }
  async disconnect() {
    this.disconnected = true; this.queue.close(); try { await this.reader?.cancel() } catch { /* disconnected ports commonly reject cancel */ }
    this.reader?.releaseLock(); this.reader = undefined; try { await this.port?.close() } catch { /* already closed */ }; this.port = undefined
  }
  dispose() { this.serial?.removeEventListener('disconnect', this.onDisconnect) }
  private startReader() {
    if (!this.port?.readable) throw new SerialDisconnectedError('ポートを開けませんでした。')
    this.reader = this.port.readable.getReader()
    void (async () => { try { while (this.reader) { const { value, done } = await this.reader.read(); if (done) break; if (value) { this.queue.push(value); this.subscribers.forEach(callback => callback(value)) } } } catch (error) { if (!this.disconnected) this.queue.close(error instanceof Error ? error : new SerialDisconnectedError()) } finally { const wasConnected = !this.disconnected; this.disconnected = true; this.queue.close(); this.reader?.releaseLock(); this.reader = undefined; if (wasConnected) this.markDisconnected() } })()
  }
  private markDisconnected() { if (this.disconnected && !this.port) return; this.disconnected = true; this.queue.close(new SerialDisconnectedError()); this.port = undefined; this.disconnectSubscribers.forEach(callback => callback()) }
  async expect(pattern: Uint8Array, timeoutMs: number) { try { return await this.waitFor(pattern, timeoutMs) } catch (error) { if (error instanceof DeviceTimeoutError) throw error; throw new SerialDisconnectedError() } }
}
