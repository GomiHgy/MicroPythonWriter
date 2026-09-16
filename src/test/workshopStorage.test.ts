import { describe, expect, it, vi } from 'vitest'
import type { WorkshopPreset } from '../config/workshops'
import { cloneWorkshopProfile, type WorkshopProfile } from '../services/workshop/WorkshopProfile'
import { MAX_STORED_PROFILE_LENGTH, removeWorkshopProfile, restoreWorkshopProfile, storeWorkshopProfile, workshopStorageKey } from '../services/workshop/WorkshopStorage'

const profile: WorkshopProfile = { materialId: 'test-material', revision: 'test-1', displayName: 'テスト教材', kitId: '007', firmwareVersion: 'test-ui-2', ledModel: 'test-rgb', ledCount: 37, ledBpp: 3, maxBrightnessPercent: 30, features: { button: true, ble: true, controller: true }, baseline: { code: 'print("test baseline")', verification: { code: 'print("test baseline")', firmwareVersion: 'test-ui-2', confirmedBy: 'テスト講師', confirmedAt: '2026-09-15T00:00:00.000Z', nanoLedV1: true } } }
const preset: WorkshopPreset = { id: 'test-preset', profile: { ...cloneWorkshopProfile(profile), kitId: null, baseline: { code: '', verification: null } } }
function storage() { const values = new Map<string, string>(); return { values, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value) }), removeItem: vi.fn((key: string) => { values.delete(key) }) } }

describe('ワークショップ設定の安全なブラウザ保存', () => {
  it('通常保存は基準コードと確認情報を除き、先頭ゼロを復元する', () => {
    const target = storage()
    expect(storeWorkshopProfile(preset, profile, false, () => target)).toBe('')
    expect(target.values.get(workshopStorageKey(preset))).not.toContain('test baseline')
    const restored = restoreWorkshopProfile(preset, () => target)
    expect(restored.notice).toBe('')
    expect(restored.profile.kitId).toBe('007')
    expect(restored.profile.baseline).toEqual({ code: '', verification: null })
    expect(profile.baseline.verification).not.toBeNull()
  })
  it('明示保存のみ基準コードを保存し、通常保存で以前の基準コードを除く', () => {
    const target = storage()
    storeWorkshopProfile(preset, profile, true, () => target)
    expect(restoreWorkshopProfile(preset, () => target).profile).toEqual(profile)
    storeWorkshopProfile(preset, profile, false, () => target)
    expect(restoreWorkshopProfile(preset, () => target).profile.baseline.code).toBe('')
  })
  it.each(['json', 'schema', 'revision', 'binding', 'extra', 'profile', 'oversize'])('%s を検出し、配布設定へ戻す', reason => {
    const target = storage()
    storeWorkshopProfile(preset, profile, true, () => target)
    const saved = JSON.parse(target.values.get(workshopStorageKey(preset))!)
    if (reason === 'schema') saved.schemaVersion = 0
    if (reason === 'revision') saved.revision = 'old'
    if (reason === 'binding') saved.profile.materialId = 'other'
    if (reason === 'extra') saved.userCode = 'private'
    if (reason === 'profile') saved.profile.ledBpp = 4
    target.values.set(workshopStorageKey(preset), reason === 'json' ? '{broken' : reason === 'oversize' ? 'x'.repeat(MAX_STORED_PROFILE_LENGTH + 1) : JSON.stringify(saved))
    const restored = restoreWorkshopProfile(preset, () => target)
    expect(restored.notice).not.toBe('')
    expect(restored.profile).toEqual(preset.profile)
  })
  it('新しい版や別のプリセットへ古い設定を混ぜない', () => {
    const target = storage()
    storeWorkshopProfile(preset, profile, true, () => target)
    const next = { ...preset, profile: { ...preset.profile, revision: 'test-2' } }
    expect(restoreWorkshopProfile(next, () => target)).toEqual({ profile: next.profile, notice: '' })
    expect(workshopStorageKey({ ...preset, id: 'different' })).not.toBe(workshopStorageKey(preset))
  })
  it('ストレージ利用不可・容量不足で例外を外へ出さない', () => {
    const unavailable = () => { throw new Error('denied') }
    expect(restoreWorkshopProfile(preset, unavailable).notice).not.toBe('')
    expect(storeWorkshopProfile(preset, profile, false, unavailable)).not.toBe('')
    expect(removeWorkshopProfile(preset, unavailable)).not.toBe('')
  })
  it('不正な値・別版を保存せず、削除は対象プリセットだけ', () => {
    const target = storage()
    expect(storeWorkshopProfile(preset, { ...profile, ledCount: 0 }, false, () => target)).not.toBe('')
    expect(storeWorkshopProfile(preset, { ...profile, revision: 'different' }, false, () => target)).not.toBe('')
    expect(target.setItem).not.toHaveBeenCalled()
    target.values.set('other', 'untouched')
    storeWorkshopProfile(preset, profile, false, () => target)
    expect(removeWorkshopProfile(preset, () => target)).toBe('')
    expect(target.values.get('other')).toBe('untouched')
  })
})
