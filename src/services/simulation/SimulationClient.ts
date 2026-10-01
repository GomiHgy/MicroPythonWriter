import { encodeCommand } from '../bluetooth/protocol'
import type { SimulationConfig, SimulationInput, SimulationOutput, SimulationSnapshot } from './types'

export function isSimulationSupported(): boolean {
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return false
  const wasm = WebAssembly as typeof WebAssembly & { Suspending?: unknown; promising?: unknown }
  return typeof wasm.Suspending === 'function' && typeof wasm.promising === 'function'
}

export function initialSimulationSnapshot(count = 10): SimulationSnapshot {
  return { phase: 'idle', pixels: Array.from({ length: Math.max(1, Math.min(300, count)) }, () => [0, 0, 0]), elapsedMs: 0, bleEnabled: false, modes: [], actions: [], log: '', error: '' }
}

/** 実機の通信クライアントとは独立した、使い捨てWorkerの管理。 */
export class SimulationClient {
  private worker: Worker | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private lastHeartbeat = 0
  private loadingStarted = 0
  private disposed = false
  private pauseRequested = false
  private snapshot = initialSimulationSnapshot()
  private readonly onChange: (snapshot: SimulationSnapshot) => void

  constructor(onChange: (snapshot: SimulationSnapshot) => void) {
    this.onChange = onChange
  }

  private publish(snapshot: SimulationSnapshot): void {
    this.snapshot = snapshot
    if (!this.disposed) this.onChange(snapshot)
  }

  private release(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
      this.worker.terminate()
    }
    this.worker = undefined
  }

  private fail(error: string): void {
    this.release()
    this.publish({ ...this.snapshot, phase: 'error', bleEnabled: false, error })
  }

  start(source: string, config: SimulationConfig): void {
    if (this.disposed) return
    this.release()
    this.pauseRequested = false
    this.snapshot = initialSimulationSnapshot(config.ledCount)
    if (!isSimulationSupported()) {
      this.fail('このブラウザはシミュレーションに対応していません。対応する最新版のChromeまたはEdgeを使用してください。')
      return
    }
    if (!source.trim() || source.length > 1_000_000) {
      this.fail('シミュレーションするプログラムを確認してください（空欄または大きすぎるコードです）。')
      return
    }
    this.publish({ ...this.snapshot, phase: 'loading' })
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      this.loadingStarted = this.lastHeartbeat = Date.now()
      worker.onmessage = (event: MessageEvent<SimulationOutput>) => {
        if (this.worker !== worker || this.disposed) return
        this.lastHeartbeat = Date.now()
        if (event.data.type === 'snapshot') {
          this.publish(event.data.snapshot)
          if (event.data.snapshot.phase === 'running' && this.pauseRequested) this.send({ type: 'pause' })
          if (event.data.snapshot.phase === 'finished' || event.data.snapshot.phase === 'error') this.release()
        }
      }
      worker.onerror = (event: ErrorEvent) => {
        if (this.worker !== worker || this.disposed) return
        this.fail(event.message || 'シミュレーションを開始できませんでした。')
      }
      this.timer = setInterval(() => {
        if (this.snapshot.phase === 'loading' ? Date.now() - this.loadingStarted > 60_000 : Date.now() - this.lastHeartbeat > 10_000) {
          this.fail('シミュレーションが応答しないため停止しました。プログラムを確認してリセットしてください。')
        }
      }, 1000)
      this.send({ type: 'start', source, config, runtimeUrl: new URL(`${import.meta.env.BASE_URL}simulation-runtime/`, document.baseURI).href })
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'シミュレーションを開始できませんでした。')
    }
  }

  private send(input: SimulationInput): void { this.worker?.postMessage(input) }
  pause(): void {
    // 読み込み中にタブを離れた場合も、開始直後に停止要求を引き継ぐ。
    this.pauseRequested = true
    if (this.snapshot.phase === 'running') this.send({ type: 'pause' })
  }
  resume(): void {
    this.pauseRequested = false
    if (this.snapshot.phase === 'paused') this.send({ type: 'resume' })
  }
  button(pressed: boolean): void { if (this.snapshot.phase === 'running' || !pressed) this.send({ type: 'button', pressed }) }
  command(command: string): void {
    if (this.snapshot.phase !== 'running' || !this.snapshot.bleEnabled) return
    try { this.send({ type: 'ble', command: new TextDecoder().decode(encodeCommand(command)) }) }
    catch { /* UI以外から不正な合図が来ても仮想機器へ渡さない。 */ }
  }
  reset(): void {
    if (this.disposed) return
    this.release()
    this.pauseRequested = false
    this.publish(initialSimulationSnapshot(this.snapshot.pixels.length))
  }
  dispose(): void { this.disposed = true; this.release() }
}
