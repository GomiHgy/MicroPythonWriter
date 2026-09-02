import type { DeviceState } from '../../types'

const allowed: Record<DeviceState, DeviceState[]> = {
  unsupported: [], disconnected: ['requesting-port', 'opening'], 'requesting-port': ['opening', 'disconnected', 'error'], opening: ['connected', 'disconnected', 'error'], connected: ['interrupting', 'entering-raw-repl', 'probing', 'disconnected', 'error'], interrupting: ['entering-raw-repl', 'connected', 'disconnected', 'error'], 'entering-raw-repl': ['raw-repl-ready', 'connected', 'disconnected', 'error'], 'raw-repl-ready': ['probing', 'uploading', 'running', 'stopping', 'setting-boot-mode', 'resetting', 'connected', 'disconnected', 'error'], probing: ['raw-repl-ready', 'disconnected', 'error'], uploading: ['raw-repl-ready', 'running', 'disconnected', 'error'], running: ['stopping', 'raw-repl-ready', 'disconnected', 'error'], stopping: ['raw-repl-ready', 'disconnected', 'error'], 'setting-boot-mode': ['raw-repl-ready', 'resetting', 'disconnected', 'error'], resetting: ['disconnected', 'connected', 'error'], error: ['disconnected', 'connected', 'entering-raw-repl']
}
export class SerialStateMachine {
  private current: DeviceState
  constructor(supported: boolean) { this.current = supported ? 'disconnected' : 'unsupported' }
  get state() { return this.current }
  move(next: DeviceState) { if (!allowed[this.current].includes(next)) throw new Error(`不正な状態遷移: ${this.current} → ${next}`); this.current = next; return next }
  force(next: DeviceState) { this.current = next; return next }
}
