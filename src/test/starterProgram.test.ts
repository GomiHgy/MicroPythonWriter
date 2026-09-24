import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildStarterProgram, providerVerifiedStarters, starterAvailability } from '../services/projects/StarterProgram'
import type { ProjectRecipe, ProjectSettings } from '../services/projects/types'
import runtime from '../../firmware/starter/runtime.py?raw'

const settings = (): ProjectSettings => ({ boardId: 'm5nanoc6', firmwareVersion: 'provider-test-only', ledModel: 'WS2812B', ledCount: 10, ledPin: 2, maxBrightnessPercent: 20 })
const recipe = (): ProjectRecipe => ({ modes: [{ id: 'WARM', label: 'あたたかい光', icon: 'light', kind: 'solid', color: '#ffcc00', speed: 50, repeats: 0, endState: 'hold' }], shortPress: 'next', doublePress: 'none', longPress: 'toggle', whileHeld: false, wireless: false })
const pythonCommands = ['python3', 'python', ...(process.platform === 'win32' ? ['py', `${process.env.USERPROFILE}/.platformio/penv/Scripts/python.exe`] : [])]
const python = pythonCommands.find(command => spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0)
const ledCounts = [1, 37, 88, 90, 110, 300]
const generationCases = (['m5nanoc6', 'atoms3lite'] as const).flatMap(boardId => ledCounts.flatMap(ledCount => [false, true].map(wireless => ({ boardId, ledCount, wireless }))))

describe('starter generator', () => {
  it('keeps provider verification empty and never promotes a user recipe', () => {
    expect(providerVerifiedStarters).toEqual([])
    expect(Object.isFrozen(providerVerifiedStarters)).toBe(true)
    for (const boardId of ['m5nanoc6', 'atoms3lite'] as const) {
      for (const wireless of [false, true]) {
        expect(starterAvailability({ ...settings(), boardId }, { ...recipe(), wireless })).toEqual({ verified: false, reason: expect.stringContaining('提供側実機確認') })
      }
    }
  })

  it('is deterministic, explicit about unverified status, and imports no external package', () => {
    const source = buildStarterProgram(settings(), recipe())
    expect(source).toBe(buildStarterProgram(settings(), recipe()))
    expect(source).toContain('HARDWARE NOT VERIFIED')
    expect(source).toContain('WS2812_TIMING_NS = (400, 850, 800, 450)')
    expect(source).toContain('LED_RESET_US = 350')
    expect(source).not.toMatch(/sleep_us\(80\)/)
    expect(source).toContain('FADE_IN_MS = 200')
    expect(source).toContain('REMOTE_OFF_FADE_MS = 200')
    expect(source).toContain('DOUBLE_PRESS_MS = 350')
    expect(source).toContain('LONG_PRESS_MS = 800')
    expect(source).toContain('machine.bitstream(self.pin, 0, WS2812_TIMING_NS, self.buffer)')
    expect(source).not.toContain('import neopixel')
    expect(source).not.toContain('import random')
    expect(source).toContain('"button_pin":9')
    expect(source).toContain('"wireless":false')
    expect(source).toContain('if CONFIG["wireless"]:')
  })

  it.each(generationCases)('embeds the updated runtime unchanged for $boardId / $ledCount LEDs / wireless=$wireless', ({ boardId, ledCount, wireless }) => {
    const input = { ...settings(), boardId, ledCount, ledPin: boardId === 'm5nanoc6' ? 3 : 4, maxBrightnessPercent: 12.5 }
    const design = { ...recipe(), wireless }
    const before = structuredClone({ input, design })
    const source = buildStarterProgram(input, design)
    expect(source.endsWith(runtime)).toBe(true)
    expect(source).toContain(`"led_count":${ledCount},`)
    expect(source).toContain(`"led_pin":${input.ledPin},`)
    expect(source).toContain('"max_brightness":12.5,')
    expect(source).toContain(`"button_pin":${boardId === 'm5nanoc6' ? 9 : 41},`)
    expect(source).toContain('self.buffer = bytearray(self.count * 3)')
    expect(source).toContain('self.last_sent_buffer = bytearray(self.count * 3)')
    expect(source).toContain('self.last_sent_buffer[:] = self.buffer')
    expect(source).toContain('self.write(force=True)')
    expect(source).toContain('LED_RESET_US = 350')
    expect(source).toContain('machine.bitstream(self.pin, 0, WS2812_TIMING_NS, self.buffer)')
    expect(source).not.toContain('time.sleep_us(80)')
    expect(source).not.toMatch(/self\.count\s*=.*\+\s*2/)
    expect(source).toContain('self.playback = "off"')
    expect(source).toContain('HARDWARE NOT VERIFIED')
    expect(starterAvailability(input, design).verified).toBe(false)
    expect({ input, design }).toEqual(before)
  })

  it('maps AtomS3Lite button separately, not to NanoC6 pin', () => {
    const source = buildStarterProgram({ ...settings(), boardId: 'atoms3lite' }, { ...recipe(), wireless: true })
    expect(source).toContain('"button_pin":41')
    expect(source).toContain('NanoLED-AtomS3Lite')
    expect(source).toContain('"wireless":true')
    expect(source).not.toContain('"button_pin":9')
  })

  it('encodes independent actions for all three gestures without changing verification', () => {
    for (const shortPress of ['next', 'toggle', 'none'] as const) {
      for (const doublePress of ['next', 'toggle', 'none'] as const) {
        for (const longPress of ['next', 'toggle', 'none'] as const) {
          const value = { ...recipe(), shortPress, doublePress, longPress }
          const source = buildStarterProgram(settings(), value)
          expect(source).toContain(`"short_press":"${shortPress}"`)
          expect(source).toContain(`"double_press":"${doublePress}"`)
          expect(source).toContain(`"long_press":"${longPress}"`)
          expect(starterAvailability(settings(), value).verified).toBe(false)
        }
      }
    }
  })

  it('preserves the old long-press off operation without reinterpreting it as toggle', () => {
    const source = buildStarterProgram(settings(), { ...recipe(), longPress: 'off' })
    expect(source).toContain('"long_press":"off"')
    expect(source).toContain('"double_press":"none"')
  })

  it.each([
    { shortPress: 'off' }, { shortPress: undefined },
    { doublePress: 'off' }, { doublePress: 'invalid' }, { doublePress: undefined }, { doublePress: null },
    { longPress: 'invalid' }, { longPress: undefined },
  ])('rejects invalid or incomplete gesture settings %j', patch => {
    const value = { ...recipe(), ...patch } as unknown as ProjectRecipe
    expect(() => buildStarterProgram(settings(), value)).toThrow('ボタン・無線の操作設定が不正です。')
    expect(starterAvailability(settings(), value).verified).toBe(false)
  })

  it.each([
    { ledCount: 0 }, { ledCount: 301 }, { ledCount: 1.5 },
    { ledPin: -1 }, { ledPin: 31 }, { ledPin: 9 }, { ledPin: 20 }, { ledPin: 19 }, { ledPin: 7 },
    { maxBrightnessPercent: 0 }, { maxBrightnessPercent: 101 }, { maxBrightnessPercent: Number.NaN },
    { firmwareVersion: '' }, { firmwareVersion: '\n2.0' }, { firmwareVersion: 'a'.repeat(81) },
  ])('rejects invalid hardware config %j', patch => {
    expect(() => buildStarterProgram({ ...settings(), ...patch }, recipe())).toThrow()
    expect(starterAvailability({ ...settings(), ...patch }, recipe()).verified).toBe(false)
  })

  it.each(['OFF', 'PLAY', 'lower', 'A;print(1)', 'THIRTEENCHARS'])('rejects unsafe mode IDs %s', id => {
    const value = recipe()
    value.modes[0].id = id
    expect(() => buildStarterProgram(settings(), value)).toThrow()
  })

  it.each([
    { label: '' }, { label: 'a'.repeat(25) }, { label: '\u202ehidden' }, { label: '\uD800' }, { label: 'hello\n' },
    { color: 'red' }, { speed: -1 }, { speed: 101 }, { repeats: 1.5 }, { repeats: 101 },
  ])('rejects invalid effects %j', patch => {
    const value = recipe()
    Object.assign(value.modes[0], patch)
    expect(() => buildStarterProgram(settings(), value)).toThrow()
  })

  it('rejects empty, excessive and duplicate catalogs', () => {
    const value = recipe()
    expect(() => buildStarterProgram(settings(), { ...value, modes: [] })).toThrow()
    expect(() => buildStarterProgram(settings(), { ...value, modes: [value.modes[0], value.modes[0]] })).toThrow()
    expect(() => buildStarterProgram(settings(), { ...value, modes: Array.from({ length: 9 }, (_, i) => ({ ...value.modes[0], id: `M${i}` })) })).toThrow()
  })

  it('preserves Unicode labels as data and does not share or mutate inputs', () => {
    const value = recipe()
    value.modes[0].label = '星空🌟 / 夜空'
    const before = structuredClone(value)
    expect(buildStarterProgram(settings(), value)).toContain('星空🌟 / 夜空')
    expect(value).toEqual(before)
  })
})

describe.skipIf(!python)('CPython host simulation (not hardware verification)', () => {
  it('passes runtime button, timing, phase, caps and mocked BLE transport tests', () => {
    const result = spawnSync(python!, ['-X', 'utf8', '-B', fileURLToPath(new URL('../../firmware/starter/test_runtime.py', import.meta.url))], { encoding: 'utf8', timeout: 15000 })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    expect(result.stderr).toContain('OK')
    // Python全回帰の子プロセス上限15秒より、外側のテスト上限を長くする。
  }, 20000)

  it('compiles generated Python and keeps quote/backslash payloads inert', () => {
    const value = recipe()
    value.modes[0].label = "');__import__('os');#"
    const config = { ...settings(), firmwareVersion: "v2.0');__import__('os');#\\test" }
    const source = buildStarterProgram(config, value)
    // Imports/functions are syntax checked, but no machine/Pin/BLE code executes.
    const validator = 'import ast,json,sys; t=ast.parse(sys.stdin.read()); s=ast.literal_eval(t.body[1].value.args[0]); c=json.loads(s); print(json.dumps(c))'
    const result = spawnSync(python!, ['-X', 'utf8', '-B', '-c', validator], { input: source, encoding: 'utf8', timeout: 15000 })
    expect(result.status, result.stderr).toBe(0)
    const extracted = JSON.parse(result.stdout)
    expect(extracted.firmware).toBe(config.firmwareVersion)
    expect(extracted.modes[0].label).toBe(value.modes[0].label)
    expect(extracted.button_pin).toBe(9)
  })
})
