import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import hardware from '../services/simulation/hardware.py?raw'
import { buildStarterProgram } from '../services/projects/StarterProgram'

const pythonCommands = ['python3', 'python', ...(process.platform === 'win32' ? ['py', `${process.env.USERPROFILE}/.platformio/penv/Scripts/python.exe`] : [])]
const python = pythonCommands.find(command => spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0)

interface RunResult {
  frames: number[][][]
  pins: number[]
  output: string
  ble: boolean[]
  bleOutput: string
  milliseconds: number
  waits: number
  error: string | null
}

function simulate(source: string, options: { button?: boolean; commands?: string[]; maxMs?: number; ledPin?: number } = {}): RunResult {
  const payload = JSON.stringify({ hardware, source, options })
  const script = `
import sys, types, json, io, contextlib
payload = json.loads(sys.stdin.read())
options = payload['options']
class StopSimulation(BaseException):
    pass
class Bridge:
    def __init__(self):
        self.frames = []
        self.pins = []
        self.output = ''
        self.ble = []
        self.milliseconds = 0
        self.waits = 0
        self.commands = list(options.get('commands', []))
    def now(self):
        return self.milliseconds
    def wait(self, milliseconds):
        self.waits += 1
        self.milliseconds += milliseconds if milliseconds > 0 else 20
        if self.milliseconds >= options.get('maxMs', 2000):
            raise StopSimulation()
        return None
    def button(self):
        return options.get('button', False)
    def frame(self, pin, pixels):
        self.pins.append(pin)
        self.frames.append(json.loads(pixels))
    def bleActive(self, active):
        self.ble.append(active)
    def bleOutput(self, text):
        self.output += text
    def drainCommands(self):
        if self.ble and self.ble[-1]:
            result, self.commands = self.commands, []
            return json.dumps(result)
        return '[]'
bridge = Bridge()
pyodide = types.ModuleType('pyodide')
ffi = types.ModuleType('pyodide.ffi')
ffi.run_sync = lambda promise: promise
sys.modules['pyodide'] = pyodide
sys.modules['pyodide.ffi'] = ffi
namespace = {'_sim_bridge': bridge, '_sim_config': json.dumps({'boardId': 'm5nanoc6', 'ledPin': options.get('ledPin', 2), 'ledCount': 3, 'buttonPin': 9})}
exec(payload['hardware'], namespace, namespace)
output = io.StringIO()
error = None
try:
    with contextlib.redirect_stdout(output):
        namespace['_sim_execute'](payload['source'])
except StopSimulation:
    pass
except BaseException as exc:
    error = type(exc).__name__ + ': ' + str(exc)
print(json.dumps({'frames': bridge.frames, 'pins': bridge.pins, 'output': output.getvalue(), 'ble': bridge.ble,
                  'bleOutput': bridge.output, 'milliseconds': bridge.milliseconds, 'waits': bridge.waits, 'error': error}))
`
  const result = spawnSync(python!, ['-c', script], { input: payload, encoding: 'utf8', timeout: 10000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  expect(result.status, result.stderr || String(result.error ?? '')).toBe(0)
  return JSON.parse(result.stdout) as RunResult
}

describe.skipIf(!python)('browser simulation MicroPython compatibility layer (host checks, not device proof)', () => {
  it('runs unchanged RGB NeoPixel writes and captures GRB bitstream as RGB', () => {
    const result = simulate(`
from machine import Pin, bitstream
from neopixel import NeoPixel
np = NeoPixel(Pin(2, Pin.OUT), 3)
np[0] = (255, 12, 30)
np[1] = (1, 2, 3)
np.write()
bitstream(Pin(2), 0, (400, 850, 800, 450), bytes([8, 9, 10]))
`)
    expect(result.error).toBeNull()
    expect(result.frames).toEqual([[[255, 12, 30], [1, 2, 3], [0, 0, 0]], [[9, 8, 10]]])
  })

  it('does not show the built-in RGB pin as the configured external LED strip', () => {
    const result = simulate(`
from neopixel import NeoPixel
from machine import Pin
np = NeoPixel(Pin(20, Pin.OUT), 1)
np.fill((255, 255, 255))
np.write()
`)
    expect(result.error).toBeNull()
    expect(result.frames).toEqual([])
  })

  it('rejects oversized bitstream buffers before constructing output frames, including unselected pins', () => {
    const result = simulate(`
import machine
machine.bitstream(machine.Pin(20), 0, (400, 850, 800, 450), bytearray(903))
`)
    expect(result.error).toBe('ValueError: Simulation supports 1 to 300 output LEDs')
    expect(result.frames).toEqual([])
  })

  it.each([true, false])('maps the held virtual button to active-low Pin and M5 button helpers: %s', button => {
    const result = simulate(`
from machine import Pin
import M5
button = Pin(9, Pin.IN, Pin.PULL_UP)
M5.begin()
M5.update()
print(button.value(), M5.BtnA.isPressed(), M5.BtnA.wasPressed())
M5.update()
print(M5.BtnA.wasPressed())
`, { button })
    expect(result.error).toBeNull()
    expect(result.output.trim()).toBe(button ? '0 True True\nFalse' : '1 False False\nFalse')
  })

  it('uses virtual ticks and yields sleeps rather than advancing wall-clock time', () => {
    const result = simulate(`
import time
start = time.ticks_ms()
time.sleep_ms(50)
time.sleep_us(500)
time.sleep(0.1)
print(time.ticks_diff(time.ticks_ms(), start))
print(time.ticks_diff(1, (1 << 30) - 1))
`)
    expect(result.error).toBeNull()
    expect(result.output.trim()).toBe('150\n2')
    expect(result.milliseconds).toBe(150.5)
  })

  it('yields a sleep-free user loop so the host can pause or reset it', () => {
    const result = simulate('while True:\n    pass\n', { maxMs: 60 })
    expect(result.error).toBeNull()
    expect(result.waits).toBeGreaterThanOrEqual(3)
  })

  it.each(['import js', 'import os', 'import socket', 'import pyodide', 'open("/tmp/test", "w")', 'exec("print(1)")', 'import machine\nmachine.PWM(2)', 'import gc\ngc.mem_free()'])('explicitly rejects unsupported or host-access operation: %s', source => {
    const result = simulate(source)
    expect(result.error).toMatch(/^(NotImplementedError|AttributeError|ModuleNotFoundError): Simulation does not support /)
  })

  it('permits optional firmware API availability checks without inventing physical memory measurements', () => {
    const result = simulate(`
import gc
print(hasattr(gc, 'mem_free'))
print(getattr(gc, 'mem_alloc', None))
try:
    import esp32
except ImportError:
    print('NO_ESP32')
`)
    expect(result.error).toBeNull()
    expect(result.output.trim()).toBe('False\nNone\nNO_ESP32')
  })

  it('does not mark plain BLE activation as a usable NanoLED controller', () => {
    const result = simulate('import bluetooth\nble = bluetooth.BLE()\nble.active(True)\nprint(ble.active())')
    expect(result.error).toBeNull()
    expect(result.ble).toEqual([])
    expect(result.output.trim()).toBe('True')
  })

  it('bounds virtual GATT writes before copying data', () => {
    const result = simulate(`
import bluetooth
ble = bluetooth.BLE()
ble.active(True)
((handle,),) = ble.gatts_register_services(((bluetooth.UUID(1), ((bluetooth.UUID(2), bluetooth.FLAG_WRITE),)),))
ble.gatts_write(handle, bytearray(4098))
`)
    expect(result.error).toBe('ValueError: Simulation GATT value exceeds 4097 bytes')
  })

  it('does not grow unread append-mode BLE RX buffers indefinitely', () => {
    const result = simulate(`
import bluetooth, time
ble = bluetooth.BLE()
ble.active(True)
tx = (bluetooth.UUID('6e400003-b5a3-f393-e0a9-e50e24dcca9e'), bluetooth.FLAG_NOTIFY)
rx = (bluetooth.UUID('6e400002-b5a3-f393-e0a9-e50e24dcca9e'), bluetooth.FLAG_WRITE)
((tx_handle, rx_handle),) = ble.gatts_register_services(((bluetooth.UUID(1), (tx, rx)),))
ble.gatts_set_buffer(rx_handle, 5, True)
ble.irq(lambda event, data: None)
ble.gap_advertise(250000)
time.sleep_ms(10)
`, { commands: ['PLAY', 'PLAY'] })
    expect(result.error).toBe('ValueError: Virtual BLE RX buffer is full')
  })

  it('supports normal M5 wildcard imports and little-endian UUID advertisement bytes', () => {
    const result = simulate(`
from M5 import *
import bluetooth
begin()
update()
print(BtnA.isPressed())
print(bytes(bluetooth.UUID(0x180f)).hex())
print(bytes(bluetooth.UUID('6e400001-b5a3-f393-e0a9-e50e24dcca9e')).hex())
`)
    expect(result.error).toBeNull()
    expect(result.output.trim()).toBe('False\n0f18\n9ecadc240ee5a9e093f3a3b50100406e')
  })

  it('routes ASCII commands through RX IRQ and incrementally decodes split UTF-8 notifications', () => {
    const result = simulate(`
import bluetooth, time
ble = bluetooth.BLE()
ble.active(True)
service = bluetooth.UUID('6e400001-b5a3-f393-e0a9-e50e24dcca9e')
tx = (bluetooth.UUID('6e400003-b5a3-f393-e0a9-e50e24dcca9e'), bluetooth.FLAG_NOTIFY)
rx = (bluetooth.UUID('6e400002-b5a3-f393-e0a9-e50e24dcca9e'), bluetooth.FLAG_WRITE)
((tx_handle, rx_handle),) = ble.gatts_register_services(((service, (tx, rx)),))
ble.gatts_set_buffer(rx_handle, 128, True)
def irq(event, data):
    if event == 1:
        print('CONNECTED', data[0])
    if event == 21:
        print('MTU', data[1])
    if event == 3:
        print('COMMAND', ble.gatts_read(rx_handle).decode().strip())
ble.irq(irq)
ble.gap_advertise(250000, adv_data=b'')
time.sleep_ms(10)
payload = 'にじいろ\\n'.encode()
for value in payload:
    ble.gatts_notify(1, tx_handle, bytes((value,)))
`, { commands: ['PLAY', 'BRIGHTNESS 40'] })
    expect(result.error).toBeNull()
    expect(result.ble).toEqual([true])
    expect(result.bleOutput).toBe('にじいろ\n')
    expect(result.output).toContain('CONNECTED 1\nMTU 247\n')
    expect(result.output).toContain('COMMAND PLAY\nCOMMAND BRIGHTNESS 40\n')
  })

  it('executes the current generated starter unchanged with its BLE command handler and output', () => {
    const source = buildStarterProgram(
      { boardId: 'm5nanoc6', firmwareVersion: 'simulation-only', ledModel: 'WS2812B', ledCount: 3, ledPin: 2, maxBrightnessPercent: 20 },
      { modes: [{ id: 'RED', label: '赤い光', icon: 'light', kind: 'solid', color: '#ff0000', speed: 50, repeats: 0, endState: 'hold' }], shortPress: 'next', doublePress: 'none', longPress: 'toggle', whileHeld: false, wireless: true },
    )
    const result = simulate(source, { commands: ['STATUS', 'PLAY', 'BRIGHTNESS 50'], maxMs: 2000 })
    expect(result.error).toBeNull()
    expect(result.ble).toContain(true)
    expect(result.frames.some(frame => frame.some(pixel => pixel[0] > 0))).toBe(true)
    expect(result.frames.flat().every(pixel => pixel[0] <= 25 && pixel[1] === 0 && pixel[2] === 0)).toBe(true)
    const reports = result.bleOutput.trim().split('\n').map(line => JSON.parse(line) as { brightness: number; playback: string; controls: { modes: { label: string }[] } })
    expect(reports.length).toBeGreaterThan(0)
    expect(reports.some(report => report.brightness === 50 && report.playback === 'playing')).toBe(true)
    expect(reports[0].controls.modes[0].label).toBe('赤い光')
  })
})
