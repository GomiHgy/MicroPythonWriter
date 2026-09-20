import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { workshopPresets } from '../config/workshops'
import type { Locale } from '../i18n/types'
import { buildMemoryPressureRules } from '../services/prompt/MemoryPressureRules'
import { copyPreparationPrompt, downloadPreparationPrompt } from '../services/prompt/PromptExport'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { DeviceInfo } from '../types'

const locales: Locale[] = ['ja', 'en', 'zh']
const expected = {
  ja: ['メモリ圧迫を防ぐ実装と確認', '必要量だけ確保し再利用', 'ACTION再押下の明示仕様', '無断で無効にしたりしない', '実機未確認の項目', '必須にしない', '安全閾値にしたりしない', '必ず捕捉できるものではない'],
  en: ['Memory-pressure prevention and verification', 'Allocate only the needed LED bytearray', 'explicit repeated-ACTION policy', 'without permission', 'untested on hardware', 'do not require heap analysis', 'universal safety threshold', 'not guaranteed to be caught'],
  zh: ['防止内存压力的实现与验证', '只分配所需大小并重复使用', '明确指定的重复 ACTION 规则', '擅自关闭', '未实机验证的项目', '不要求先分析堆内存', '通用的安全阈值', '不保证能被 Python try/except 捕获'],
}
const error = { exceptionType: 'DeviceRuntimeError', message: 'captured failure', traceback: 'captured traceback', intentionalInterrupt: false }
const device: DeviceInfo = { deviceName: 'M5Stack NanoC6', microPythonVersion: 'test-version', firmwareInfo: 'test-firmware', nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }

function context(locale: Locale, mode: 'none' | 'candidate' | 'v1' | 'v2', preset = 0) {
  const profile = cloneWorkshopProfile(workshopPresets[preset].profile)
  profile.firmwareVersion = 'TEST-ONLY-UIFlow2'
  profile.ledModel = 'WS2812B-MINI'
  profile.features = { button: true, ble: mode !== 'none', controller: mode !== 'none' }
  if (mode === 'v1' || mode === 'v2') {
    const code = '# Synthetic fixture only\nprint("baseline-preserved")'
    profile.baseline = { code, verification: { code, boardId: profile.boardId, firmwareVersion: profile.firmwareVersion, confirmedBy: 'test-only', confirmedAt: '2026-09-20', nanoLedV1: mode === 'v1', nanoLedV2: mode === 'v2' } }
  }
  return createWorkshopContext(profile, locale)
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('AI準備・修正依頼のメモリ圧迫対策', () => {
  it.each(locales)('%s は候補・登録済みv1/v2と両機種に同じ対策を一度だけ含め、設定と基準コードを変更しない', locale => {
    for (const mode of ['candidate', 'v1', 'v2'] as const) {
      for (const preset of [0, 1]) {
        const configured = context(locale, mode, preset)
        const before = structuredClone(configured)
        const start = buildStartPrompt(configured)
        const repair = new RepairPromptBuilder().build(error, '# original artwork', device, 'original log', '実行', configured)
        const rules = buildMemoryPressureRules(locale, true)
        for (const prompt of [start, repair]) {
          expect(prompt.split(rules)).toHaveLength(2)
          for (const part of expected[locale]) expect(prompt).toContain(part)
          for (const part of ['bytearray', 'gc.collect()', 'gc.mem_free()', 'esp32.idf_heap_info(esp32.HEAP_DATA)', 'LED_COUNT: 10', 'MAX_BRIGHTNESS_PERCENT: 20']) expect(prompt).toContain(part)
          expect(prompt).not.toMatch(/33[,.]?408|192[,.]?068|11[,.]?824/)
          if (mode !== 'candidate') expect(prompt).toContain(configured.profile.baseline.code)
        }
        expect(repair).toContain('# original artwork')
        expect(repair).toContain('original log')
        expect(configured).toEqual(before)
      }
    }
  })

  it.each(locales)('%s のBLE無効な準備と修正は一般対策のみでBLEの調査・初期化を追加させない', locale => {
    const configured = context(locale, 'none')
    const rules = buildMemoryPressureRules(locale, false)
    for (const prompt of [buildStartPrompt(configured), new RepairPromptBuilder().build(error, 'source', device, 'log', '実行', configured)]) {
      expect(prompt.split(rules)).toHaveLength(2)
      expect(prompt).toContain(expected[locale][0])
      expect(prompt).toContain('gc.collect()')
      expect(prompt).not.toContain('esp32.idf_heap_info')
      expect(prompt).not.toContain('BLE.active(')
    }
  })

  it.each(locales)('%s の設定不明な修正にも対策を一度だけ含める', locale => {
    const repair = new RepairPromptBuilder().build(error, 'original code', device, 'original log', '実行', null, { locale })
    expect(repair.split(buildMemoryPressureRules(locale, true))).toHaveLength(2)
    expect(repair).toContain('original code')
    expect(repair).toContain('original log')
    expect(repair).not.toContain('LED_COUNT:')
  })

  it.each(locales)('%s へ言語変更した修正は以前の言語を混ぜず対策と元データを維持する', locale => {
    const configured = context(locale === 'ja' ? 'en' : 'ja', 'candidate')
    const before = structuredClone(configured)
    const repair = new RepairPromptBuilder().build(error, '# preserve code', device, 'preserve log', '実行', configured, { locale })
    expect(repair.split(buildMemoryPressureRules(locale, true))).toHaveLength(2)
    for (const other of locales.filter(value => value !== locale)) expect(repair).not.toContain(expected[other][0])
    expect(configured).toEqual(before)
  })

  it.each(locales)('%s の準備文をコピー・UTF-8保存しても対策は省略されない', async locale => {
    vi.useFakeTimers()
    const prompt = buildStartPrompt(context(locale, 'candidate'))
    const writeText = vi.fn(async () => {})
    expect((await copyPreparationPrompt(prompt, () => true, () => ({ writeText }))).ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith(prompt)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:memory-prompt')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
    expect(downloadPreparationPrompt(prompt, 'm5nanoc6', 'test', () => true).ok).toBe(true)
    const blob = create.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/plain;charset=utf-8')
    expect(await blob.text()).toBe(prompt)
    vi.runAllTimers()
  })

  it('原典と準備仕様にも同じ安全範囲とメモリ対策を記載する', () => {
    const canonical = readFileSync('prompt.md', 'utf8')
    const documentation = readFileSync('docs/ai-preparation.md', 'utf8')
    for (const text of [canonical, documentation]) {
      for (const part of ['メモリ圧迫対策', 'gc.collect()', 'ACTION再押下', '最大連続領域', '再コンパイル', '安全閾値']) expect(text).toContain(part)
    }
    expect(documentation).toContain('MemoryPressureRules.ts')
  })
})
