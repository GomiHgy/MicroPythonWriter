import { pythonLanguage } from '@codemirror/lang-python'

const names = { count: ['LED_COUNT', 'NUM_LEDS'], brightness: ['MAX_BRIGHTNESS', 'MAX_BRIGHTNESS_PERCENT'] } as const
export type SettingKey = keyof typeof names
export type CodeSetting = { name: string; value: number; from: number; to: number; scale: number }
export type SettingResult = { setting: CodeSetting; reason?: never } | { setting?: never; reason: 'missing' | 'ambiguous' | 'unsupported' | 'syntax' }
export type LedCodeSettings = Record<SettingKey, SettingResult>

/** Pythonは実行せず、トップレベルの単純な数値代入だけを編集対象にする。 */
export function readLedCodeSettings(source: string): LedCodeSettings {
  try { return parseLedCodeSettings(source) } catch {
    return { count: { reason: 'syntax' }, brightness: { reason: 'syntax' } }
  }
}

function parseLedCodeSettings(source: string): LedCodeSettings {
  const result: LedCodeSettings = { count: { reason: 'missing' }, brightness: { reason: 'missing' } }
  if (source.length > 1_000_000) return { count: { reason: 'syntax' }, brightness: { reason: 'syntax' } }
  const tree = pythonLanguage.parser.parse(source)
  const candidates: Record<SettingKey, (CodeSetting | null)[]> = { count: [], brightness: [] }
  let invalid = false
  const cursor = tree.cursor()
  do {
    if (cursor.type.isError) invalid = true
    if (!['AssignStatement', 'UpdateStatement'].includes(cursor.name)) continue
    const node = cursor.node
    const children: (typeof node)[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) children.push(child)
    const operator = children.findIndex(child => child.name === 'AssignOp' || child.name === 'UpdateOp')
    for (const key of Object.keys(names) as SettingKey[]) {
      // 多重代入、再代入、関数内定義も候補に数え、黙って一部だけ変更しない。
      const targets = children.filter((child, index) => child.name === 'VariableName' && (operator < 0 || index < operator || children.slice(index + 1).some(next => next.name === 'AssignOp')) && (names[key] as readonly string[]).includes(source.slice(child.from, child.to)))
      for (const target of targets) {
        const name = source.slice(target.from, target.to)
        const number = children.at(-1)!
        const raw = source.slice(number.from, number.to)
        const scale = name === 'MAX_BRIGHTNESS' ? 100 : 1
        const value = scale === 100 ? Number((Number(raw) * scale).toPrecision(15)) : Number(raw)
        const supported = node.parent?.name === 'Script' && cursor.name === 'AssignStatement'
          && children[0] === target && operator >= 1 && children.slice(1, operator).every(child => child.name === 'TypeDef') && children.filter(child => child.name === 'AssignOp').length === 1
          && children.length === operator + 2 && number.name === 'Number' && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)
          && (key === 'count' ? validCount(value) : Number.isFinite(value) && value >= 0 && value <= 100)
        candidates[key].push(supported ? { name, value, from: number.from, to: number.to, scale } : null)
      }
    }
  } while (cursor.next())
  for (const key of Object.keys(names) as SettingKey[]) {
    const found = candidates[key]
    result[key] = invalid ? { reason: 'syntax' } : found.length > 1 ? { reason: 'ambiguous' }
      : found.length === 0 ? { reason: 'missing' } : found[0] ? { setting: found[0] } : { reason: 'unsupported' }
  }
  return result
}

function validCount(value: number) { return Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(value * 3) }

/** 毎回最新コードを解析し直し、数値の範囲だけを置換。コメント・改行・演出は維持する。 */
export function applyLedCodeSettings(source: string, changes: Partial<Record<SettingKey, number>>): string | null {
  const settings = readLedCodeSettings(source)
  const edits: { from: number; to: number; text: string }[] = []
  for (const key of Object.keys(changes) as SettingKey[]) {
    if (!(key in settings)) return null
    const setting = settings[key].setting
    const value = changes[key]!
    if (!setting || !(key === 'count' ? validCount(value) : Number.isFinite(value) && value >= 0 && value <= 100)) return null
    if (value !== setting.value) edits.push({ from: setting.from, to: setting.to, text: String(value / setting.scale) })
  }
  return edits.sort((a, b) => b.from - a.from).reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), source)
}
