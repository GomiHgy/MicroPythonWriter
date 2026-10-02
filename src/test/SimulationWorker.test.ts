import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimulationInput, SimulationOutput, SimulationSnapshot } from '../services/simulation/types'

const runtime = vi.hoisted(() => ({ set: vi.fn(), run: vi.fn() }))
vi.mock('pyodide/pyodide.mjs', () => ({ loadPyodide: async () => ({ globals: { set: runtime.set }, runPythonAsync: runtime.run }) }))
vi.mock('../services/simulation/restrictSimulationHost', () => ({ restrictSimulationHost: () => [] }))

let outputs: SimulationOutput[]
let finish: () => void
let fail: (error: Error) => void
type Bridge = { button: () => boolean; now: () => number; wait: (ms: number) => Promise<void>; bleActive: (enabled: boolean) => void }
let bridge: Bridge

function send(input: SimulationInput): void {
  const scope = globalThis as typeof globalThis & { onmessage: (event: MessageEvent<SimulationInput>) => void }
  scope.onmessage({ data: input } as MessageEvent<SimulationInput>)
}
function latest(): SimulationSnapshot | undefined {
  return outputs.filter((output): output is Extract<SimulationOutput, { type: 'snapshot' }> => output.type === 'snapshot').at(-1)?.snapshot
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
  outputs = []
  vi.stubGlobal('postMessage', (output: SimulationOutput) => outputs.push(structuredClone(output)))
  vi.stubGlobal('onmessage', null)
  runtime.set.mockReset().mockImplementation((key: string, value: unknown) => { if (key === '_sim_bridge') bridge = value as Bridge })
  runtime.run.mockReset().mockImplementation((source: string) => source === '_sim_execute(_sim_source)'
    ? new Promise<void>((resolve, reject) => { finish = resolve; fail = reject }) : Promise.resolve())
  await import('../services/simulation/worker')
  send({ type: 'start', source: 'pass', config: { boardId: 'm5nanoc6', ledPin: 2, ledCount: 10, buttonPin: 9 }, runtimeUrl: 'pyodide/' })
  await vi.dynamicImportSettled()
  expect(latest()?.phase).toBe('running')
})
afterEach(() => { vi.clearAllTimers(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('simulation Worker button integration', () => {
  it('delivers double-click GPIO states to Python and publishes start/completion', async () => {
    send({ type: 'button-gesture', gesture: 'double' })
    expect(latest()?.buttonGesture).toBe('double')
    expect(bridge.button()).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(bridge.button()).toBe(false)
    await vi.advanceTimersByTimeAsync(140)
    expect(bridge.button()).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(bridge.button()).toBe(false)
    await vi.advanceTimersByTimeAsync(400)
    expect(bridge.button()).toBe(false)
    expect(latest()?.buttonGesture).toBeNull()
  })

  it('rejects repeated input during both the press and click-confirmation window', async () => {
    send({ type: 'button-gesture', gesture: 'single' })
    send({ type: 'button-gesture', gesture: 'long' })
    expect(latest()?.buttonGesture).toBe('single')
    await vi.advanceTimersByTimeAsync(200)
    send({ type: 'button-gesture', gesture: 'double' })
    expect(bridge.button()).toBe(false)
    expect(latest()?.buttonGesture).toBe('single')
    await vi.advanceTimersByTimeAsync(300)
    send({ type: 'button-gesture', gesture: 'long' })
    expect(latest()?.buttonGesture).toBe('long')
  })

  it('pause cancels the gesture and ignores delayed press commands while paused', async () => {
    send({ type: 'button-gesture', gesture: 'double' })
    await vi.advanceTimersByTimeAsync(80)
    send({ type: 'pause' })
    expect(latest()?.phase).toBe('paused')
    expect(latest()?.buttonGesture).toBeNull()
    send({ type: 'button-gesture', gesture: 'long' })
    send({ type: 'button', pressed: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(bridge.button()).toBe(false)
    expect(bridge.now()).toBe(80)
    send({ type: 'resume' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(bridge.button()).toBe(false)
    expect(latest()?.buttonGesture).toBeNull()
  })

  it('an explicit UI release cancels every remaining step of a double click', async () => {
    send({ type: 'button-gesture', gesture: 'double' })
    await vi.advanceTimersByTimeAsync(120)
    send({ type: 'button', pressed: false })
    expect(latest()?.buttonGesture).toBeNull()
    await vi.advanceTimersByTimeAsync(130)
    expect(bridge.button()).toBe(false)
  })

  it.each(['finished', 'error'] as const)('releases an in-progress gesture on %s', async phase => {
    bridge.bleActive(true)
    send({ type: 'button-gesture', gesture: 'long' })
    if (phase === 'finished') finish()
    else fail(new Error('test failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(latest()?.phase).toBe(phase)
    expect(latest()?.buttonGesture).toBeNull()
    const terminal = outputs.filter((output): output is Extract<SimulationOutput, { type: 'snapshot' }> => output.type === 'snapshot' && output.snapshot.phase === phase)
    expect(terminal.every(output => !output.snapshot.bleEnabled)).toBe(true)
    expect(bridge.button()).toBe(false)
    send({ type: 'button-gesture', gesture: 'single' })
    expect(bridge.button()).toBe(false)
  })

  it('updates completion during simulated sleeps without depending on UI timers', async () => {
    send({ type: 'button-gesture', gesture: 'single' })
    const waiting = bridge.wait(600)
    await vi.advanceTimersByTimeAsync(520)
    expect(latest()?.buttonGesture).toBeNull()
    await vi.advanceTimersByTimeAsync(80)
    await waiting
  })
})
