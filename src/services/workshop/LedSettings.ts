import type { WorkshopPreset } from '../../config/workshops'
import { isLedModel, validProfileText, type WorkshopProfile } from './WorkshopProfile'

export type LedSettings = Pick<WorkshopProfile, 'ledCount' | 'maxBrightnessPercent' | 'ledPin' | 'firmwareVersion' | 'ledModel'>
// 対象版200文字のJSONエスケープによる増加も含め、保存・復元で共通の上限を使う。
export const MAX_STORED_LED_SETTINGS_LENGTH = 2048
export const UNKNOWN_LED_MODEL_NOTICE = '保存済みのLED型番は現在の選択肢にありません。ほかの設定は復元しました。LEDの型番を選び直してください。'
export const ledSettingsKey = (preset: WorkshopPreset) => `mpw-led:${preset.id}:${preset.profile.boardId}:${preset.profile.revision}`
export function validLedSettings(value: LedSettings) {
  return value.ledCount !== null && Number.isSafeInteger(value.ledCount) && value.ledCount > 0 && Number.isSafeInteger(value.ledCount * 3)
    && value.maxBrightnessPercent !== null && Number.isFinite(value.maxBrightnessPercent) && value.maxBrightnessPercent > 0 && value.maxBrightnessPercent <= 100
    && value.ledPin !== null && Number.isSafeInteger(value.ledPin) && value.ledPin >= 0 && value.ledPin <= 48
    && (value.firmwareVersion === null || validProfileText(value.firmwareVersion))
    && (value.ledModel === null || isLedModel(value.ledModel))
}
export function saveLedSettings(preset: WorkshopPreset, value: LedSettings): string {
  return storeLedSettings(preset, value, true) || 'LED設定をこのブラウザに自動保存しました。'
}
// 設定を元の値へ戻しても過去の確認を復活させない。コードや確認情報は保存しない。
export function storeLedSettings(preset: WorkshopPreset, value: LedSettings, verificationInvalidated: boolean): string {
  if (!validLedSettings(value)) return 'LED設定が不正です。最後に保存できた値は変更していません。'
  try {
    const raw = JSON.stringify({ ledCount: value.ledCount, maxBrightnessPercent: value.maxBrightnessPercent, ledPin: value.ledPin, firmwareVersion: value.firmwareVersion, ledModel: value.ledModel, verificationInvalidated })
    if (raw.length > MAX_STORED_LED_SETTINGS_LENGTH) return 'LED設定が不正です。最後に保存できた値は変更していません。'
    localStorage.setItem(ledSettingsKey(preset), raw)
    return ''
  } catch { return 'LED設定を保存できませんでした。この画面では使えますが、再読み込みすると失われます。' }
}
export function restoreLedSettings(preset: WorkshopPreset, profile: WorkshopProfile): { profile: WorkshopProfile; notice: string } {
  try {
    const raw = localStorage.getItem(ledSettingsKey(preset))
    if (raw === null) return { profile, notice: '' }
    if (raw.length > MAX_STORED_LED_SETTINGS_LENGTH) throw new Error('size')
    const stored = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('invalid')
    const keys = Object.keys(stored).sort().join(',')
    // 旧版の3項目だけの自動保存は、明示保存された版・型番を上書きしない。
    if (keys !== 'ledCount,ledPin,maxBrightnessPercent' && keys !== 'firmwareVersion,ledCount,ledModel,ledPin,maxBrightnessPercent' && keys !== 'firmwareVersion,ledCount,ledModel,ledPin,maxBrightnessPercent,verificationInvalidated') throw new Error('invalid')
    const { verificationInvalidated, ...settings } = stored
    if (Object.hasOwn(stored, 'verificationInvalidated') && typeof verificationInvalidated !== 'boolean') throw new Error('invalid')
    const value: LedSettings = { firmwareVersion: profile.firmwareVersion, ledModel: profile.ledModel, ...settings }
    const unsupportedModel = typeof value.ledModel === 'string' && !isLedModel(value.ledModel)
    if (unsupportedModel) value.ledModel = null
    if (!validLedSettings(value)) throw new Error('invalid')
    const changed = verificationInvalidated === true || unsupportedModel || Object.entries(value).some(([key, item]) => profile[key as keyof LedSettings] !== item)
    return { profile: { ...profile, ...value, baseline: changed ? { ...profile.baseline, verification: null } : profile.baseline }, notice: unsupportedModel ? UNKNOWN_LED_MODEL_NOTICE : '' }
  } catch { return { profile, notice: '保存したLED設定を読み込めませんでした。画面の値を確認してください。' } }
}
