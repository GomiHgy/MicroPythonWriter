import { isBoardId, type BoardId } from '../../config/boards'

export interface WorkshopVerification {
  boardId?: BoardId
  code: string
  firmwareVersion: string
  confirmedBy: string
  confirmedAt: string
  nanoLedV1: boolean
}

export interface WorkshopProfile {
  boardId: BoardId
  materialId: string
  revision: string
  displayName: string
  firmwareVersion: string | null
  ledModel: string | null
  ledCount: number | null
  ledPin: number | null
  ledBpp: number | null
  maxBrightnessPercent: number | null
  features: { button: boolean; ble: boolean; controller: boolean }
  baseline: { code: string; verification: WorkshopVerification | null }
}

export const MAX_BASELINE_CODE_LENGTH = 100_000
export const MAX_PROFILE_TEXT_LENGTH = 200
export const LED_MODELS = ['WS2812B', 'WS2812B-MINI', 'WS2812C-2020', 'SK6812', 'SK6812MINI'] as const
export const isLedModel = (value: unknown): value is typeof LED_MODELS[number] => typeof value === 'string' && LED_MODELS.some(model => model === value)
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const unresolvedPlaceholder = /\{\{[\s\S]*?\}\}/
const hasControlCharacters = (text: string) => [...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)

export const hasUnresolvedPlaceholder = (text: string) => unresolvedPlaceholder.test(text)

export function validProfileText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_PROFILE_TEXT_LENGTH
    && !hasControlCharacters(value) && !hasUnresolvedPlaceholder(value)
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const nullableString = (value: unknown) => value === null || typeof value === 'string'
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))

export function isWorkshopProfile(value: unknown): value is WorkshopProfile {
  if (!record(value) || !exactKeys(value, ['boardId', 'materialId', 'revision', 'displayName', 'firmwareVersion', 'ledModel', 'ledCount', 'ledPin', 'ledBpp', 'maxBrightnessPercent', 'features', 'baseline']) || !isBoardId(value.boardId)) return false
  if (![value.materialId, value.revision, value.displayName].every(item => typeof item === 'string' && item.length <= MAX_PROFILE_TEXT_LENGTH)) return false
  if (!nullableString(value.firmwareVersion) || (typeof value.firmwareVersion === 'string' && value.firmwareVersion.length > MAX_PROFILE_TEXT_LENGTH)) return false
  if (value.ledModel !== null && !isLedModel(value.ledModel)) return false
  if (![value.ledCount, value.ledPin, value.ledBpp, value.maxBrightnessPercent].every(nullableNumber)) return false
  if (!record(value.features) || !exactKeys(value.features, ['button', 'ble', 'controller']) || !Object.values(value.features).every(item => typeof item === 'boolean')) return false
  if (!record(value.baseline) || !exactKeys(value.baseline, ['code', 'verification']) || typeof value.baseline.code !== 'string' || value.baseline.code.length > MAX_BASELINE_CODE_LENGTH) return false
  const verification = value.baseline.verification
  if (verification === null) return true
  return record(verification) && exactKeys(verification, ['code', 'firmwareVersion', 'confirmedBy', 'confirmedAt', 'nanoLedV1', ...(Object.hasOwn(verification, 'boardId') ? ['boardId'] : [])])
    && (!Object.hasOwn(verification, 'boardId') || isBoardId(verification.boardId))
    && typeof verification.code === 'string' && verification.code.length <= MAX_BASELINE_CODE_LENGTH
    && [verification.firmwareVersion, verification.confirmedBy, verification.confirmedAt].every(item => typeof item === 'string' && item.length <= MAX_PROFILE_TEXT_LENGTH)
    && typeof verification.nanoLedV1 === 'boolean'
}

export function cloneWorkshopProfile(profile: WorkshopProfile): WorkshopProfile {
  return {
    boardId: profile.boardId,
    materialId: profile.materialId,
    revision: profile.revision,
    displayName: profile.displayName,
    firmwareVersion: profile.firmwareVersion,
    ledModel: profile.ledModel,
    ledCount: profile.ledCount,
    ledPin: profile.ledPin,
    ledBpp: profile.ledBpp,
    maxBrightnessPercent: profile.maxBrightnessPercent,
    features: { ...profile.features },
    baseline: { code: profile.baseline.code, verification: profile.baseline.verification ? { ...profile.baseline.verification } : null },
  }
}

export function validateWorkshopProfile(profile: WorkshopProfile, allowIncompletePersonalSettings = false): string[] {
  const errors: string[] = []
  if (!isBoardId(profile.boardId)) errors.push('対応機器をM5NanoC6またはAtomS3Liteから選んでください。')
  if (!identifier.test(profile.materialId)) errors.push('教材IDは半角英数字で始まる64文字以内の英数字・ハイフン・アンダースコア・ドットにしてください。')
  if (!identifier.test(profile.revision)) errors.push('教材の版は半角英数字で始まる64文字以内の英数字・ハイフン・アンダースコア・ドットにしてください。')
  if (!validProfileText(profile.displayName)) errors.push('教材の表示名を200文字以内で設定してください。空欄・改行・未記入のテンプレートは使えません。')
  if (!(allowIncompletePersonalSettings && profile.firmwareVersion === null) && !validProfileText(profile.firmwareVersion)) errors.push('対象UIFlow2ファームウェアの版を入力してください。機器から取得したMicroPythonの版で代用しません。')
  if (!(allowIncompletePersonalSettings && profile.ledModel === null) && !isLedModel(profile.ledModel)) errors.push('LEDの型番を選択してください。対応する5種類のRGB LEDから選べます。')
  if (!Number.isSafeInteger(profile.ledCount) || profile.ledCount === null || profile.ledCount <= 0 || !Number.isSafeInteger(profile.ledCount * 3)) errors.push('LED数を正の整数で設定してください。')
  if (!Number.isSafeInteger(profile.ledPin) || profile.ledPin === null || profile.ledPin < 0 || profile.ledPin > 48) errors.push('外部LEDピンは0〜48の整数で入力し、使用機器で出力可能なGPIOと配線を確認してください。')
  if (profile.ledBpp !== 3) errors.push('LED_BPP=3のRGB LEDのみ対応しています。RGBWなどへ変換せず、使用するLEDの仕様を確認してください。')
  if (profile.maxBrightnessPercent === null || !Number.isFinite(profile.maxBrightnessPercent) || profile.maxBrightnessPercent <= 0 || profile.maxBrightnessPercent > 100) errors.push('最大輝度を0より大きく100以下の数値で設定してください。範囲内でも実機の電源安全性は別途確認が必要です。')
  return errors
}

export function getBlePreparationReasons(profile: WorkshopProfile): string[] {
  if (!profile.features.ble && !profile.features.controller) return []
  const reasons: string[] = []
  if (!profile.features.ble) reasons.push('Webコントローラを使うにはBLEも有効にしてください。')
  const code = profile.baseline.code
  if (!code.trim()) reasons.push('BLE基準コードが未登録です。対象機器で確認したコードを登録してください。')
  if (code.length > MAX_BASELINE_CODE_LENGTH) reasons.push('BLE基準コードは100000文字以内にしてください。省略せず登録できる内容か確認してください。')
  if (hasUnresolvedPlaceholder(code) || code.includes('\0')) reasons.push('BLE基準コードに未記入のテンプレートまたは不正な文字が残っています。')
  const verification = profile.baseline.verification
  if (!verification) reasons.push('BLE基準コードの実機確認情報が未登録です。対象機器で動作を確認して登録してください。')
  else {
    if ((verification.boardId ?? 'm5nanoc6') !== profile.boardId) reasons.push('BLEの確認対象機器が設定と一致しません。実機で再確認してください。')
    if (verification.code !== code) reasons.push('基準コードが確認時から変更されています。実機で再確認してください。')
    if (verification.firmwareVersion !== profile.firmwareVersion) reasons.push('BLEの確認対象UIFlow2版が設定と一致しません。実機で再確認してください。')
    if (!validProfileText(verification.confirmedBy) || !validProfileText(verification.confirmedAt) || !Number.isFinite(Date.parse(verification.confirmedAt))) reasons.push('BLEを確認した人の名前と確認日時を設定してください。')
    if (profile.features.controller && !verification.nanoLedV1) reasons.push('NanoLED v1対応の実機確認が必要です。対象機器で操作・状態通知を確認してください。')
  }
  if ((profile.features.controller || verification?.nanoLedV1) && (profile.ledBpp !== 3 || profile.ledCount === null || !Number.isInteger(profile.ledCount) || profile.ledCount < 1 || profile.ledCount > 300)) reasons.push('NanoLED v1はRGB・1〜300個のLEDに対応します。使用するLED数や形式が対応しているか確認してください。')
  return reasons
}
