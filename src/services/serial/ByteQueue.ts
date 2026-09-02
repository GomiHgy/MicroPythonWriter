import { DeviceTimeoutError, SerialDisconnectedError } from '../../types'

const containsAt = (data: Uint8Array, pattern: Uint8Array, start: number) => pattern.every((v, index) => data[start + index] === v)

/** Byte-oriented receive buffer; protocol bytes never pass through TextDecoder here. */
export class ByteQueue {
  private bytes = new Uint8Array()
  private waiters: Array<() => void> = []
  private closed: Error | undefined

  push(chunk: Uint8Array) {
    if (this.closed || chunk.length === 0) return
    const next = new Uint8Array(this.bytes.length + chunk.length)
    next.set(this.bytes); next.set(chunk, this.bytes.length); this.bytes = next
    this.wake()
  }

  close(error: Error = new SerialDisconnectedError()) { this.closed = error; this.wake() }
  get length() { return this.bytes.length }
  drain() { const data = this.bytes; this.bytes = new Uint8Array(); return data }

  async readExact(length: number, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
    await this.until(() => this.bytes.length >= length, timeoutMs, signal)
    const result = this.bytes.slice(0, length); this.bytes = this.bytes.slice(length); return result
  }

  async readUntil(pattern: Uint8Array, timeoutMs: number, signal?: AbortSignal, include = true): Promise<Uint8Array> {
    let match = -1
    await this.until(() => {
      for (let index = 0; index <= this.bytes.length - pattern.length; index++) if (containsAt(this.bytes, pattern, index)) { match = index; return true }
      return false
    }, timeoutMs, signal)
    const end = match + pattern.length
    const result = this.bytes.slice(0, include ? end : match)
    this.bytes = this.bytes.slice(end)
    return result
  }

  private async until(test: () => boolean, timeoutMs: number, signal?: AbortSignal) {
    const started = Date.now()
    while (!test()) {
      if (this.closed) throw this.closed
      if (signal?.aborted) throw new DOMException('操作は中止されました。', 'AbortError')
      const remaining = timeoutMs - (Date.now() - started)
      if (remaining <= 0) throw new DeviceTimeoutError(`受信待機が${timeoutMs}msでタイムアウトしました。`)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); resolve() }, Math.min(remaining, 50))
        const abort = () => { cleanup(); reject(new DOMException('操作は中止されました。', 'AbortError')) }
        const wake = () => { cleanup(); resolve() }
        const cleanup = () => { clearTimeout(timer); this.waiters = this.waiters.filter(w => w !== wake); signal?.removeEventListener('abort', abort) }
        this.waiters.push(wake); signal?.addEventListener('abort', abort, { once: true })
      })
    }
  }

  private wake() { const waiters = this.waiters.splice(0); waiters.forEach(waiter => waiter()) }
}
