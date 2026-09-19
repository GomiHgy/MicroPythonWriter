import type { LongRunningConfirmation } from '../services/micropython/RawReplClient'

/** 最後に受け付けた書込み操作の結果。機器の物理的な動作確認とは別に扱う。 */
export interface ProgramFeedback {
  id: number
  operation: 'run' | 'write'
  phase: 'preparing' | 'writing' | 'verifying' | 'starting' | 'saved' | 'running' | 'completed' | 'stopped' | 'failed' | 'disconnected'
  source: string
  saved: boolean
  confirmation?: LongRunningConfirmation
  failedAt?: 'prepare' | 'write' | 'verify' | 'start' | 'runtime' | 'stop'
  message?: string
}
