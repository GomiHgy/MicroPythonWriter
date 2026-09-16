export const NANO_LED_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const NANO_LED_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
export const NANO_LED_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
export const MAX_STATUS_BYTES = 4096
export const MAX_LED_COUNT = 300

export interface LedStatus {
  readonly v: 1
  readonly mode: string
  readonly brightness: number
  readonly speed: number
  readonly pixels: string
}

const tokenPattern = /^[A-Z][A-Z0-9_]{0,15}$/
const isPercentage = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100

export function encodeCommand(input: string): Uint8Array {
  const command = input.trim().toUpperCase()
  const parameter = /^(BRIGHTNESS|SPEED) ([0-9]{1,3})$/.exec(command)
  if (parameter) {
    if (!isPercentage(Number(parameter[2]))) throw new Error('数値は0〜100で指定してください。')
    return new TextEncoder().encode(`${parameter[1]} ${Number(parameter[2])}\n`)
  }
  if (!tokenPattern.test(command) || command === 'BRIGHTNESS' || command === 'SPEED') {
    throw new Error('合図は英字で始まる英大文字・数字・_の16文字以内にしてください。')
  }
  return new TextEncoder().encode(`${command}\n`)
}

export function parseLedStatus(text: string): LedStatus | null {
  try {
    const status: unknown = JSON.parse(text)
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null
    const value = status as Record<string, unknown>
    if (value.v !== 1 || typeof value.mode !== 'string' || !tokenPattern.test(value.mode)) return null
    if (!isPercentage(value.brightness) || !isPercentage(value.speed)) return null
    if (typeof value.pixels !== 'string' || value.pixels.length < 6 || value.pixels.length > MAX_LED_COUNT * 6) return null
    if (!/^(?:[0-9a-fA-F]{6})+$/.test(value.pixels)) return null
    return Object.freeze({ v: 1, mode: value.mode, brightness: value.brightness, speed: value.speed, pixels: value.pixels.toLowerCase() })
  } catch {
    return null
  }
}

export class LedStatusParser {
  private bytes: number[] = []
  private discarding = false

  push(chunk: Uint8Array): { statuses: LedStatus[]; rejected: number } {
    const statuses: LedStatus[] = []
    let rejected = 0
    for (const byte of chunk) {
      if (byte === 10) {
        if (!this.discarding && this.bytes.length > 0) {
          let status: LedStatus | null
          try { status = parseLedStatus(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(this.bytes))) } catch { status = null }
          if (status) statuses.push(status)
          else rejected++
        }
        this.bytes = []
        this.discarding = false
      } else if (!this.discarding) {
        if (this.bytes.length === MAX_STATUS_BYTES) {
          this.bytes = []
          this.discarding = true
          rejected++
        } else this.bytes.push(byte)
      }
    }
    return { statuses, rejected }
  }

  reset(): void {
    this.bytes = []
    this.discarding = false
  }
}
