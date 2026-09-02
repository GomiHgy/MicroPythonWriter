import { DeviceTimeoutError, RawReplProtocolError, ReplNotAvailableError, type ExecutionResult } from '../../types'
import type { WebSerialTransport } from '../serial/WebSerialTransport'
import { RawPasteProtocol } from './RawPasteProtocol'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const marker = '__M5_MAIN_STARTED__'
export const CTRL_A = new Uint8Array([1])
export const CTRL_B = new Uint8Array([2])
export const CTRL_C = new Uint8Array([3])
export const CTRL_D = new Uint8Array([4])

export type RunState = 'starting' | 'running' | 'stopping' | 'stopped' | 'completed' | 'error'
export type LongRunningConfirmation = 'startup-marker' | 'execution-accepted' | 'still-running'
export interface LongRunningCompletion { stdout: string; stderr: string; state: Extract<RunState, 'stopped' | 'completed' | 'error'>; intentionalStop: boolean; hostError?: Error }
export interface LongRunningStartResult { state: 'running' | 'completed'; initialOutput: string; stderr: string; confirmedBy: LongRunningConfirmation; session: LongRunningSession }
export interface LongRunningSession { readonly state: RunState; stop(): Promise<LongRunningCompletion>; dispose(): void }
export interface LongRunningCallbacks { onOutput?(text: string): void; onComplete?(result: LongRunningCompletion): void }
export interface StreamingCallbacks { onStdout?(text: string): void; onStderr?(text: string): void; onStarted?(): void }

class ManagedLongRunningSession implements LongRunningSession {
  private currentState: RunState = 'starting'
  private readonly controller = new AbortController()
  private readonly stdout: number[] = []
  private readonly stderr: number[] = []
  private phase: 'stdout' | 'stderr' | 'prompt' = 'stdout'
  private stopRequested = false
  private startTimer?: ReturnType<typeof setTimeout>
  private startResolved = false
  private completionResolved = false
  private startResult?: LongRunningStartResult
  private completion?: LongRunningCompletion
  private resolveStart!: (value: LongRunningStartResult) => void
  private resolveCompletion!: (value: LongRunningCompletion) => void
  private readonly started: Promise<LongRunningStartResult>
  private readonly completed: Promise<LongRunningCompletion>

  private readonly transport: WebSerialTransport
  private readonly startupGraceMs: number
  private readonly stopTimeoutMs: number
  private readonly callbacks: LongRunningCallbacks
  private readonly onFinished: () => void
  constructor(transport: WebSerialTransport, startupGraceMs: number, stopTimeoutMs: number, callbacks: LongRunningCallbacks, onFinished: () => void) {
    this.transport = transport
    this.startupGraceMs = startupGraceMs
    this.stopTimeoutMs = stopTimeoutMs
    this.callbacks = callbacks
    this.onFinished = onFinished
    this.started = new Promise(resolve => { this.resolveStart = resolve })
    this.completed = new Promise(resolve => { this.resolveCompletion = resolve })
  }

  get state() { return this.currentState }

  begin() {
    this.startTimer = setTimeout(() => {
      if (!this.startResolved && this.currentState === 'starting') this.resolveRunning('still-running')
    }, this.startupGraceMs)
    void this.monitor()
  }

  waitForStart() { return this.started }

  async stop(): Promise<LongRunningCompletion> {
    if (this.completion) return this.completion
    this.stopRequested = true
    this.currentState = 'stopping'
    await this.transport.write(CTRL_C)
    try { return await this.waitForCompletion(this.stopTimeoutMs) } catch (error) {
      if (!(error instanceof DeviceTimeoutError)) throw error
      await this.transport.write(CTRL_C)
      return this.waitForCompletion(this.stopTimeoutMs)
    }
  }

  dispose() {
    if (!this.completion) {
      this.controller.abort()
      this.finish({ stdout: this.stdoutText(), stderr: this.stderrText(), state: 'stopped', intentionalStop: this.stopRequested })
    }
  }

  private async monitor() {
    try {
      while (!this.controller.signal.aborted && !this.completion) this.consume(await this.transport.queue.readChunk(Number.POSITIVE_INFINITY, this.controller.signal, '常駐プログラム出力'))
    } catch (error) {
      if (this.controller.signal.aborted) return
      this.finish({ stdout: this.stdoutText(), stderr: this.stderrText(), state: 'error', intentionalStop: false, hostError: error instanceof Error ? error : new Error(String(error)) })
    }
  }

  private consume(chunk: Uint8Array) {
    for (const byte of chunk) {
      if (this.phase === 'stdout') {
        if (byte === 4) this.phase = 'stderr'
        else this.stdout.push(byte)
      } else if (this.phase === 'stderr') {
        if (byte === 4) this.phase = 'prompt'
        else this.stderr.push(byte)
      } else if (byte === 62) {
        const stderr = this.stderrText()
        this.finish({ stdout: this.stdoutText(), stderr, state: this.stopRequested ? 'stopped' : stderr ? 'error' : 'completed', intentionalStop: this.stopRequested })
        return
      }
    }
    const output = this.stdoutText()
    if (!this.startResolved && output.includes(marker)) this.resolveRunning('startup-marker')
    this.callbacks.onOutput?.(decoder.decode(chunk))
  }

  private resolveRunning(confirmedBy: LongRunningConfirmation) {
    if (this.startResolved) return
    this.currentState = 'running'
    this.startResolved = true
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startResult = { state: 'running', initialOutput: this.stdoutText(), stderr: '', confirmedBy, session: this }
    this.resolveStart(this.startResult)
  }

  private finish(result: LongRunningCompletion) {
    if (this.completionResolved) return
    this.completionResolved = true
    this.completion = result
    this.currentState = result.state
    if (this.startTimer) clearTimeout(this.startTimer)
    if (!this.startResolved) {
      this.startResolved = true
      this.startResult = { state: 'completed', initialOutput: result.stdout, stderr: result.stderr, confirmedBy: 'execution-accepted', session: this }
      this.resolveStart(this.startResult)
    }
    this.resolveCompletion(result)
    this.callbacks.onComplete?.(result)
    this.onFinished()
  }

  private async waitForCompletion(timeoutMs: number) {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new DeviceTimeoutError(`常駐プログラム停止: 受信待機が${timeoutMs}msでタイムアウトしました。`)), timeoutMs))
    return Promise.race([this.completed, timeout])
  }

  private stdoutText() { return decoder.decode(new Uint8Array(this.stdout)) }
  private stderrText() { return decoder.decode(new Uint8Array(this.stderr)) }
}

export class RawReplClient {
  private readonly transport: WebSerialTransport
  private readonly timings: { interrupt: number; rawRepl: number; command: number; startupGrace: number; stop: number }
  private activeSession?: ManagedLongRunningSession
  constructor(transport: WebSerialTransport, timings: Partial<{ interrupt: number; rawRepl: number; command: number; startupGrace: number; stop: number }> = {}) {
    this.transport = transport
    this.timings = { interrupt: timings.interrupt ?? 3000, rawRepl: timings.rawRepl ?? 3000, command: timings.command ?? 10000, startupGrace: timings.startupGrace ?? 2500, stop: timings.stop ?? 3000 }
  }

  async enterRawRepl() {
    await this.transport.write(new Uint8Array([3, 3])); await new Promise(resolve => setTimeout(resolve, 80)); await this.transport.write(CTRL_A)
    try { await this.transport.queue.readUntil(encoder.encode('raw REPL; CTRL-B to exit'), this.timings.rawRepl, undefined, true, 'Raw REPL同期') } catch { throw new ReplNotAvailableError() }
  }
  async friendlyRepl() { await this.transport.write(CTRL_B) }
  async interrupt(retries = 3) { for (let index = 0; index < retries; index++) { await this.transport.write(CTRL_C); await new Promise(resolve => setTimeout(resolve, 100)) } }
  async stopLongRunning() { return this.activeSession?.stop() }
  hasLongRunningSession() { return Boolean(this.activeSession) }
  discardPendingInput() { return this.transport.queue.drain() }
  async reset() {
    if (this.activeSession) throw new RawReplProtocolError('常駐プログラム実行中です。停止してからリセットしてください。')
    this.discardPendingInput()
    await this.transport.write(encoder.encode('import machine\nmachine.reset()'))
    await this.transport.write(CTRL_D)
  }

  async execute(code: string): Promise<ExecutionResult> {
    if (this.activeSession) throw new RawReplProtocolError('常駐プログラム実行中です。停止してから有限コマンドを実行してください。')
    const started = performance.now(); const result = await this.executeInternal(code); return { ...result, durationMs: performance.now() - started, completed: true, interrupted: false }
  }

  async startLongRunning(code: string, callbacks: LongRunningCallbacks = {}): Promise<LongRunningStartResult> {
    if (this.activeSession) throw new RawReplProtocolError('前の常駐プログラムを停止してから起動してください。')
    this.discardPendingInput()
    await this.transport.write(encoder.encode(code)); await this.transport.write(CTRL_D)
    const accepted = decoder.decode(await this.transport.queue.readUntil(encoder.encode('OK'), this.timings.command, undefined, true, '常駐プログラム受付'))
    if (!accepted.endsWith('OK')) throw new RawReplProtocolError('Raw REPL が常駐プログラムを受け付けませんでした。')
    const session = new ManagedLongRunningSession(this.transport, this.timings.startupGrace, this.timings.stop, callbacks, () => { if (this.activeSession === session) this.activeSession = undefined })
    this.activeSession = session
    session.begin()
    return session.waitForStart()
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
    this.discardPendingInput()
    await this.transport.write(encoder.encode(code)); await this.transport.write(CTRL_D)
    const ok = decoder.decode(await this.transport.queue.readUntil(encoder.encode('OK'), this.timings.command, undefined, true, '有限コマンド受付'))
    if (!ok.endsWith('OK')) throw new RawReplProtocolError('Raw REPL が OK を返しませんでした。')
    const stdout = decoder.decode(await this.transport.queue.readUntil(CTRL_D, this.timings.command, undefined, false, '有限コマンド標準出力'))
    const stderr = decoder.decode(await this.transport.queue.readUntil(CTRL_D, this.timings.command, undefined, false, '有限コマンド標準エラー'))
    await this.transport.queue.readUntil(encoder.encode('>'), this.timings.command, undefined, true, 'Raw REPLプロンプト')
    return { stdout, stderr }
  }
}
