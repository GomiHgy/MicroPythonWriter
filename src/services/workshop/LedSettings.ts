import type { WorkshopPreset } from '../../config/workshops'
import type { WorkshopProfile } from './WorkshopProfile'

export type LedSettings = Pick<WorkshopProfile, 'ledCount' | 'maxBrightnessPercent' | 'ledPin'>
export const ledSettingsKey = (preset: WorkshopPreset) => `mpw-led:${preset.id}:${preset.profile.boardId}:${preset.profile.revision}`
export function validLedSettings(value: LedSettings) {
  return value.ledCount !== null && Number.isSafeInteger(value.ledCount) && value.ledCount > 0 && Number.isSafeInteger(value.ledCount * 3)
    && value.maxBrightnessPercent !== null && Number.isFinite(value.maxBrightnessPercent) && value.maxBrightnessPercent > 0 && value.maxBrightnessPercent <= 100
    && value.ledPin !== null && Number.isSafeInteger(value.ledPin) && value.ledPin >= 0 && value.ledPin <= 48
}
export function saveLedSettings(preset: WorkshopPreset, value: LedSettings): string {
  if (!validLedSettings(value)) return 'LED設定が不正です。最後に保存できた値は変更していません。'
  try {
    localStorage.setItem(ledSettingsKey(preset), JSON.stringify({ ledCount: value.ledCount, maxBrightnessPercent: value.maxBrightnessPercent, ledPin: value.ledPin }))
    return 'LED設定をこのブラウザに自動保存しました。'
  } catch { return 'LED設定を保存できませんでした。この画面では使えますが、再読み込みすると失われます。' }
}
export function restoreLedSettings(preset: WorkshopPreset, profile: WorkshopProfile): { profile: WorkshopProfile; notice: string } {
  try {
    const raw = localStorage.getItem(ledSettingsKey(preset))
    if (raw === null) return { profile, notice: '' }
    if (raw.length > 500) throw new Error('size')
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'ledCount,ledPin,maxBrightnessPercent' || !validLedSettings(value)) throw new Error('invalid')
    const changed = value.ledCount !== profile.ledCount || value.ledPin !== profile.ledPin || value.maxBrightnessPercent !== profile.maxBrightnessPercent
    return { profile: { ...profile, ...value, baseline: changed ? { ...profile.baseline, verification: null } : profile.baseline }, notice: '' }
  } catch { return { profile, notice: '保存したLED設定を読み込めませんでした。画面の値を確認してください。' } }
}
