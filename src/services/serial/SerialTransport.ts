import type { ByteQueue } from './ByteQueue'

/** Raw REPLから見た共通バイト通信。USB方式が変わっても転送・起動設定の処理は共有する。 */
export interface SerialTransport {
  readonly kind: 'web-serial' | 'webusb-cdc'
  readonly supported: boolean
  readonly connected: boolean
  queue: ByteQueue
  connect(baudRate?: number): Promise<void>
  reconnect(baudRate?: number): Promise<void>
  open(baudRate: number): Promise<void>
  write(data: Uint8Array): Promise<void>
  disconnect(): Promise<void>
  dispose(): void
  onData(callback: (data: Uint8Array) => void): () => void
  onDisconnectDetected(callback: () => void): () => void
  waitFor(pattern: Uint8Array, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array>
  expect(pattern: Uint8Array, timeoutMs: number): Promise<Uint8Array>
}
