import type { WorkshopPreset } from '../../config/workshops'
import { cloneWorkshopProfile, isLedModel, isWorkshopProfile, validateWorkshopProfile, type WorkshopProfile } from './WorkshopProfile'
import { UNKNOWN_LED_MODEL_NOTICE } from './LedSettings'

const STORAGE_SCHEMA = 1
export const MAX_STORED_PROFILE_LENGTH = 240_000
type SettingsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type WorkshopStorageResult = { profile: WorkshopProfile; notice: string }

export function workshopStorageKey(preset: WorkshopPreset) {
  return `mpw-workshop:${encodeURIComponent(preset.id)}:${encodeURIComponent(preset.profile.materialId)}:${encodeURIComponent(preset.profile.revision)}`
}

export function restoreWorkshopProfile(preset: WorkshopPreset, getStorage: () => SettingsStorage = () => localStorage): WorkshopStorageResult {
  const fallback = cloneWorkshopProfile(preset.profile)
  try {
    const raw = getStorage().getItem(workshopStorageKey(preset))
    if (raw === null) return { profile: fallback, notice: '' }
    if (raw.length > MAX_STORED_PROFILE_LENGTH) throw new Error('size')
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape')
    const record = data as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'materialId,presetId,profile,revision,schemaVersion') throw new Error('shape')
    if (record.schemaVersion !== STORAGE_SCHEMA || record.presetId !== preset.id || record.materialId !== preset.profile.materialId || record.revision !== preset.profile.revision) throw new Error('version')
    // 旧版は NanoC6 だけだった。既知の配布設定に限り機器識別子を補い、
    // 任意の旧データや AtomS3Lite の設定へ NanoC6 の配線を流用しない。
    const storedProfile = record.profile
    if (storedProfile && typeof storedProfile === 'object' && !Array.isArray(storedProfile)
      && !('boardId' in storedProfile)
      && preset.id === 'nano-c6-led-default'
      && preset.profile.materialId === 'nano-c6-led-workshop'
      && preset.profile.revision === 'writer-ai-1'
      && preset.profile.boardId === 'm5nanoc6') {
      record.profile = { ...storedProfile, boardId: 'm5nanoc6' }
    }
    // 従来は外部LEDピンがGPIO2固定だったため、欠けた項目だけ補完する。
    if (record.profile && typeof record.profile === 'object' && !Array.isArray(record.profile) && !('ledPin' in record.profile)) record.profile = { ...record.profile, ledPin: 2 }
    // 廃止したキット番号を捨てても、利用者の設定や明示保存したコードは維持する。
    let notice = ''
    if (record.profile && typeof record.profile === 'object' && !Array.isArray(record.profile)) {
      const migrated = { ...record.profile } as Record<string, unknown>
      delete migrated.kitId
      if (typeof migrated.ledModel === 'string' && !isLedModel(migrated.ledModel)) {
        migrated.ledModel = null
        if (migrated.baseline && typeof migrated.baseline === 'object' && !Array.isArray(migrated.baseline)) migrated.baseline = { ...migrated.baseline, verification: null }
        notice = UNKNOWN_LED_MODEL_NOTICE
      }
      record.profile = migrated
    }
    if (!isWorkshopProfile(record.profile) || record.profile.boardId !== preset.profile.boardId || record.profile.materialId !== preset.profile.materialId || record.profile.revision !== preset.profile.revision || validateWorkshopProfile(record.profile, true).length) throw new Error('profile')
    if (record.profile.displayName === 'M5NanoC6 LEDワークショップ' || record.profile.displayName === 'NanoC6 LEDワークショップ') record.profile.displayName = 'M5NanoC6'
    if (record.profile.displayName === 'AtomS3Lite LEDワークショップ') record.profile.displayName = 'AtomS3Lite'
    return { profile: cloneWorkshopProfile(record.profile), notice }
  } catch {
    return { profile: fallback, notice: '保存済みの設定を読み込めませんでした。未対応の版・破損・容量・保存機能を確認してください。初期設定を使っています。' }
  }
}

export function storeWorkshopProfile(preset: WorkshopPreset, profile: WorkshopProfile, persistBaseline: boolean, getStorage: () => SettingsStorage = () => localStorage): string {
  if (!isWorkshopProfile(profile) || validateWorkshopProfile(profile).length || profile.boardId !== preset.profile.boardId || profile.materialId !== preset.profile.materialId || profile.revision !== preset.profile.revision) return '設定が不正なため保存できません。設定の入力内容を確認してください。'
  const saved = cloneWorkshopProfile(profile)
  if (!persistBaseline) saved.baseline = { code: '', verification: null }
  try {
    const raw = JSON.stringify({ schemaVersion: STORAGE_SCHEMA, presetId: preset.id, materialId: profile.materialId, revision: profile.revision, profile: saved })
    if (raw.length > MAX_STORED_PROFILE_LENGTH) return '設定が大きすぎるため保存できません。基準コードはこの画面のメモリ上で利用できます。'
    getStorage().setItem(workshopStorageKey(preset), raw)
    return ''
  } catch {
    return 'このブラウザには設定を保存できませんでした。現在の画面では設定を使えますが、再読み込みすると失われます。'
  }
}

export function removeWorkshopProfile(preset: WorkshopPreset, getStorage: () => SettingsStorage = () => localStorage): string {
  try { getStorage().removeItem(workshopStorageKey(preset)); return '' }
  catch { return '保存済みの設定を削除できませんでした。ブラウザの保存設定を確認してください。' }
}
