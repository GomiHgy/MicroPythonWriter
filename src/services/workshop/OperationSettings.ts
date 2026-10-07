import type { WorkshopPreset } from '../../config/workshops'
import type { WorkshopProfile } from './WorkshopProfile'

type OperationSettings = WorkshopProfile['features']
export const operationSettingsKey = (preset: WorkshopPreset) => `mpw-operation:${preset.id}:${preset.profile.boardId}:${preset.profile.revision}`

function validOperationSettings(value: unknown): value is OperationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).sort().join(',') === 'ble,button,controller'
    && Object.values(record).every(item => typeof item === 'boolean')
    && (!record.controller || record.ble === true)
}

// 基本欄の操作方法だけを保存する。コード・実機確認・未適用の詳細設定を混ぜない。
export function storeOperationSettings(preset: WorkshopPreset, features: OperationSettings): string {
  if (!validOperationSettings(features)) return '操作方法を保存できませんでした。画面の設定を確認してください。'
  try { localStorage.setItem(operationSettingsKey(preset), JSON.stringify(features)); return '' }
  catch { return '操作方法を保存できませんでした。この画面では使えますが、再読み込みすると失われます。' }
}

export function restoreOperationSettings(preset: WorkshopPreset, profile: WorkshopProfile): { profile: WorkshopProfile; notice: string } {
  try {
    const raw = localStorage.getItem(operationSettingsKey(preset))
    if (raw === null) return { profile, notice: '' }
    if (raw.length > 128) throw new Error('size')
    const features: unknown = JSON.parse(raw)
    if (!validOperationSettings(features)) throw new Error('invalid')
    return { profile: { ...profile, features }, notice: '' }
  } catch { return { profile, notice: '保存した操作方法を読み込めませんでした。画面の設定を確認してください。' } }
}
