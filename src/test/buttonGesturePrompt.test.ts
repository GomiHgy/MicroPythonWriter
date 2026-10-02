import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { workshopPresets } from '../config/workshops'
import type { Locale } from '../i18n/types'
import { buildButtonGestureQuestion, buildButtonGestureRules } from '../services/prompt/ButtonGestureRules'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { DeviceInfo } from '../types'

const locales: Locale[] = ['ja', 'en', 'zh']
const source = '# existing artwork\nLONG_PRESS_MS = 800\nprint("preserve original")'
const error = { exceptionType: 'DeviceRuntimeError', message: 'test failure', traceback: 'test traceback', intentionalInterrupt: false }
const device: DeviceInfo = { deviceName: 'M5Stack NanoC6', microPythonVersion: 'test', firmwareInfo: 'test', nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }

function context(locale: Locale, preset: number, button: boolean, mode: 'none' | 'candidate' | 'v1' | 'v2') {
  const profile = cloneWorkshopProfile(workshopPresets[preset].profile)
  profile.firmwareVersion = 'TEST-ONLY'
  profile.ledModel = 'WS2812B'
  profile.features = { button, ble: mode !== 'none', controller: mode !== 'none' }
  if (mode === 'v1' || mode === 'v2') {
    profile.baseline = { code: source, verification: { code: source, boardId: profile.boardId, firmwareVersion: profile.firmwareVersion, confirmedBy: 'test-only', confirmedAt: '2026-10-01', nanoLedV1: mode === 'v1', nanoLedV2: mode === 'v2' } }
  }
  return createWorkshopContext(profile, locale)
}

describe('物理ボタンの3種類の押し方を相談する準備文', () => {
  it.each(locales)('%s の両機種・BLEなし/候補/v1/v2にルールと質問を1回含める', locale => {
    for (const preset of [0, 1]) for (const mode of ['none', 'candidate', 'v1', 'v2'] as const) {
      const configured = context(locale, preset, true, mode)
      const before = structuredClone(configured)
      expect(configured.errors).toEqual([])
      const prompt = buildStartPrompt(configured)
      expect(prompt.split(buildButtonGestureRules(locale, true))).toHaveLength(2)
      expect(prompt.split(buildButtonGestureQuestion(locale, true))).toHaveLength(2)
      for (const value of ['LONG_PRESS_MS = 1000', 'DOUBLE_CLICK_MS = 350', 'time.ticks_ms()/time.ticks_diff()']) expect(prompt).toContain(value)
      if (mode === 'v1' || mode === 'v2') expect(prompt).toContain(source)
      expect(configured).toEqual(before)
    }
  })

  it.each(locales)('%s の本体ボタンOFFでは新しい押し方のルールも質問も出さない', locale => {
    for (const preset of [0, 1]) for (const mode of ['none', 'candidate', 'v1', 'v2'] as const) {
      const configured = context(locale, preset, false, mode)
      const prompt = buildStartPrompt(configured)
      expect(prompt).not.toContain(buildButtonGestureRules(locale, true))
      expect(prompt).not.toContain(buildButtonGestureQuestion(locale, true))
      expect(buildButtonGestureRules(locale, false)).toBe('')
      expect(buildButtonGestureQuestion(locale, false)).toBe('')
    }
  })

  it.each(locales)('%s は最大6問・1回1問を守り、不要な質問・勝手な追加を避ける', locale => {
    const question = buildButtonGestureQuestion(locale, true)
    const expected = {
      ja: ['シングルクリックだけ / ダブルクリックも使う / 1秒長押しも使う / 3種類すべて使う / おまかせ', '最大6問', '1回に1問', 'Webリモコンだけ・自動動作だけ', '回答済み', 'ほかの押し方を勝手に追加しない'],
      en: ['Single click only / Add double click / Add 1-second long press / Use all three / Choose for me', 'maximum 6 questions', 'one question per reply', 'Web-remote-only or automatic-only', 'already answered', 'do not silently add other gestures'],
      zh: ['只用单击 / 增加双击 / 增加长按 1 秒 / 三种都用 / 帮我决定', '最多 6 题', '每次只问一题', '仅用网页遥控器、仅自动运行', '已经回答', '不擅自增加其他手势'],
    }
    for (const value of expected[locale]) expect(question).toContain(value)
    for (const other of locales.filter(item => item !== locale)) expect(question).not.toContain(expected[other][0])
  })

  it.each(locales)('%s は重複発火とブロッキングを防ぎ、修正時に既存動作を上書きしない', locale => {
    const configured = context(locale, 0, true, 'v2')
    const before = structuredClone(configured)
    const prompt = new RepairPromptBuilder().build(error, source, device, 'log', '実行', configured)
    const expected = {
      ja: ['シングルクリックを重ねない', '2回目が長押しなら保留中の1回目も発火させない', 'クリック待ち・長押し待ちにsleepを使わず', '押し方を追加したり時間を変更したりする許可とは扱わない', '保存コード・確認記録は変更せず'],
      en: ['no extra single clicks', 'a long second press must not also trigger the first pending single click', 'Never sleep for the click window or hold duration', 'not permission to add gestures or change timing during repairs', 'Existing stored code and verification records remain unchanged'],
      zh: ['不额外触发单击', '第二次按下变为长按时，不能同时触发待定的首次单击', '不能用 sleep 等待双击窗口或长按时长', '不是修复既有作品或登记基准代码时添加手势或更改时长的许可', '已保存代码和验证记录不变'],
    }
    for (const value of expected[locale]) expect(prompt).toContain(value)
    expect(prompt).toContain(source)
    expect(prompt).not.toContain(buildButtonGestureQuestion(locale, true))
    expect(configured).toEqual(before)
  })

  it('手動のprompt.mdも1000ms標準と質問条件、旧候補の非変更を区別する', () => {
    const prompt = readFileSync(new URL('../../prompt.md', import.meta.url), 'utf8')
    for (const value of ['LONG_PRESS_MS = 1000', 'DOUBLE_CLICK_MS = 350', 'シングルクリックだけ／ダブルクリックも使う／1秒長押しも使う／3種類すべて使う／おまかせ', '本体ボタンがOFF、Webリモコンだけ、自動動作だけの場合は質問しない', '既存候補コード（長押し800ms）や保存済み作品を自動変更する意味ではない', '2回目が長押しのときも保留中の1回目を発火させず']) expect(prompt).toContain(value)
  })
})
