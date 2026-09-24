import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardDefinitions } from '../config/boards'
import { workshopPresets } from '../config/workshops'
import type { Locale } from '../i18n/types'
import { buildLedTransmissionRules } from '../services/prompt/LedTransmissionRules'
import { copyPreparationPrompt, downloadPreparationPrompt } from '../services/prompt/PromptExport'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { DeviceInfo } from '../types'

const locales: Locale[] = ['ja', 'en', 'zh']
const error = { exceptionType: 'DeviceRuntimeError', message: 'captured failure', traceback: 'captured traceback', intentionalInterrupt: false }
const source = '# actual captured artwork\nprint("keep this effect")'
const historicalBaseline = '# test-only historical baseline, not hardware evidence\nimport time\ntime.sleep_us(80)'
const required: Record<Locale, string[]> = {
  ja: ['LED送信のちらつき抑制', '最終GRBバイト列で比較', '前後の待ちだけを省略', '最終送信済みデータを更新せずキャッシュを無効化', '主ループ全体をreturnしない', 'playingなら論理状態を進め', '基準色・output_reference・復帰位相', '固定スナップショットを作業バッファと共有しない', '約1秒周期の通知を止めない', '物理発光の測定ではなく', '実機確認済みにしない', '記録された利用者のmain.py', '演出を同梱サンプルへ置き換えない', '差分と再確認が必要な範囲', 'Webアプリ更新だけでは機器の既存main.pyは変わらない'],
  en: ['LED transmission flicker reduction', 'Compare the final GRB bytes', 'skip only bitstream and its surrounding waits', 'leave the last-sent bytes unchanged, invalidate the cache', 'Never return from the entire main loop', 'continue logical progression while playing', 'reference colors, output_reference and return phase', 'snapshots must not alias a work buffer', 'approximately once-per-second notifications', 'not measured physical light', 'remain unverified on hardware', 'Repair the captured user main.py', 'do not replace its effects with a bundled sample', 'explain the differences and required revalidation', 'Updating the Web app does not change an existing device main.py'],
  zh: ['减少 LED 发送闪烁', '比较最终 GRB 字节', '跳过 bitstream 和前后等待', '不更新最后发送数据，令缓存失效', '不能因为输出相同就 return 整个主循环', 'playing 仍推进逻辑', '基准色、output_reference 和恢复相位', '固定快照不能与工作缓冲区共用', '约每秒一次的通知', '不代表测量了实际发光', '仍不是实机验证', '已记录的用户 main.py', '不用内置示例替换作品效果', '说明差异和需要重新验证的范围', '更新网页应用不会改变设备已有的 main.py'],
}

function configuredProfile(preset: number, mode: 'none' | 'candidate' | 'v1' | 'v2') {
  const profile = cloneWorkshopProfile(workshopPresets[preset].profile)
  profile.firmwareVersion = 'TEST-ONLY-UIFlow2'
  profile.ledModel = 'WS2812B-MINI'
  profile.ledCount = preset ? 88 : 37
  profile.ledPin = preset ? 5 : 2
  profile.maxBrightnessPercent = preset ? 12.5 : 35
  profile.features = { button: true, ble: mode !== 'none', controller: mode !== 'none' }
  if (mode === 'v1' || mode === 'v2') {
    profile.baseline = { code: historicalBaseline, verification: { code: historicalBaseline, boardId: profile.boardId, firmwareVersion: profile.firmwareVersion, confirmedBy: 'test-only', confirmedAt: '2026-09-24', nanoLedV1: mode === 'v1', nanoLedV2: mode === 'v2' } }
  }
  return profile
}

function device(preset: number): DeviceInfo {
  const board = boardDefinitions[workshopPresets[preset].profile.boardId]
  return { boardId: board.id, soc: board.soc, deviceName: board.name, microPythonVersion: 'TEST-ONLY', firmwareInfo: 'TEST-ONLY', nanoC6Confirmed: preset === 0, bootOptionSupported: true, nvsFallbackSupported: false }
}

function expectSharedRules(prompt: string, locale: Locale) {
  expect(prompt.split(buildLedTransmissionRules(locale))).toHaveLength(2)
  for (const text of required[locale]) expect(prompt).toContain(text)
  for (const text of ['bytearray(LED_COUNT * LED_BPP)', 'last_sent_frame[:] = next_frame', 'LED_RESET_US = 350', 'encoding=0', 'WS2812_TIMING_NS = (400, 850, 800, 450)', 'force=True', 'KeyboardInterrupt', 'time.ticks_ms()/time.ticks_diff()', 'pixels']) expect(prompt).toContain(text)
  expect(prompt).toContain('LOW → time.sleep_us(LED_RESET_US)')
  for (const other of locales.filter(value => value !== locale)) expect(prompt).not.toContain(required[other][0])
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('初回・修正の共通LED送信ルール', () => {
  it.each(locales)('%s の両機種・全生成経路に共通対策を一度含め、設定・確認情報を変えない', locale => {
    for (const preset of [0, 1]) for (const mode of ['none', 'candidate', 'v1', 'v2'] as const) {
      const profile = configuredProfile(preset, mode)
      const originalProfile = structuredClone(profile)
      const context = createWorkshopContext(profile, locale)
      const originalContext = structuredClone(context)
      expect(context.errors).toEqual([])
      const repair = new RepairPromptBuilder().build(error, source, device(preset), 'captured log', '実行', context)
      for (const prompt of [buildStartPrompt(context), repair]) {
        expectSharedRules(prompt, locale)
        for (const text of [`LED_COUNT: ${profile.ledCount}`, `LED_PIN: ${profile.ledPin}`, `MAX_BRIGHTNESS_PERCENT: ${profile.maxBrightnessPercent}`, `GPIO${boardDefinitions[profile.boardId].buttonPin}`]) expect(prompt).toContain(text)
        // 旧記録の80µsは全文保持する。現行の生成指示とは分けて検証する。
        const currentInstructions = prompt.replace(historicalBaseline, '')
        expect(currentInstructions).not.toContain('sleep_us(80)')
        if (mode === 'v1' || mode === 'v2') expect(prompt.split(historicalBaseline)).toHaveLength(2)
        if (mode === 'none') expect(prompt).not.toContain('6e400001-b5a3-f393-e0a9-e50e24dcca9e')
      }
      if (mode === 'candidate') {
        expect(context.bleSource).toBe('bundled-candidate')
        expect(context.controllerStarter?.source).toContain('LED_RESET_US = 350')
        expect(context.controllerStarter?.source).toContain('time.sleep_us(LED_RESET_US)')
        expect(context.controllerStarter?.source).not.toContain('sleep_us(80)')
      }
      expect(repair).toContain(source)
      expect(repair).toContain('captured log')
      expect(context).toEqual(originalContext)
      expect(profile).toEqual(originalProfile)
    }
  })

  it.each(locales)('%s の設定不明・実行コード不明な修正にも同じ規則を含め、編集中コードを推測で使わない', locale => {
    const builder = new RepairPromptBuilder()
    const repair = builder.build(error, source, device(0), 'captured log', '実行', null, { locale })
    expectSharedRules(repair, locale)
    expect(repair).toContain(source)
    expect(repair).not.toContain('LED_COUNT:')
    const unknown = builder.build(error, 'DO_NOT_USE_EDITOR_CONTENT', device(0), 'captured log', '実行', null, { locale, sourceKnown: false })
    expectSharedRules(unknown, locale)
    expect(unknown).not.toContain('DO_NOT_USE_EDITOR_CONTENT')
  })

  it.each(locales)('%s へ言語変更しても記録main.py・旧基準コードと確認状態をそのまま保つ', locale => {
    const context = createWorkshopContext(configuredProfile(1, 'v2'), locale === 'ja' ? 'en' : 'ja')
    const before = structuredClone(context)
    const repair = new RepairPromptBuilder().build(error, source, device(1), 'captured log', '実行', context, { locale })
    expectSharedRules(repair, locale)
    expect(repair).toContain(source)
    expect(repair).toContain(historicalBaseline)
    expect(repair.replace(historicalBaseline, '')).not.toContain('sleep_us(80)')
    expect(context).toEqual(before)
  })

  it.each(locales)('%s のクリップボード・UTF-8ファイル保存に同じ対策を含める', async locale => {
    vi.useFakeTimers()
    const prompt = buildStartPrompt(createWorkshopContext(configuredProfile(0, 'none'), locale))
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
    expect((await copyPreparationPrompt(prompt, () => true, () => ({ writeText }))).ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith(prompt)
    expectSharedRules(writeText.mock.calls[0][0], locale)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:led-prompt')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
    expect(downloadPreparationPrompt(prompt, 'm5nanoc6', 'test', () => true).ok).toBe(true)
    const blob = create.mock.calls[0][0] as Blob
    expect(await blob.text()).toBe(prompt)
    expectSharedRules(await blob.text(), locale)
    vi.runAllTimers()
  })
})
