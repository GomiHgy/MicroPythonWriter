import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimulationClient, initialSimulationSnapshot, isSimulationSupported } from '../services/simulation/SimulationClient'
import { SimulationClock } from '../services/simulation/SimulationClock'
import type { SimulationConfig, SimulationInput, SimulationOutput, SimulationSnapshot } from '../services/simulation/types'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<SimulationOutput>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  messages: SimulationInput[] = []
  constructor() { FakeWorker.instances.push(this) }
  postMessage(message: SimulationInput) { this.messages.push(message) }
  terminate() { this.terminated = true }
  emit(snapshot: SimulationSnapshot) { this.onmessage?.({ data: { type: 'snapshot', snapshot } } as MessageEvent<SimulationOutput>) }
}
const config: SimulationConfig = { boardId: 'm5nanoc6', ledPin: 2, ledCount: 37, buttonPin: 9 }
let client: SimulationClient
let changes: SimulationSnapshot[]
beforeEach(() => {
  vi.useFakeTimers()
  FakeWorker.instances = []
  changes = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('WebAssembly', { Suspending: () => {}, promising: () => {} })
  vi.stubGlobal('document', { baseURI: 'https://example.test/MicroPythonWriter/' })
  vi.stubEnv('BASE_URL', './')
  client = new SimulationClient(snapshot => changes.push(snapshot))
})
afterEach(() => { client.dispose(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('simulation Worker lifecycle', () => {
  it('loads only the explicitly supplied source and same-origin runtime', () => {
    client.start('print(123)', config)
    expect(changes.at(-1)?.phase).toBe('loading')
    expect(FakeWorker.instances[0].messages).toEqual([{ type: 'start', source: 'print(123)', config, runtimeUrl: 'https://example.test/MicroPythonWriter/simulation-runtime/' }])
  })
  it('does not start a Worker if stack switching is unavailable', () => {
    vi.stubGlobal('WebAssembly', {})
    expect(isSimulationSupported()).toBe(false)
    client.start('while True: pass', config)
    expect(changes.at(-1)?.phase).toBe('error')
    expect(FakeWorker.instances).toHaveLength(0)
  })
  it('rejects empty and oversized sources', () => {
    client.start('', config)
    client.start('x'.repeat(1_000_001), config)
    expect(FakeWorker.instances).toHaveLength(0)
    expect(changes.every(snapshot => snapshot.phase === 'error')).toBe(true)
  })
  it('reset terminates execution, clears inputs and old output, and leaves LEDs off', () => {
    client.start('pass', config)
    const worker = FakeWorker.instances[0]
    const stale = worker.onmessage
    worker.emit({ ...initialSimulationSnapshot(37), phase: 'running', bleEnabled: true })
    client.reset()
    stale?.({ data: { type: 'snapshot', snapshot: { ...initialSimulationSnapshot(), phase: 'running' } } } as MessageEvent<SimulationOutput>)
    expect(worker.terminated).toBe(true)
    expect(changes.at(-1)).toEqual(initialSimulationSnapshot(37))
  })
  it('restarting cannot accept the previous Worker result', () => {
    client.start('first', config)
    const first = FakeWorker.instances[0]
    const stale = first.onmessage
    client.start('second', config)
    stale?.({ data: { type: 'snapshot', snapshot: { ...initialSimulationSnapshot(), phase: 'error', error: 'old' } } } as MessageEvent<SimulationOutput>)
    expect(first.terminated).toBe(true)
    expect(changes.at(-1)?.phase).toBe('loading')
    expect(FakeWorker.instances).toHaveLength(2)
  })
  it('separates simulator pause from virtual BLE PAUSE and validates commands', () => {
    client.start('pass', config)
    const worker = FakeWorker.instances[0]
    client.command('PLAY')
    expect(worker.messages).toHaveLength(1)
    worker.emit({ ...initialSimulationSnapshot(), phase: 'running', bleEnabled: true })
    client.command('BRIGHTNESS 35')
    client.command('ACTION SPARKLE')
    client.command('BRIGHTNESS 999')
    client.pause()
    expect(worker.messages.slice(1)).toEqual([{ type: 'ble', command: 'BRIGHTNESS 35\n' }, { type: 'ble', command: 'ACTION SPARKLE\n' }, { type: 'pause' }])
    worker.emit({ ...initialSimulationSnapshot(), phase: 'paused', bleEnabled: true })
    client.command('PLAY')
    client.button(true)
    client.button(false)
    client.resume()
    expect(worker.messages.slice(-2)).toEqual([{ type: 'button', pressed: false }, { type: 'resume' }])
  })
  it('holds and releases a real-button input without real hardware calls', () => {
    client.start('pass', config)
    const worker = FakeWorker.instances[0]
    worker.emit({ ...initialSimulationSnapshot(), phase: 'running' })
    client.button(true); client.button(false)
    expect(worker.messages.slice(1)).toEqual([{ type: 'button', pressed: true }, { type: 'button', pressed: false }])
  })
  it('remembers a pause requested while runtime assets are still loading', () => {
    client.start('pass', config)
    const worker = FakeWorker.instances[0]
    client.pause()
    worker.emit({ ...initialSimulationSnapshot(), phase: 'running' })
    expect(worker.messages.at(-1)).toEqual({ type: 'pause' })
    worker.emit({ ...initialSimulationSnapshot(), phase: 'paused' })
    client.resume()
    expect(worker.messages.at(-1)).toEqual({ type: 'resume' })
  })
  it('terminates a stalled execution after the heartbeat deadline', () => {
    client.start('while True: pass', config)
    const worker = FakeWorker.instances[0]
    worker.emit({ ...initialSimulationSnapshot(), phase: 'running' })
    vi.advanceTimersByTime(11_000)
    expect(worker.terminated).toBe(true)
    expect(changes.at(-1)?.phase).toBe('error')
  })
  it('bounds loading time even when loading heartbeats continue', () => {
    client.start('pass', config)
    const worker = FakeWorker.instances[0]
    for (let i = 0; i < 61; i++) {
      worker.onmessage?.({ data: { type: 'heartbeat' } } as MessageEvent<SimulationOutput>)
      vi.advanceTimersByTime(1000)
    }
    expect(worker.terminated).toBe(true)
    expect(changes.at(-1)?.phase).toBe('error')
  })
  it('releases finished and failed workers, and disposed clients remain silent', () => {
    client.start('pass', config)
    const worker = FakeWorker.instances[0]
    worker.emit({ ...initialSimulationSnapshot(), phase: 'finished' })
    expect(worker.terminated).toBe(true)
    const length = changes.length
    client.dispose(); client.start('again', config); client.reset()
    expect(changes).toHaveLength(length)
  })
})

describe('simulation virtual clock', () => {
  it('keeps loading at exactly zero until execution starts', () => {
    let now = 1000
    const clock = new SimulationClock(() => now, true)
    now = 61000
    expect(clock.now()).toBe(0)
    clock.resume()
    now += 75
    expect(clock.now()).toBe(75)
  })
  it('excludes pauses without changing elapsed animation time', () => {
    let now = 1000
    const clock = new SimulationClock(() => now)
    now = 1200
    expect(clock.now()).toBe(200)
    clock.pause()
    now = 10000
    expect(clock.now()).toBe(200)
    clock.resume()
    now = 10100
    expect(clock.now()).toBe(300)
  })
  it('does not move backwards when the provided clock moves backwards', () => {
    let now = 1000
    const clock = new SimulationClock(() => now)
    now = 900
    expect(clock.now()).toBe(0)
  })
})
