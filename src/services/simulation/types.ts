import type { LedCurrentObservation } from './LedCurrent'

export interface SimulationConfig {
  boardId: 'm5nanoc6' | 'atoms3lite'
  ledPin: number
  ledCount: number
  buttonPin: number
}
export type SimulationPhase = 'idle' | 'loading' | 'running' | 'paused' | 'finished' | 'error'
export interface SimulationControl { id: string; label: string }
export interface SimulationSnapshot {
  phase: SimulationPhase
  pixels: [number, number, number][]
  ledCurrent: LedCurrentObservation | null
  elapsedMs: number
  bleEnabled: boolean
  modes: SimulationControl[]
  actions: SimulationControl[]
  log: string
  error: string
}
export type SimulationInput =
  | { type: 'start'; source: string; config: SimulationConfig; runtimeUrl: string }
  | { type: 'pause' | 'resume' }
  | { type: 'button'; pressed: boolean }
  | { type: 'ble'; command: string }
export type SimulationOutput =
  | { type: 'snapshot'; snapshot: SimulationSnapshot }
  | { type: 'heartbeat' }
