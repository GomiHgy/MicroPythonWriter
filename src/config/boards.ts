export type BoardId = 'm5nanoc6' | 'atoms3lite'
export type BoardSoc = 'ESP32-C6' | 'ESP32-S3'

export interface BoardDefinition {
  id: BoardId
  name: string
  soc: BoardSoc
  firmwareBurnerUrl: string
  ledPin: number
  buttonPin: number
  rgbPin: number
  rgbPowerPin: number | null
  statusLedPin: number | null
}

// M5Stack公式PinMap / M5Unifiedのボタン・RGB定義。外付けLEDと内蔵LEDは別物。
// https://docs.m5stack.com/en/core/M5NanoC6
// https://docs.m5stack.com/en/core/AtomS3%20Lite
// https://github.com/m5stack/M5Unified/blob/master/src/M5Unified.cpp
export const boardDefinitions: Record<BoardId, BoardDefinition> = {
  m5nanoc6: { id: 'm5nanoc6', name: 'M5NanoC6', soc: 'ESP32-C6', firmwareBurnerUrl: 'https://burner.m5stack.com/device/nanoc6', ledPin: 2, buttonPin: 9, rgbPin: 20, rgbPowerPin: 19, statusLedPin: 7 },
  atoms3lite: { id: 'atoms3lite', name: 'AtomS3Lite', soc: 'ESP32-S3', firmwareBurnerUrl: 'https://burner.m5stack.com/device/atoms3-lite', ledPin: 2, buttonPin: 41, rgbPin: 35, rgbPowerPin: null, statusLedPin: null },
}

export const isBoardId = (value: unknown): value is BoardId => value === 'm5nanoc6' || value === 'atoms3lite'
export const getBoardDefinition = (id: BoardId) => boardDefinitions[id]

/** SoC名だけでは製品を特定しない。AtomS3/AtomS3RもLiteとは別機種。 */
export function identifyBoard(text: string): BoardId | undefined {
  if (/(?:M5)?Nano[ _-]?C6\b/i.test(text)) return 'm5nanoc6'
  if (/(?:M5)?Atom[ _-]?S3[ _-]?Lite\b/i.test(text)) return 'atoms3lite'
  return undefined
}

export function identifySoc(text: string): BoardSoc | undefined {
  if (/ESP32[ _-]?C6\b/i.test(text)) return 'ESP32-C6'
  if (/ESP32[ _-]?S3\b/i.test(text)) return 'ESP32-S3'
  return undefined
}
