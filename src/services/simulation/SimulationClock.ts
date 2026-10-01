/** 一時停止中の壁時計時間を作品へ進めない仮想時計。 */
export class SimulationClock {
  private elapsed = 0
  private last: number
  private paused: boolean
  private readonly realNow: () => number
  constructor(realNow = () => performance.now(), paused = false) { this.realNow = realNow; this.last = realNow(); this.paused = paused }
  now(): number {
    const current = this.realNow()
    if (!this.paused) this.elapsed += Math.max(0, current - this.last)
    this.last = current
    return this.elapsed
  }
  pause(): void { this.now(); this.paused = true }
  resume(): void { this.now(); this.paused = false }
  get isPaused(): boolean { return this.paused }
}
