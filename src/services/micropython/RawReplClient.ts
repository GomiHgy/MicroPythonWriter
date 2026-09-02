import { RawReplProtocolError, ReplNotAvailableError, type ExecutionResult } from '../../types'
import type { WebSerialTransport } from '../serial/WebSerialTransport'
import { RawPasteProtocol } from './RawPasteProtocol'

const encoder = new TextEncoder(); const decoder = new TextDecoder()
export const CTRL_A = new Uint8Array([1]); export const CTRL_B = new Uint8Array([2]); export const CTRL_C = new Uint8Array([3]); export const CTRL_D = new Uint8Array([4])
export interface StreamingCallbacks { onStdout?(text: string): void; onStderr?(text: string): void; onStarted?(): void }

export class RawReplClient {
  private readonly transport: WebSerialTransport
  private readonly timings: { interrupt: number; rawRepl: number; command: number }
  constructor(transport: WebSerialTransport, timings = { interrupt: 3000, rawRepl: 3000, command: 10000 }) { this.transport = transport; this.timings = timings }
  async enterRawRepl() {
    await this.transport.write(new Uint8Array([3, 3])); await new Promise(resolve => setTimeout(resolve, 80)); await this.transport.write(CTRL_A)
    try { await this.transport.queue.readUntil(encoder.encode('raw REPL; CTRL-B to exit'), this.timings.rawRepl) } catch { throw new ReplNotAvailableError() }
  }
  async friendlyRepl() { await this.transport.write(CTRL_B) }
  async interrupt(retries = 3) { for (let index = 0; index < retries; index++) { await this.transport.write(CTRL_C); await new Promise(resolve => setTimeout(resolve, 100)) } }
  async execute(code: string): Promise<ExecutionResult> {
    const started = performance.now(); const result = await this.executeInternal(code); return { ...result, durationMs: performance.now() - started, completed: true, interrupted: false }
  }
  async executeStreaming(code: string, callbacks: StreamingCallbacks = {}) {
    const rawPaste = new RawPasteProtocol(this.transport)
    const bytes = encoder.encode(code)
    const window = await rawPaste.negotiate(700).catch(() => false)
    if (typeof window === 'number') await rawPaste.send(bytes, window, this.timings.command)
    else { await this.transport.write(bytes); await this.transport.write(CTRL_D) }
    const ok = await this.transport.queue.readUntil(encoder.encode('OK'), this.timings.command)
    if (!decoder.decode(ok).endsWith('OK')) throw new RawReplProtocolError('Raw REPL が OK を返しませんでした。')
    callbacks.onStarted?.()
    const stdout = decoder.decode(await this.transport.queue.readUntil(CTRL_D, this.timings.command, undefined, false)); callbacks.onStdout?.(stdout)
    const stderr = decoder.decode(await this.transport.queue.readUntil(CTRL_D, this.timings.command, undefined, false)); callbacks.onStderr?.(stderr)
    await this.transport.queue.readUntil(encoder.encode('>'), this.timings.command)
    return { stdout, stderr, durationMs: 0, interrupted: false, completed: true }
  }
  private async executeInternal(code: string) {
    await this.transport.write(encoder.encode(code)); await this.transport.write(CTRL_D)
    const ok = decoder.decode(await this.transport.queue.readUntil(encoder.encode('OK'), this.timings.command)); if (!ok.endsWith('OK')) throw new RawReplProtocolError('Raw REPL が OK を返しませんでした。')
    const stdout = decoder.decode(await this.transport.queue.readUntil(CTRL_D, this.timings.command, undefined, false))
    const stderr = decoder.decode(await this.transport.queue.readUntil(CTRL_D, this.timings.command, undefined, false))
    await this.transport.queue.readUntil(encoder.encode('>'), this.timings.command)
    return { stdout, stderr }
  }
}
