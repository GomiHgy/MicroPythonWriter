import type { ButtonGesture } from './types'

const SHORT_PRESS_MS = 100
const DOUBLE_GAP_MS = 140
// 1秒の判定に加えて40msのチャタリング除去とポーリングの余裕を確保する。
const LONG_PRESS_MS = 1100
// 解放直後に別の操作を重ねず、作品コードのクリック確定を待つ。
const SETTLE_MS = 400

/** 仮想時計上のGPIO入力。作品側のクリック判定や演出は呼び出さない。 */
export class SimulationButtonInput {
  private gesture: ButtonGesture | null = null
  private startedAt = 0
  private manualPressed = false
  private readonly now: () => number
  private readonly onChange: (gesture: ButtonGesture | null) => void

  constructor(now: () => number, onChange: (gesture: ButtonGesture | null) => void) {
    this.now = now
    this.onChange = onChange
  }

  start(gesture: ButtonGesture, running: boolean): boolean {
    this.update()
    if (!running || this.gesture || this.manualPressed || !['single', 'double', 'long'].includes(gesture)) return false
    this.startedAt = this.now()
    this.gesture = gesture
    this.onChange(gesture)
    return true
  }

  manual(pressed: boolean, running: boolean): void {
    if (!pressed) { this.cancel(); return }
    if (running && !this.gesture) this.manualPressed = true
  }

  cancel(): void {
    this.manualPressed = false
    if (this.gesture === null) return
    this.gesture = null
    this.onChange(null)
  }

  private releaseAt(): number {
    return this.gesture === 'long' ? LONG_PRESS_MS
      : this.gesture === 'double' ? SHORT_PRESS_MS * 2 + DOUBLE_GAP_MS : SHORT_PRESS_MS
  }

  update(): void {
    if (this.gesture !== null && this.now() - this.startedAt >= this.releaseAt() + SETTLE_MS) this.cancel()
  }

  read(): boolean {
    this.update()
    if (this.gesture === null) return this.manualPressed
    const elapsed = this.now() - this.startedAt
    if (this.gesture === 'long') return elapsed < LONG_PRESS_MS
    if (elapsed < SHORT_PRESS_MS) return true
    return this.gesture === 'double' && elapsed >= SHORT_PRESS_MS + DOUBLE_GAP_MS && elapsed < this.releaseAt()
  }
}
