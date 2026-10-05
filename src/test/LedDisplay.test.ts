import { describe, expect, it } from 'vitest'
import { ledDisplayRgb } from '../services/simulation/LedDisplay'

describe('画面専用のLED明るさ補正', () => {
  it('消灯は黒、最大出力は最大のまま、低輝度をsRGBへ変換する', () => {
    expect(ledDisplayRgb([0, 0, 0], 'visible')).toEqual([0, 0, 0])
    expect(ledDisplayRgb([255, 255, 255], 'visible')).toEqual([255, 255, 255])
    expect(ledDisplayRgb([1, 32, 51], 'visible')).toEqual([13, 99, 124])
  })

  it('全256段階のフェード順序を保ち、弱い出力を最大輝度へ正規化しない', () => {
    const fade = Array.from({ length: 256 }, (_, value) => ledDisplayRgb([value, 0, 0], 'visible')[0])
    expect(fade[0]).toBe(0)
    expect(fade[255]).toBe(255)
    for (let index = 1; index < fade.length; index += 1) expect(fade[index]).toBeGreaterThanOrEqual(fade[index - 1])
    expect(fade[1]).toBeLessThan(fade[32])
    expect(fade[32]).toBeLessThan(fade[51])
    expect(fade[51]).toBeLessThan(fade[255])
  })

  it('ゲイン適用済みRGBを変更せず、出力そのまま表示では補正しない', () => {
    const output = Object.freeze([51, 35, 48] as const)
    expect(ledDisplayRgb(output, 'visible')).toEqual([124, 104, 120])
    expect(ledDisplayRgb(output, 'output')).toEqual([51, 35, 48])
    expect(output).toEqual([51, 35, 48])
  })
})
