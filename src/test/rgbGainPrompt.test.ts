import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workshopPresets } from '../config/workshops'
import type { BaseLocale as Locale } from '../i18n/types'
import { copyPreparationPrompt, downloadPreparationPrompt } from '../services/prompt/PromptExport'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { buildRgbGainRules } from '../services/prompt/RgbGainRules'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { DeviceInfo } from '../types'

const locales: Locale[] = ['ja', 'en', 'zh']
const error = { exceptionType: 'DeviceRuntimeError', message: 'test failure', traceback: 'test traceback', intentionalInterrupt: false }
const device: DeviceInfo = { deviceName: 'M5Stack NanoC6', microPythonVersion: 'test', firmwareInfo: 'test', nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }
const source = '# captured artwork\nRGB_GAIN_G = 0.8\nprint("preserve actual source")'
const expected: Record<Locale, string[]> = {
  ja: ['利用者に質問しない内部パラメータ', '質問・選択肢・確認必須項目にしない', '各チャンネルのゲインを一度だけ', '本体ボタン・BLE・単色・アニメーション・ACTION・消灯', '補間の始点と終点を同じ補正済み出力空間', '補正前の基準色から再計算', '最大輝度を上げたり色を再正規化したりしない', '100%/70%/95%をさらに掛けない', '既存コードが未補正なら', '重複追加しない', '黙って上書きしない'],
  en: ['internal parameters, not interview questions', 'do not ask users about these gains', 'channel gain exactly once', 'onboard-button, BLE, solid-color, animation, ACTION and OFF', 'Interpolate endpoints in the same corrected output space', 'Recalculate brightness changes from uncorrected reference colors', 'never raise the brightness cap or renormalize colors', 'do not multiply by 100%/70%/95% again', 'If existing code lacks correction', 'do not add it twice', 'rather than silently overwriting'],
  zh: ['内部参数，不作为用户问题', '不要向用户询问增益', '各通道增益仅乘一次', '机身按钮、BLE、单色、动画、ACTION 和熄灭', '插值两端必须处于同一已校正输出空间', '亮度变化从未校正的基准色重新计算', '不能为补偿校正而提高亮度上限或重新归一化颜色', '不能再乘 100%/70%/95%', '若既有代码未校正', '不能重复添加', '不静默覆盖'],
}

function context(locale: Locale, preset: number, mode: 'none' | 'candidate' | 'v1' | 'v2') {
  const profile = cloneWorkshopProfile(workshopPresets[preset].profile)
  profile.firmwareVersion = 'TEST-ONLY'
  profile.ledModel = 'WS2812B-MINI'
  profile.ledCount = 37
  profile.maxBrightnessPercent = 20
  profile.features = { button: true, ble: mode !== 'none', controller: mode !== 'none' }
  if (mode === 'v1' || mode === 'v2') {
    profile.baseline = { code: source, verification: { code: source, boardId: profile.boardId, firmwareVersion: profile.firmwareVersion, confirmedBy: 'test-only', confirmedAt: '2026-10-01', nanoLedV1: mode === 'v1', nanoLedV2: mode === 'v2' } }
  }
  return createWorkshopContext(profile, locale)
}

function expectGainPolicy(prompt: string, locale: Locale) {
  expect(prompt.split(buildRgbGainRules(locale))).toHaveLength(2)
  for (const value of ['RGB_GAIN_R = 1.0', 'RGB_GAIN_G = 0.7', 'RGB_GAIN_B = 0.95', 'last_sent_frame', 'pixels', 'int(clamp(channel, 0, 255) * maximum_level * user_level * fade_level * channel_gain)', ...expected[locale]]) expect(prompt).toContain(value)
  for (const other of locales.filter(item => item !== locale)) expect(prompt).not.toContain(expected[other][0])
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('AIに質問させないRGBゲイン補正', () => {
  it.each(locales)('%s の両機種とBLE無効・候補・v1・v2の初回/修正に一度ずつ含める', locale => {
    for (const preset of [0, 1]) for (const mode of ['none', 'candidate', 'v1', 'v2'] as const) {
      const configured = context(locale, preset, mode)
      const before = structuredClone(configured)
      expect(configured.errors).toEqual([])
      const start = buildStartPrompt(configured)
      const repair = new RepairPromptBuilder().build(error, source, device, 'captured log', '実行', configured)
      for (const prompt of [start, repair]) {
        expectGainPolicy(prompt, locale)
        expect(prompt).toContain('LED_COUNT: 37')
        expect(prompt).toContain('MAX_BRIGHTNESS_PERCENT: 20')
      }
      expect(repair).toContain(source)
      if (mode === 'v1' || mode === 'v2') expect(start).toContain(source)
      expect(configured).toEqual(before)
    }
  })

  it.each(locales)('%s の設定不明な修正にも二重補正防止を含め、未取得ソースを推測しない', locale => {
    const builder = new RepairPromptBuilder()
    expectGainPolicy(builder.build(error, source, device, 'log', '実行', null, { locale }), locale)
    const unknown = builder.build(error, 'DO_NOT_USE_EDITOR', device, 'log', '実行', null, { locale, sourceKnown: false })
    expectGainPolicy(unknown, locale)
    expect(unknown).not.toContain('DO_NOT_USE_EDITOR')
  })

  it.each(locales)('%s に修正依頼の言語を切り替えても既存ゲインと確認記録を書き換えない', locale => {
    const configured = context(locale === 'ja' ? 'en' : 'ja', 0, 'v2')
    const before = structuredClone(configured)
    const prompt = new RepairPromptBuilder().build(error, source, device, 'log', '実行', configured, { locale })
    expectGainPolicy(prompt, locale)
    expect(prompt).toContain(source)
    expect(configured).toEqual(before)
  })

  it.each(locales)('%s のコピーとUTF-8保存に同じゲイン規則を渡す', async locale => {
    vi.useFakeTimers()
    const prompt = buildStartPrompt(context(locale, 0, 'none'))
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
    expect((await copyPreparationPrompt(prompt, () => true, () => ({ writeText }))).ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith(prompt)
    expectGainPolicy(writeText.mock.calls[0][0], locale)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rgb-gain')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
    expect(downloadPreparationPrompt(prompt, 'm5nanoc6', 'test', () => true).ok).toBe(true)
    const blob = create.mock.calls[0][0] as Blob
    expectGainPolicy(await blob.text(), locale)
    vi.runAllTimers()
  })

  it('手動で渡すprompt.mdにも同じRGB順・非質問・二重補正防止を残す', () => {
    const prompt = readFileSync(new URL('../../prompt.md', import.meta.url), 'utf8')
    for (const value of ['RGB_GAIN_R = 1.0', 'RGB_GAIN_G = 0.7', 'RGB_GAIN_B = 0.95', '赤/緑/青 = 100%/70%/95%', '利用者に質問しない内部パラメータ', '100%/70%/95%を再度掛けない', '補正済みスナップショットやpixelsへ重複適用していないか']) expect(prompt).toContain(value)
  })
})
