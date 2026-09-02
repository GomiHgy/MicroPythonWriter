import { DeviceTimeoutError, RawPasteProtocolError } from '../../types'
import type { WebSerialTransport } from '../serial/WebSerialTransport'

const CTRL_D = new Uint8Array([4])
export class RawPasteProtocol {
  private readonly transport: WebSerialTransport
  constructor(transport: WebSerialTransport) { this.transport = transport }
  /** Returns false when firmware explicitly lacks raw-paste, never silently guesses. */
  async negotiate(timeoutMs: number): Promise<number | false> {
    await this.transport.write(new Uint8Array([5, 0x41, 1]))
    const response = await this.transport.queue.readExact(2, timeoutMs)
    if (response[0] === 0x52 && response[1] === 1) { const size = await this.transport.queue.readExact(2, timeoutMs); return size[0] | (size[1] << 8) }
    if ((response[0] === 0x52 && response[1] === 0) || (response[0] === 0x72 && response[1] === 0x61)) return false
    throw new RawPasteProtocolError(`Raw-paste の応答が不正です: ${[...response].map(v => v.toString(16)).join(' ')}`)
  }
  async send(source: Uint8Array, windowSize: number, timeoutMs: number) {
    if (windowSize < 1) throw new RawPasteProtocolError('Raw-paste のウィンドウサイズが不正です。')
    let offset = 0; let credit = windowSize
    while (offset < source.length) {
      if (credit === 0) { const flow = await this.transport.queue.readExact(1, timeoutMs); if (flow[0] !== 1) throw new RawPasteProtocolError('Raw-paste のフロー制御バイトが不正です。'); credit += windowSize }
      const length = Math.min(credit, source.length - offset); await this.transport.write(source.slice(offset, offset + length)); offset += length; credit -= length
    }
    await this.transport.write(CTRL_D)
    try { await this.transport.queue.readExact(1, timeoutMs) } catch (error) { if (error instanceof DeviceTimeoutError) throw new RawPasteProtocolError('Raw-paste 完了待機がタイムアウトしました。'); throw error }
  }
}
