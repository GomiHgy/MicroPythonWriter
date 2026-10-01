import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import hardware from '../services/simulation/hardware.py?raw'
import { buildStarterProgram } from '../services/projects/StarterProgram'

interface Result {
  frames: number[][][]
  output: string[]
  ble: boolean[]
  bleOutput: string
  error: string | null
  waits: number
}

const jspi = spawnSync(process.execPath, ['--experimental-wasm-jspi', '-e', 'if (typeof WebAssembly.Suspending !== "function") process.exit(1)'], { timeout: 5000 }).status === 0

describe.skipIf(!jspi)('real Pyodide WebAssembly integration with JSPI (no physical hardware)', () => {
  it('runs button/NeoPixel code, unchanged starter BLE, and a cooperatively interrupted busy loop', () => {
    const starter = buildStarterProgram(
      { boardId: 'm5nanoc6', firmwareVersion: 'simulation-only', ledModel: 'WS2812B', ledCount: 3, ledPin: 2, maxBrightnessPercent: 20 },
      { modes: [{ id: 'RED', label: '赤い光', icon: 'light', kind: 'solid', color: '#ff0000', speed: 50, repeats: 0, endState: 'hold' }], shortPress: 'next', doublePress: 'none', longPress: 'toggle', whileHeld: false, wireless: true },
    )
    const sources = [
      `from machine import Pin\nfrom neopixel import NeoPixel\nimport time\nnp = NeoPixel(Pin(2), 3)\nbutton = Pin(9, Pin.IN, Pin.PULL_UP)\nprint(button.value())\ntime.sleep_ms(10)\nprint(button.value())\nnp.fill((255, 50, 5))\nnp.write()\n`,
      starter,
      'counter = 0\nwhile True:\n    counter += 1\n',
    ]
    const script = `
import { loadPyodide } from 'pyodide';
import fs from 'node:fs';
import { restrictSimulationHost } from './src/services/simulation/restrictSimulationHost.ts';
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = [];
let current;
const python = await loadPyodide({ stdout: text => current?.output.push(text), stderr: text => current?.output.push(text) });
for (const [index, source] of payload.sources.entries()) {
  current = { frames: [], output: [], ble: [], bleOutput: '', error: null, waits: 0 };
  let elapsed = 0;
  let sentCommands = false;
  let buttonPressed = false;
  const bridge = {
    now() { return elapsed; },
    wait(milliseconds) {
      current.waits++;
      elapsed += milliseconds || 20;
      return new Promise((resolve, reject) => setImmediate(() => {
        if (index === 0 && milliseconds >= 10) buttonPressed = true;
        if (elapsed >= (index === 2 ? 60 : 1200)) reject(new Error('TEST_SIM_STOP'));
        else resolve();
      }));
    },
    button() { return buttonPressed; },
    frame(pin, pixels) { current.frames.push(JSON.parse(pixels)); },
    bleActive(active) { current.ble.push(active); },
    bleOutput(text) { current.bleOutput += text; },
    drainCommands() {
      if (index === 1 && current.ble.at(-1) && !sentCommands) {
        sentCommands = true;
        return JSON.stringify(['STATUS', 'PLAY', 'BRIGHTNESS 50']);
      }
      return '[]';
    },
  };
  python.globals.set('_sim_bridge', bridge);
  python.globals.set('_sim_config', JSON.stringify({ boardId: 'm5nanoc6', ledPin: 2, ledCount: 3, buttonPin: 9 }));
  python.globals.set('_source', source);
  await python.runPythonAsync(payload.hardware);
  if (index === 0) {
    const failures = restrictSimulationHost(globalThis);
    if (failures.length) throw new Error('Unable to restrict: ' + failures.join(','));
  }
  try { await python.runPythonAsync('_sim_execute(_source)'); }
  catch (error) { current.error = String(error); }
  results.push(current);
}
process.stdout.write(JSON.stringify(results));
`
    const processResult = spawnSync(process.execPath, ['--experimental-wasm-jspi', '--input-type=module', '-e', script], {
      input: JSON.stringify({ hardware, sources }), encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024,
    })
    expect(processResult.status, processResult.stderr || String(processResult.error ?? '')).toBe(0)
    const results = JSON.parse(processResult.stdout) as Result[]
    expect(results[0].error).toBeNull()
    expect(results[0].output).toEqual(['1', '0'])
    expect(results[0].frames).toEqual([[[255, 50, 5], [255, 50, 5], [255, 50, 5]]])
    expect(results[1].error).toContain('TEST_SIM_STOP')
    expect(results[1].ble).toContain(true)
    expect(results[1].frames.some(frame => frame.some(pixel => pixel[0] > 0))).toBe(true)
    expect(results[1].frames.flat().every(pixel => pixel[0] <= 25 && pixel[1] === 0 && pixel[2] === 0)).toBe(true)
    const reports = results[1].bleOutput.trim().split('\n').map(line => JSON.parse(line) as { brightness: number; playback: string; controls: { modes: { label: string }[] } })
    expect(reports.some(report => report.brightness === 50 && report.playback === 'playing')).toBe(true)
    expect(reports[0].controls.modes[0].label).toBe('赤い光')
    expect(results[2].error).toContain('TEST_SIM_STOP')
    expect(results[2].waits).toBeGreaterThanOrEqual(3)
  }, 30000)
})
