import { describe, expect, it } from 'vitest'
import { supportedLocales } from '../i18n/locales'
import { translate } from '../i18n'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { buildLanguageRecoveryPrompt } from '../services/prompt/LanguageRecoveryPrompt'
import { workshopPresets } from '../config/workshops'
import { cloneWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { DeviceInfo } from '../types'

const device: DeviceInfo = { deviceName: 'M5Stack NanoC6', microPythonVersion: 'probe-original-version', firmwareInfo: 'probe-original-firmware', bootOption: 1, nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }
const error = { exceptionType: 'ValueError', message: '元のエラー 原文', traceback: 'Traceback:\n  File "main.py", line 2\nValueError: 原文', intentionalInterrupt: false }
const source = '# 元の作品 / 原始作品 / 원본\nprint("do not translate")\r\n'
const log = 'USB元ログ\r\nBLE原文\n末尾'
const builder = new RepairPromptBuilder()
const extra = supportedLocales.filter(item => !['ja', 'en', 'zh'].includes(item.id))

function profile() {
  return { ...cloneWorkshopProfile(workshopPresets[0].profile), firmwareVersion: 'TEST-ONLY-UIFlow2', ledModel: 'WS2812B', ledCount: 37, maxBrightnessPercent: 20, features: { button: true, ble: true, controller: true } }
}

describe('追加6言語のAI依頼', () => {
  it.each(extra)('$id は質問・回答・コメントの言語を指定し、MicroPython・安全設定を維持する', ({ id, aiLanguage }) => {
    const selected = profile()
    const snapshot = structuredClone(selected)
    const context = createWorkshopContext(selected, id)
    expect(context.errors).toEqual([])
    expect(context.locale).toBe(id)
    const start = buildStartPrompt(context)
    const repair = builder.build(error, source, device, log, 'RUN', context)
    const unknownRepair = builder.build(error, source, device, log, 'RUN', null, { locale: id })
    const recovery = buildLanguageRecoveryPrompt(context, id)
    for (const prompt of [start, repair, unknownRepair, recovery]) {
      expect(prompt).toContain(`Response language: ${aiLanguage}.`)
      expect(prompt).not.toContain('Respond in English.')
      expect(prompt).not.toContain('Write English comments.')
      expect(prompt).toContain('MicroPython')
      expect(prompt).toContain('Arduino/C++')
      expect(prompt).toContain('complete main.py')
      expect(/(?:^|\n)undefined(?:\n|$)/.test(prompt)).toBe(false)
    }
    expect(start).toContain(`Write ${aiLanguage} comments.`)
    expect(start).toContain('LED_COUNT: 37')
    expect(start).toContain('MAX_BRIGHTNESS_PERCENT: 20')
    expect(start).toContain('LONG_PRESS_MS = 1000')
    expect(start).toContain('DOUBLE_CLICK_MS = 350')
    expect(start).toContain('RGB_GAIN_G = 0.7')
    expect(start).toContain('4096')
    expect(start).toContain('16')
    expect(start).toContain('Do not import neopixel')
    expect(start).toContain('machine.bitstream')
    expect(start).toContain('200')
    expect(repair).toContain(source)
    expect(repair).toContain(log)
    expect(repair).toContain(error.traceback)
    expect(repair).toContain(error.message)
    expect(selected).toEqual(snapshot)
  })
  it.each(extra)('$id の言語切替でも登録基準コードは原文を維持する', ({ id }) => {
    const selected = profile()
    selected.baseline = { code: source, verification: { code: source, firmwareVersion: selected.firmwareVersion!, confirmedBy: '確認者原文', confirmedAt: '2026-10-06T00:00:00.000Z', nanoLedV1: true, nanoLedV2: true } }
    const context = createWorkshopContext(selected, id)
    expect(context.bleSource).toBe('registered')
    expect(context.rules).toContain(source)
    expect(context.rules).toContain('確認者原文')
    expect(context.profile).toEqual(selected)
  })
  it.each(extra)('$id の無効な設定はコード生成を抑止する', ({ id }) => {
    const context = createWorkshopContext({ ...profile(), ledCount: 0 }, id)
    expect(context.errors.length).toBeGreaterThan(0)
    expect(buildStartPrompt(context)).toBe('')
  })
  it.each(extra)('$id の対応プログラム作成不可を日本語へ戻さず説明する', ({ id }) => {
    const context = createWorkshopContext({ ...profile(), ledPin: 9 }, id)
    expect(context.errors).toEqual([])
    expect(context.controllerStarter).toBeUndefined()
    const key = '対応プログラムを準備できません。機器・UIFlow2版・RGB LED数（1〜300個）・外部LEDピン・最大輝度の設定を確認してください。'
    expect(context.controllerStarterError).toBe(translate(id, key))
    expect(context.controllerStarterError).not.toBe(key)
  })
})
