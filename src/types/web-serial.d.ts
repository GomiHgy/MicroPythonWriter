interface SerialPortFilter { usbVendorId?: number; usbProductId?: number }
interface SerialOptions { baudRate: number; bufferSize?: number; flowControl?: 'none' | 'hardware' }
interface SerialPort {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo?(): { usbVendorId?: number; usbProductId?: number }
}
interface NavigatorSerial {
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>
  getPorts(): Promise<SerialPort[]>
  addEventListener(type: 'connect' | 'disconnect', listener: (event: Event & { port?: SerialPort }) => void): void
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: Event & { port?: SerialPort }) => void): void
}
interface Navigator { serial?: NavigatorSerial }
