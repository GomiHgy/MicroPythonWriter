export interface BootFeedback {
  mode: 0 | 1
  phase: 'saving' | 'resetting' | 'saved' | 'failed'
  saved: boolean
  message?: string
}
