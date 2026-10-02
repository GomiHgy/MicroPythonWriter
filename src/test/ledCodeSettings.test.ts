import { describe, expect, it } from 'vitest'
import { applyLedCodeSettings, readLedCodeSettings } from '../services/editor/ledCodeSettings'

describe('コード内LED設定', () => {
  it('コメント・文字列・演出・CRLFを保持し、数値だけ変更する', () => {
    const source = '# LED_COUNT = 999\r\nLED_COUNT: int = 37 # 個数\r\nMAX_BRIGHTNESS = 0.2 # 最大\r\nprint("LED_COUNT = 5")\r\n'
    expect(readLedCodeSettings(source).brightness.setting?.value).toBe(20)
    expect(applyLedCodeSettings(source, { count: 10, brightness: 35 })).toBe(source.replace('= 37', '= 10').replace('= 0.2', '= 0.35'))
  })
  it('NUM_LEDSとパーセント形式も読み書きする', () => {
    const source = 'NUM_LEDS = 10\nMAX_BRIGHTNESS_PERCENT = 20\n'
    expect(applyLedCodeSettings(source, { count: 37, brightness: 12.5 })).toBe('NUM_LEDS = 37\nMAX_BRIGHTNESS_PERCENT = 12.5\n')
  })
  it.each([0, 100, 12.5, 29, 7, 0.00000001])('最大輝度%sパーセントで往復できる', brightness => {
    const changed = applyLedCodeSettings('MAX_BRIGHTNESS = 0.2', { brightness })!
    expect(readLedCodeSettings(changed).brightness.setting?.value).toBeCloseTo(brightness)
  })
  it.each([
    'LED_COUNT = 10\nLED_COUNT = 20', 'LED_COUNT = 10\nNUM_LEDS = 20',
    'LED_COUNT = 10\ndef reset():\n    global LED_COUNT\n    LED_COUNT = 20',
    'LED_COUNT = 10\nLED_COUNT += 1',
  ])('重複や再代入を変更しない: %s', source => {
    expect(readLedCodeSettings(source).count.reason).toBe('ambiguous')
    expect(applyLedCodeSettings(source, { count: 12 })).toBeNull()
  })
  it.each(['LED_COUNT, x = 10', 'LED_COUNT = 5 * 2', 'LED_COUNT = const(10)', 'if True:\n    LED_COUNT = 10', 'LED_COUNT = other = 10', 'other = LED_COUNT = 10', 'LED_COUNT = 10; print(1)', 'LED_COUNT = 0', 'LED_COUNT = 1.5', 'LED_COUNT = 0x10'])('非対応形式を変更しない: %s', source => {
    expect(readLedCodeSettings(source).count.setting).toBeUndefined()
    expect(applyLedCodeSettings(source, { count: 12 })).toBeNull()
  })
  it('文字列やコメントの偽設定を無視する', () => {
    expect(readLedCodeSettings('"""LED_COUNT = 10\nMAX_BRIGHTNESS = 0.2"""\n# NUM_LEDS = 10').count.reason).toBe('missing')
  })
  it('構文エラーのあるコードは変更しない', () => {
    expect(applyLedCodeSettings('LED_COUNT = 10\nif (', { count: 12 })).toBeNull()
  })
  it.each([NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER])('不正な個数%sを拒否する', count => {
    expect(applyLedCodeSettings('LED_COUNT = 10', { count })).toBeNull()
  })
  it.each([NaN, Infinity, -1, 101])('不正な輝度%sを拒否する', brightness => {
    expect(applyLedCodeSettings('MAX_BRIGHTNESS = 0.2', { brightness })).toBeNull()
  })
  it('曖昧な輝度単位を推測しない', () => {
    expect(applyLedCodeSettings('MAX_BRIGHTNESS = 20', { brightness: 30 })).toBeNull()
  })
  it('変更なしなら元の表記を維持する', () => {
    expect(applyLedCodeSettings('MAX_BRIGHTNESS = .20', { brightness: 20 })).toBe('MAX_BRIGHTNESS = .20')
  })
  it('片方だけ読める場合も独立して変更できる', () => {
    expect(applyLedCodeSettings('LED_COUNT = 10\nMAX_BRIGHTNESS = get_limit()', { count: 30 })).toBe('LED_COUNT = 30\nMAX_BRIGHTNESS = get_limit()')
  })
})
