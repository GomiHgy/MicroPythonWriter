import { boardDefinitions, isBoardId } from '../../config/boards'
import { LED_MODELS } from '../workshop/WorkshopProfile'
import type { ProjectRecipe, ProjectSettings } from './types'
import runtime from '../../../firmware/starter/runtime.py?raw'

export interface ProviderStarterVerification {
  /** 機種・版・配線・レシピとランタイム全体を含む、受入した生成main.pyそのもの。 */
  readonly source: string
  readonly confirmedAt: string
  readonly confirmedBy: string
  readonly evidencePath: string
}
// 提供側がHIL証拠と共にレビューして追加するリポジトリ専用の表。
// localStorage・作品JSON・利用者の動作OK記録から取り込んではいけない。
export const providerVerifiedStarters: readonly ProviderStarterVerification[] = Object.freeze([])
const reserved = new Set(['OFF', 'PLAY', 'PAUSE', 'STATUS', 'BRIGHTNESS', 'SPEED', 'MODE', 'ACTION'])

function validate(settings: ProjectSettings, recipe: ProjectRecipe) {
  if (!isBoardId(settings.boardId)) throw new Error('対応機器を選んでください。')
  if (typeof settings.firmwareVersion !== 'string' || settings.firmwareVersion.trim().length === 0 || settings.firmwareVersion.length > 80 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(settings.firmwareVersion)) throw new Error('UIFlow2の版を入力してください。')
  if (!LED_MODELS.includes(settings.ledModel)) throw new Error('対応するRGB LED型番を選んでください。')
  if (!Number.isInteger(settings.ledCount) || settings.ledCount < 1 || settings.ledCount > 300) throw new Error('LED数は1〜300個で指定してください。')
  if (!Number.isInteger(settings.ledPin) || settings.ledPin < 0 || settings.ledPin > (settings.boardId === 'm5nanoc6' ? 30 : 48)) throw new Error('外部LEDのGPIOを確認してください。')
  const board = boardDefinitions[settings.boardId]
  if ([board.buttonPin, board.rgbPin, board.rgbPowerPin, board.statusLedPin].includes(settings.ledPin)) throw new Error('外部LEDのGPIOが内蔵LEDまたはボタンと重複しています。')
  if (!Number.isFinite(settings.maxBrightnessPercent) || settings.maxBrightnessPercent <= 0 || settings.maxBrightnessPercent > 100) throw new Error('最大輝度は0より大きく100以下で指定してください。')
  if (!Array.isArray(recipe.modes) || recipe.modes.length < 1 || recipe.modes.length > 8) throw new Error('光り方は1〜8種類で指定してください。')
  const ids = new Set<string>()
  for (const mode of recipe.modes) {
    if (typeof mode.id !== 'string' || !/^[A-Z][A-Z0-9_]{0,11}$/.test(mode.id) || reserved.has(mode.id) || ids.has(mode.id)) throw new Error('光り方のIDが不正または重複しています。')
    ids.add(mode.id)
    if (typeof mode.label !== 'string' || !mode.label.trim() || Array.from(mode.label).length > 24 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(mode.label)) throw new Error('光り方の名前は制御文字を含まない1〜24文字にしてください。')
    if (!['solid', 'rainbow', 'chase', 'twinkle'].includes(mode.kind) || !['light', 'star', 'rainbow', 'heart'].includes(mode.icon)) throw new Error('対応する光り方を選んでください。')
    if (typeof mode.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(mode.color)) throw new Error('色は6桁のRGBで指定してください。')
    if (!Number.isInteger(mode.speed) || mode.speed < 0 || mode.speed > 100 || !Number.isInteger(mode.repeats) || mode.repeats < 0 || mode.repeats > 100) throw new Error('速さ・繰り返し回数は0〜100の整数にしてください。')
    if (!['hold', 'off'].includes(mode.endState)) throw new Error('終了時の状態を選んでください。')
  }
  if (!['next', 'toggle', 'none'].includes(recipe.shortPress) || !['next', 'toggle', 'none'].includes(recipe.doublePress) || !['next', 'toggle', 'none', 'off'].includes(recipe.longPress) || typeof recipe.whileHeld !== 'boolean' || typeof recipe.wireless !== 'boolean') throw new Error('ボタン・無線の操作設定が不正です。')
}

/** 提供側の実機確認状況。コード準備・試行の可否とは別で、利用者の「動作OK」保存でも昇格しない。 */
export function starterAvailability(settings: ProjectSettings, recipe: ProjectRecipe): { verified: boolean; reason: string } {
  try { validate(settings, recipe) } catch (error) { return { verified: false, reason: error instanceof Error ? error.message : '設定を確認してください。' } }
  const source = buildStarterProgram(settings, recipe)
  const approved = providerVerifiedStarters.some(record => record.source === source && record.confirmedBy.trim().length > 0 && record.evidencePath.trim().length > 0
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.confirmedAt)
    && Number.isFinite(Date.parse(record.confirmedAt)) && new Date(record.confirmedAt).toISOString() === record.confirmedAt)
  if (approved) return { verified: true, reason: 'このプログラムは、設定と一致する提供側の実機確認記録があります。' }
  return { verified: false, reason: 'この機種・UIFlow2版・LED構成の提供側実機確認はまだ完了していません。入門プログラムは提供側の検証用候補です。' }
}

/** 編集・保存・明示的な試行用のコードを生成。自動実行・書込み・確認済み登録は行わない。 */
export function buildStarterProgram(settings: ProjectSettings, recipe: ProjectRecipe): string {
  validate(settings, recipe)
  const config = {
    board: settings.boardId, firmware: settings.firmwareVersion.trim(), led_model: settings.ledModel,
    led_pin: settings.ledPin, led_count: settings.ledCount, max_brightness: settings.maxBrightnessPercent,
    button_pin: boardDefinitions[settings.boardId].buttonPin,
    name: settings.boardId === 'm5nanoc6' ? 'NanoLED-M5NanoC6' : 'NanoLED-AtomS3Lite',
    modes: recipe.modes.map(mode => ({ id: mode.id, label: mode.label.trim(), kind: mode.kind, color: mode.color.slice(1), speed: mode.speed, repeats: mode.repeats, end: mode.endState })),
    short_press: recipe.shortPress, double_press: recipe.doublePress, long_press: recipe.longPress, while_held: recipe.whileHeld, wireless: recipe.wireless,
  }
  // JSONをPython文字列のデータとして埋め込む。ラベルや版名をコードへ展開しない。
  const literal = JSON.stringify(config).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `# STARTER TEST CANDIDATE - HARDWARE NOT VERIFIED\n# 実機未検証です。配線・電源・設定を確認して試し、確認済みとして配布しないでください。\n# 提供側の実機受入: docs/starter-validation.md\nimport json\nCONFIG = json.loads('${literal}')\n\n${runtime}`
}
