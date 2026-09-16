import { afterEach, describe, expect, it, vi } from 'vitest'
import { workshopPresets } from '../config/workshops'
import { ledSettingsKey, MAX_STORED_LED_SETTINGS_LENGTH, restoreLedSettings, saveLedSettings } from '../services/workshop/LedSettings'
import { LED_MODELS } from '../services/workshop/WorkshopProfile'

afterEach(() => vi.unstubAllGlobals())
describe('利用者のLED設定保存', () => {
  it.each(['{', '[]', '{"ledCount":10,"maxBrightnessPercent":20,"ledPin":-1}', '{"ledCount":10,"maxBrightnessPercent":101,"ledPin":2}'])('破損・不正データを適用しない %s', raw => {
    vi.stubGlobal('localStorage', { getItem: () => raw })
    const preset = workshopPresets[0]
    const result = restoreLedSettings(preset, preset.profile)
    expect(result.profile).toBe(preset.profile)
    expect(result.notice).not.toBe('')
  })
  it('200文字の有効な対象版をエスケープ後500文字超でも保存・復元する', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    const preset = workshopPresets[0]
    const firmwareVersion = String.fromCharCode(92).repeat(200)
    expect(saveLedSettings(preset, { ...preset.profile, firmwareVersion, ledModel: 'WS2812B-MINI' })).toContain('自動保存')
    expect(values.get(ledSettingsKey(preset))!.length).toBeGreaterThan(500)
    const restored = restoreLedSettings(preset, preset.profile)
    expect(restored.notice).toBe('')
    expect(restored.profile.firmwareVersion).toBe(firmwareVersion)
  })
  it('有効JSONでも保存容量上限を超える場合は復元せず、上限内は復元する', () => {
    const preset = workshopPresets[0]
    const settings = JSON.stringify({ ledCount: 24, maxBrightnessPercent: 15, ledPin: 3, firmwareVersion: '2.3.1', ledModel: 'WS2812B' })
    vi.stubGlobal('localStorage', { getItem: () => settings.padEnd(MAX_STORED_LED_SETTINGS_LENGTH, ' ') })
    expect(restoreLedSettings(preset, preset.profile)).toMatchObject({ profile: { ledCount: 24, firmwareVersion: '2.3.1' }, notice: '' })
    vi.stubGlobal('localStorage', { getItem: () => settings.padEnd(MAX_STORED_LED_SETTINGS_LENGTH + 1, ' ') })
    const result = restoreLedSettings(preset, preset.profile)
    expect(result.profile).toBe(preset.profile)
    expect(result.notice).not.toBe('')
  })
  it('保存時は5つの利用者設定と失効フラグだけを含め、基準コードなどを含めない', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const preset = workshopPresets[0]
    saveLedSettings(preset, preset.profile)
    expect(setItem).toHaveBeenCalledWith(ledSettingsKey(preset), '{"ledCount":10,"maxBrightnessPercent":20,"ledPin":2,"firmwareVersion":null,"ledModel":null,"verificationInvalidated":true}')
  })
  it.each(LED_MODELS)('%s をそのまま保存して復元する', ledModel => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    const preset = workshopPresets[0]
    expect(saveLedSettings(preset, { ...preset.profile, ledModel })).toContain('自動保存')
    expect(restoreLedSettings(preset, preset.profile).profile).toMatchObject({ ledModel, firmwareVersion: null })
  })
  it('旧3項目は明示保存した版・型番を維持して復元する', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"ledCount":24,"maxBrightnessPercent":15,"ledPin":3}' })
    const preset = workshopPresets[0]
    const profile = { ...preset.profile, firmwareVersion: '2.3.1', ledModel: 'SK6812' }
    expect(restoreLedSettings(preset, profile)).toMatchObject({ profile: { ledCount: 24, maxBrightnessPercent: 15, ledPin: 3, firmwareVersion: '2.3.1', ledModel: 'SK6812' }, notice: '' })
  })
  it('非対応の旧型番だけを未選択へ戻し、ほかの値を維持して再選択を求める', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"ledCount":24,"maxBrightnessPercent":15,"ledPin":3,"firmwareVersion":"2.3.1","ledModel":"custom-rgb"}' })
    const preset = workshopPresets[0]
    const result = restoreLedSettings(preset, preset.profile)
    expect(result.profile).toMatchObject({ ledCount: 24, maxBrightnessPercent: 15, ledPin: 3, firmwareVersion: '2.3.1', ledModel: null })
    expect(result.notice).toContain('選び直してください')
  })
  it.each([{ firmwareVersion: '{{VERSION}}' }, { firmwareVersion: 'line\nbreak' }, { ledModel: 'WS2812' }, { ledModel: 'SK6812-RGBW' }])('不正な型番・版を新規保存しない %o', patch => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const preset = workshopPresets[0]
    expect(saveLedSettings(preset, { ...preset.profile, ...patch })).toContain('不正')
    expect(setItem).not.toHaveBeenCalled()
  })
  it.each(['firmwareVersion', 'ledModel'] as const)('%s の復元差分で古いBLE実機確認を失効させる', field => {
    const preset = workshopPresets[0]
    const profile = { ...preset.profile, firmwareVersion: '2.3.1', ledModel: 'WS2812B', baseline: { code: 'baseline', verification: { code: 'baseline', firmwareVersion: '2.3.1', confirmedBy: 'Tester', confirmedAt: '2026-09-16', nanoLedV1: true } } }
    const settings = { ledCount: 10, maxBrightnessPercent: 20, ledPin: 2, firmwareVersion: '2.3.1', ledModel: 'WS2812B' }
    settings[field] = field === 'firmwareVersion' ? '2.3.2' : 'SK6812'
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(settings) })
    const result = restoreLedSettings(preset, profile)
    expect(result.profile.baseline.code).toBe('baseline')
    expect(result.profile.baseline.verification).toBeNull()
  })
})
