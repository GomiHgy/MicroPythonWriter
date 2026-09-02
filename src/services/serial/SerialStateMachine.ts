import type { DeviceState } from '../../types'

const allowed: Record<DeviceState, DeviceState[]> = {
  unsupported: [], disconnected: ['requesting-port', 'opening'], 'connection-lost': ['reconnecting', 'requesting-port', 'disconnected'], reconnecting: ['connected', 'connection-lost', 'disconnected'], 'requesting-port': ['opening', 'disconnected', 'connection-lost', 'error'], opening: ['connected', 'disconnected', 'connection-lost', 'error'], connected: ['interrupting', 'entering-raw-repl', 'probing', 'disconnected', 'connection-lost', 'error'], interrupting: ['entering-raw-repl', 'connected', 'disconnected', 'connection-lost', 'error'], 'entering-raw-repl': ['raw-repl-ready', 'connected', 'disconnected', 'connection-lost', 'error'], 'raw-repl-ready': ['probing', 'uploading', 'running', 'stopping', 'setting-boot-mode', 'resetting', 'connected', 'disconnected', 'connection-lost', 'error'], probing: ['raw-repl-ready', 'disconnected', 'connection-lost', 'error'], uploading: ['raw-repl-ready', 'running', 'disconnected', 'connection-lost', 'error'], running: ['stopping', 'raw-repl-ready', 'disconnected', 'connection-lost', 'error'], stopping: ['raw-repl-ready', 'disconnected', 'connection-lost', 'error'], 'setting-boot-mode': ['raw-repl-ready', 'resetting', 'disconnected', 'connection-lost', 'error'], resetting: ['disconnected', 'connected', 'connection-lost', 'error'], error: ['disconnected', 'connected', 'entering-raw-repl', 'connection-lost']
}
export class SerialStateMachine {
  private current: DeviceState
  constructor(supported: boolean) { this.current = supported ? 'disconnected' : 'unsupported' }
  get state() { return this.current }
  move(next: DeviceState) { if (!allowed[this.current].includes(next)) throw new Error(`不正な状態遷移: ${this.current} → ${next}`); this.current = next; return next }
  force(next: DeviceState) { this.current = next; return next }
}
