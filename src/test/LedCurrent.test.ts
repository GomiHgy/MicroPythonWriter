import { describe, expect, it } from 'vitest'
import { LED_MODELS } from '../services/workshop/WorkshopProfile'
import { estimateLedCurrent, LED_CURRENT_PROFILES, LED_CURRENT_WARNING_MA, observeLedCurrent, type LedCurrentObservation } from '../services/simulation/LedCurrent'
import workerSource from '../services/simulation/worker.ts?raw'

type Rgb = [number, number, number]
const repeat = (count: number, color: Rgb): Rgb[] => Array.from({ length: count }, () => [...color])

describe('RGB LED current estimates from actual program output', () => {
  it('documents all supported model coefficients and traceable reference sources', () => {
    expect(Object.keys(LED_CURRENT_PROFILES)).toEqual([...LED_MODELS])
    expect(LED_MODELS.map(model => [model, LED_CURRENT_PROFILES[model].channelMa, LED_CURRENT_PROFILES[model].idleMa])).toEqual([
      ['WS2812B', 20, 1], ['WS2812B-MINI', 12, 0.6], ['WS2812C-2020', 5, 0.5], ['SK6812', 20, 1], ['SK6812MINI', 12, 1],
    ])
    for (const profile of Object.values(LED_CURRENT_PROFILES)) {
      expect(profile.reference.length).toBeGreaterThan(10)
      expect(profile.sourceUrl).toMatch(/^https:\/\//)
    }
  })

  it.each(LED_MODELS)('%s includes idle current only for pixels actually emitted', model => {
    expect(estimateLedCurrent([], model)).toBe(0)
    expect(estimateLedCurrent(repeat(10, [0, 0, 0]), model)).toBeCloseTo(10 * LED_CURRENT_PROFILES[model].idleMa)
  })

  it.each(LED_MODELS)('%s sums independent red, green, and blue PWM channels', model => {
    const { idleMa, channelMa } = LED_CURRENT_PROFILES[model]
    for (const pixel of [[255, 0, 0], [0, 255, 0], [0, 0, 255]] as Rgb[]) {
      expect(estimateLedCurrent([pixel], model)).toBeCloseTo(idleMa + channelMa)
    }
    expect(estimateLedCurrent([[255, 255, 255]], model)).toBeCloseTo(idleMa + channelMa * 3)
    expect(estimateLedCurrent([[127, 63, 31]], model)).toBeCloseTo(idleMa + channelMa * 221 / 255)
  })

  it.each(LED_MODELS)('%s uses gain-corrected output without applying RGB gains again', model => {
    const { idleMa, channelMa } = LED_CURRENT_PROFILES[model]
    // 255 * (100%, 70%, 95%) をコード側で整数化した実出力。
    const corrected: Rgb[] = [[255, 178, 242]]
    const result = estimateLedCurrent(corrected, model)
    expect(result).toBeCloseTo(idleMa + channelMa * (255 + 178 + 242) / 255)
    expect(result).toBeLessThan(estimateLedCurrent([[255, 255, 255]], model))
    expect(result).not.toBeCloseTo(idleMa + channelMa * (255 + 178 * 0.7 + 242 * 0.95) / 255)
    // 輝度も送信RGBへ既に適用済み。上限値やリモコン設定を別途掛けない。
    expect(estimateLedCurrent([[51, 35, 48]], model)).toBeCloseTo(idleMa + channelMa * 134 / 255)
  })

  it('compares against 600 mA without rounding and warns only strictly above it', () => {
    const boundary: Rgb[] = Array.from({ length: 60 }, (_, index) => [255, index < 54 ? 255 : 0, 0])
    expect(LED_CURRENT_WARNING_MA).toBe(600)
    expect(estimateLedCurrent(boundary, 'WS2812C-2020')).toBe(600)
    expect(estimateLedCurrent(boundary, 'WS2812C-2020') > LED_CURRENT_WARNING_MA).toBe(false)
    boundary[59][2] = 1
    expect(estimateLedCurrent(boundary, 'WS2812C-2020') > LED_CURRENT_WARNING_MA).toBe(true)
    boundary[59][2] = 0
    boundary[0][1] = 254
    expect(estimateLedCurrent(boundary, 'WS2812C-2020') > LED_CURRENT_WARNING_MA).toBe(false)
  })
})

describe('current observation history', () => {
  it('counts the entire emitted frame independently of the displayed LED count', () => {
    const observation = observeLedCurrent(null, repeat(300, [255, 255, 255]))
    expect(observation.ledCount).toBe(300)
    for (const model of LED_MODELS) {
      expect(observation.currentMa[model]).toBeCloseTo(estimateLedCurrent([[255, 255, 255]], model) * 300)
      expect(observation.peakMa[model]).toBe(observation.currentMa[model])
    }
  })

  it('retains a short bright frame for every model after subsequent dimmer output', () => {
    let observation: LedCurrentObservation | null = null
    const output: Rgb[][] = [repeat(37, [0, 0, 0]), repeat(37, [255, 178, 242]), repeat(10, [5, 1, 0])]
    for (const pixels of output) observation = observeLedCurrent(observation, pixels)
    expect(observation?.ledCount).toBe(10)
    for (const model of LED_MODELS) {
      expect(observation?.currentMa[model]).toBeCloseTo(estimateLedCurrent(output[2], model))
      expect(observation?.peakMa[model]).toBeCloseTo(estimateLedCurrent(output[1], model))
    }
  })

  it('keeps model-specific peaks when idle current and channel output differ', () => {
    const first = observeLedCurrent(null, repeat(300, [0, 0, 0]))
    const second = observeLedCurrent(first, repeat(5, [255, 255, 255]))
    expect(second.peakMa.WS2812B).toBe(305)
    expect(second.peakMa.SK6812MINI).toBe(300)
    expect(first.currentMa.WS2812B).toBe(300)
    expect(first.peakMa.WS2812B).toBe(300)
  })

  it('starts a new peak history only when previous observation is null', () => {
    const initial = observeLedCurrent(null, repeat(50, [255, 255, 255]))
    const afterOff = observeLedCurrent(initial, repeat(50, [0, 0, 0]))
    const restarted = observeLedCurrent(null, repeat(50, [0, 0, 0]))
    for (const model of LED_MODELS) {
      expect(afterOff.peakMa[model]).toBe(initial.currentMa[model])
      expect(restarted.peakMa[model]).toBe(restarted.currentMa[model])
      expect(restarted.peakMa[model]).toBeLessThan(afterOff.peakMa[model])
    }
  })

  it('updates accepted Worker frames before scheduling a throttled UI publication', () => {
    const frameFunction = workerSource.slice(workerSource.indexOf('function frame('), workerSource.indexOf('function bleOutput('))
    expect(frameFunction).toMatch(/snapshot\.pixels = values[\s\S]*snapshot\.ledCurrent = observeLedCurrent\(snapshot\.ledCurrent, snapshot\.pixels\)[\s\S]*schedulePublish\(\)/)
    expect(frameFunction.indexOf('Invalid RGB output')).toBeLessThan(frameFunction.indexOf('observeLedCurrent'))
  })
})
