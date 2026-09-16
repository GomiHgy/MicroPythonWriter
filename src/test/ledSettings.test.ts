import { afterEach, describe, expect, it, vi } from 'vitest'
import { workshopPresets } from '../config/workshops'
import { ledSettingsKey, restoreLedSettings, saveLedSettings } from '../services/workshop/LedSettings'

afterEach(() => vi.unstubAllGlobals())
describe('利用者のLED設定保存', () => {
  it.each(['{', '[]', '{"ledCount":10,"maxBrightnessPercent":20,"ledPin":-1}', '{"ledCount":10,"maxBrightnessPercent":101,"ledPin":2}', 'x'.repeat(501)])('破損・過大・不正データを適用しない %s', raw => {
    vi.stubGlobal('localStorage', { getItem: () => raw })
    const preset = workshopPresets[0]
    const result = restoreLedSettings(preset, preset.profile)
    expect(result.profile).toBe(preset.profile)
    expect(result.notice).not.toBe('')
  })
  it('保存時は3つの数値だけを含める', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const preset = workshopPresets[0]
    saveLedSettings(preset, preset.profile)
    expect(setItem).toHaveBeenCalledWith(ledSettingsKey(preset), '{"ledCount":10,"maxBrightnessPercent":20,"ledPin":2}')
  })
})
