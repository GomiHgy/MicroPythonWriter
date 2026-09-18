export const NANO_LED_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const NANO_LED_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
export const NANO_LED_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
export const MAX_STATUS_BYTES = 4096
export const MAX_LED_COUNT = 300
export const MAX_STATUS_AGE_MS = 5000

export interface LedControlChoice {
  readonly id: string
  readonly label: string
}

export interface LedStatusV1 {
  readonly v: 1
  readonly mode: string
  readonly brightness: number
  readonly speed: number
  readonly pixels: string
}

export interface LedStatusV2 {
  readonly v: 2
  readonly mode: string
  readonly brightness: number
  readonly speed: number
  readonly pixels: string
  readonly playback: 'playing' | 'paused' | 'off'
  readonly action: string | null
  readonly controls: {
    readonly speed: boolean
    readonly modes: readonly LedControlChoice[]
    readonly actions: readonly LedControlChoice[]
  }
}

export type LedStatus = LedStatusV1 | LedStatusV2

const tokenPattern = /^[A-Z][A-Z0-9_]{0,15}$/
const controlIdPattern = /^[A-Z][A-Z0-9_]{0,11}$/
const reservedControlIds = new Set(['OFF', 'PLAY', 'PAUSE', 'STATUS', 'BRIGHTNESS', 'SPEED', 'MODE', 'ACTION'])
const invalidLabelCharacters = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u
const isPercentage = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
const isControlId = (value: unknown): value is string => typeof value === 'string' && controlIdPattern.test(value) && !reservedControlIds.has(value)

function parseChoices(value: unknown, minimum: number): readonly LedControlChoice[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > 8) return null
  const choices: LedControlChoice[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const choice = entry as Record<string, unknown>
    if (!isControlId(choice.id) || ids.has(choice.id) || typeof choice.label !== 'string' || invalidLabelCharacters.test(choice.label)) return null
    const label = choice.label.trim()
    if (!label || [...label].length > 24) return null
    ids.add(choice.id)
    choices.push(Object.freeze({ id: choice.id, label }))
  }
  return Object.freeze(choices)
}

export function encodeCommand(input: string): Uint8Array {
  const command = input.trim().toUpperCase()
  const parameter = /^(BRIGHTNESS|SPEED) ([0-9]{1,3})$/.exec(command)
  if (parameter) {
    if (!isPercentage(Number(parameter[2]))) throw new Error('数値は0〜100で指定してください。')
    return new TextEncoder().encode(`${parameter[1]} ${Number(parameter[2])}\n`)
  }
  const operation = /^(MODE|ACTION) ([A-Z][A-Z0-9_]{0,11})$/.exec(command)
  if (operation && isControlId(operation[2])) return new TextEncoder().encode(`${command}\n`)
  if (!tokenPattern.test(command) || command === 'BRIGHTNESS' || command === 'SPEED' || command === 'MODE' || command === 'ACTION') {
    throw new Error('合図は英字で始まる英大文字・数字・_の16文字以内にしてください。')
  }
  return new TextEncoder().encode(`${command}\n`)
}

export function parseLedStatus(text: string): LedStatus | null {
  try {
    if (new TextEncoder().encode(text).length > MAX_STATUS_BYTES) return null
    const status: unknown = JSON.parse(text)
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null
    const value = status as Record<string, unknown>
    if ((value.v !== 1 && value.v !== 2) || typeof value.mode !== 'string' || !tokenPattern.test(value.mode)) return null
    if (!isPercentage(value.brightness) || !isPercentage(value.speed)) return null
    if (typeof value.pixels !== 'string' || value.pixels.length < 6 || value.pixels.length > MAX_LED_COUNT * 6) return null
    if (!/^(?:[0-9a-fA-F]{6})+$/.test(value.pixels)) return null
    const pixels = value.pixels.toLowerCase()
    if (value.v === 1) return Object.freeze({ v: 1, mode: value.mode, brightness: value.brightness, speed: value.speed, pixels })
    if (value.playback !== 'playing' && value.playback !== 'paused' && value.playback !== 'off') return null
    if (!value.controls || typeof value.controls !== 'object' || Array.isArray(value.controls)) return null
    const controls = value.controls as Record<string, unknown>
    if (typeof controls.speed !== 'boolean') return null
    const modes = parseChoices(controls.modes, 1)
    const actions = parseChoices(controls.actions, 0)
    if (!modes || !actions || !modes.some(choice => choice.id === value.mode)) return null
    if (value.action !== null && (typeof value.action !== 'string' || !actions.some(choice => choice.id === value.action))) return null
    if (value.action !== null && value.playback !== 'playing') return null
    if (value.playback === 'off' && /[^0]/.test(pixels)) return null
    return Object.freeze({
      v: 2, mode: value.mode, brightness: value.brightness, speed: value.speed, pixels,
      playback: value.playback, action: value.action,
      controls: Object.freeze({ speed: controls.speed, modes, actions }),
    })
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
