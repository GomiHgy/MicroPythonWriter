import { describe, expect, it } from 'vitest'
import { workshopPresets } from '../config/workshops'
import { buildControllerStarter } from '../services/workshop/ControllerStarter'
import { buildStarterProgram, providerVerifiedStarters, starterAvailability } from '../services/projects/StarterProgram'
import { cloneWorkshopProfile, LED_MODELS, type WorkshopProfile } from '../services/workshop/WorkshopProfile'

function profile(): WorkshopProfile {
  return {
    ...cloneWorkshopProfile(workshopPresets[0].profile),
    firmwareVersion: 'TEST-ONLY-UNVERIFIED',
    ledModel: 'WS2812B',
    features: { button: true, ble: true, controller: true },
  }
}

describe('bundled Web controller starter candidate', () => {
  it.each([
    ['m5nanoc6', 9, 'NanoLED-M5NanoC6'],
    ['atoms3lite', 41, 'NanoLED-AtomS3Lite'],
  ] as const)('maps %s to its own button and advertised name', (boardId, buttonPin, name) => {
    const input = { ...profile(), boardId }
    const { settings, recipe, source } = buildControllerStarter(input)
    expect(settings).toEqual({ boardId, firmwareVersion: input.firmwareVersion, ledModel: 'WS2812B', ledCount: 10, ledPin: 2, maxBrightnessPercent: 20 })
    expect(recipe).toMatchObject({ shortPress: 'next', doublePress: 'none', longPress: 'toggle', whileHeld: false, wireless: true })
    expect(recipe.modes.map(mode => mode.id)).toEqual(['LIGHT', 'RAINBOW'])
    expect(recipe.modes[0]).toMatchObject({ kind: 'solid', color: '#ffff00' })
    expect(recipe.modes[1].kind).toBe('rainbow')
    expect(source).toBe(buildStarterProgram(settings, recipe))
    expect(source).toContain(`"button_pin":${buttonPin}`)
    expect(source).toContain(`"name":"${name}"`)
    expect(source).toContain('"wireless":true')
    expect(source).toContain('"id": "SPARKLE"')
    expect(source).toContain('HARDWARE NOT VERIFIED')
    expect(starterAvailability(settings, recipe).verified).toBe(false)
  })

  it.each(LED_MODELS)('preserves all hardware settings for %s without guessing a firmware version', ledModel => {
    const input = { ...profile(), ledModel, ledCount: 37, ledPin: 3, maxBrightnessPercent: 12.5, firmwareVersion: 'MY-DEVICE-VERSION' }
    const { settings, source } = buildControllerStarter(input)
    expect(settings).toMatchObject({ ledModel, ledCount: 37, ledPin: 3, maxBrightnessPercent: 12.5, firmwareVersion: input.firmwareVersion })
    expect(source).toContain(`"led_model":"${ledModel}"`)
    expect(source).toContain('"led_count":37')
    expect(source).toContain('"led_pin":3')
    expect(source).toContain('"max_brightness":12.5')
    expect(source).toContain('"firmware":"MY-DEVICE-VERSION"')
  })

  it('disables every button gesture when the feature is not selected, but keeps wireless controls', () => {
    const input = profile()
    input.features.button = false
    const { recipe, source } = buildControllerStarter(input)
    expect(recipe).toMatchObject({ shortPress: 'none', doublePress: 'none', longPress: 'none', whileHeld: false, wireless: true })
    expect(source).toContain('"short_press":"none","double_press":"none","long_press":"none"')
    expect(source).toContain('"while_held":false,"wireless":true')
  })

  it('is deterministic and returns fresh settings and recipe objects', () => {
    const input = profile()
    const first = buildControllerStarter(input)
    const second = buildControllerStarter(input)
    expect(first).toEqual(second)
    expect(first.settings).not.toBe(second.settings)
    expect(first.recipe).not.toBe(second.recipe)
    expect(first.recipe.modes[0]).not.toBe(second.recipe.modes[0])
    first.settings.ledCount = 200
    first.recipe.modes[0].label = 'changed'
    expect(buildControllerStarter(input)).toEqual(second)
  })

  it('does not overwrite or fabricate baseline or hardware-verification metadata', () => {
    const input = profile()
    input.baseline = {
      code: '# existing personal baseline',
      verification: { boardId: input.boardId, code: '# existing personal baseline', firmwareVersion: 'OLDER-VERSION', confirmedBy: 'Existing tester', confirmedAt: '2026-01-01T00:00:00.000Z', nanoLedV1: true, nanoLedV2: false },
    }
    const before = structuredClone(input)
    Object.freeze(input.baseline.verification)
    Object.freeze(input.baseline)
    Object.freeze(input.features)
    Object.freeze(input)
    const result = buildControllerStarter(input)
    expect(input).toEqual(before)
    expect(result.source).not.toContain(input.baseline.code)
    expect(result.source).toContain('HARDWARE NOT VERIFIED')
    expect(providerVerifiedStarters).toEqual([])
  })

  it('does not require a pre-existing baseline or hardware verification', () => {
    const input = profile()
    expect(input.baseline).toEqual({ code: '', verification: null })
    expect(() => buildControllerStarter(input)).not.toThrow()
    expect(input.baseline).toEqual({ code: '', verification: null })
  })

  it.each([
    { firmwareVersion: null }, { firmwareVersion: '' }, { firmwareVersion: '{{VERSION}}' }, { firmwareVersion: 'v'.repeat(81) },
    { ledModel: null }, { ledModel: 'RGBW' }, { ledBpp: 4 },
    { ledCount: null }, { ledCount: 0 }, { ledCount: 301 }, { ledCount: 1.5 },
    { ledPin: null }, { ledPin: 9 }, { ledPin: 20 }, { ledPin: 31 }, { ledPin: -1 },
    { maxBrightnessPercent: null }, { maxBrightnessPercent: 0 }, { maxBrightnessPercent: 101 }, { maxBrightnessPercent: Number.NaN },
  ])('rejects incomplete or unsupported settings instead of silently substituting defaults: %j', patch => {
    const input = { ...profile(), ...patch } as WorkshopProfile
    expect(() => buildControllerStarter(input)).toThrow()
  })

  it.each([null, undefined, {}, [], { features: null }, { ...profile(), features: { button: 'false', ble: true, controller: true } }])('rejects malformed runtime inputs: %j', input => {
    expect(() => buildControllerStarter(input as unknown as WorkshopProfile)).toThrow('機器とLEDの設定を確認してください。')
  })
})
