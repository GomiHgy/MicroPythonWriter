import type { loadPyodide as LoadPyodide } from 'pyodide'
import bootstrap from './hardware.py?raw'
import { parseLedStatus } from '../bluetooth/protocol'
import { SimulationClock } from './SimulationClock'
import { observeLedCurrent } from './LedCurrent'
import { restrictSimulationHost } from './restrictSimulationHost'
import type { SimulationConfig, SimulationInput, SimulationOutput, SimulationSnapshot } from './types'

// このWorkerにはWeb Serial/Web Bluetoothの接続先を一切渡さない。
const scope = globalThis as typeof globalThis & { postMessage: (message: SimulationOutput) => void; onmessage: ((event: MessageEvent<SimulationInput>) => void) | null }
let snapshot: SimulationSnapshot
let config: SimulationConfig
let clock = new SimulationClock(undefined, true)
let pressed = false
let started = false
let commands: string[] = []
let notifyLine = ''
let discardingNotify = false
let nextStatus = 0
let updateTimer: ReturnType<typeof setTimeout> | undefined

function publish(): void {
  if (!snapshot) return
  snapshot.elapsedMs = Math.floor(clock.now())
  scope.postMessage({ type: 'snapshot', snapshot })
}
function schedulePublish(): void {
  if (updateTimer !== undefined) return
  updateTimer = setTimeout(() => { updateTimer = undefined; publish() }, 33)
}
function log(message: string): void {
  snapshot.log = (snapshot.log + message + '\n').slice(-8192)
  schedulePublish()
}
function frame(pin: number, encoded: string): void {
  if (pin !== config.ledPin || encoded.length > 10_000) return
  const values: unknown = JSON.parse(encoded)
  if (!Array.isArray(values) || values.length < 1 || values.length > 300) throw new Error('LED count must be between 1 and 300')
  if (!values.every(pixel => Array.isArray(pixel) && pixel.length === 3 && pixel.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255))) throw new Error('Invalid RGB output')
  snapshot.pixels = values as [number, number, number][]
  snapshot.ledCurrent = observeLedCurrent(snapshot.ledCurrent, snapshot.pixels)
  schedulePublish()
}
function bleOutput(text: string): void {
  // 受信JSONは名前付き操作のためだけに使う。発光の描画はbitstream/NeoPixel出力から取る。
  for (const char of text) {
    if (char === '\n') {
      const status = discardingNotify ? null : parseLedStatus(notifyLine)
      if (status?.v === 2) {
        snapshot.modes = status.controls.modes.map(choice => ({ ...choice }))
        snapshot.actions = status.controls.actions.map(choice => ({ ...choice }))
        schedulePublish()
      }
      notifyLine = ''; discardingNotify = false
    } else if (!discardingNotify) {
      notifyLine += char
      if (notifyLine.length > 4096) { notifyLine = ''; discardingNotify = true }
    }
  }
}
const bridge = {
  now: () => clock.now(),
  button: () => pressed,
  frame,
  bleOutput,
  bleActive: (enabled: boolean) => {
    snapshot.bleEnabled = enabled
    if (enabled) { commands.push('STATUS\n'); nextStatus = clock.now() + 1000 }
    else { snapshot.modes = []; snapshot.actions = []; commands = []; notifyLine = ''; discardingNotify = false }
    schedulePublish()
  },
  drainCommands: () => {
    if (snapshot.bleEnabled && clock.now() >= nextStatus) {
      if (commands.length < 16) commands.push('STATUS\n')
      nextStatus = clock.now() + 1000
    }
    const pending = commands
    commands = []
    return JSON.stringify(pending)
  },
  wait: async (ms: number) => {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid simulated sleep duration')
    const deadline = clock.now() + ms
    // 0msもイベントループへ必ず戻す。busy loopのtraceからもボタン/停止要求を処理できる。
    do {
      await new Promise<void>(resolve => setTimeout(resolve, clock.isPaused ? 20 : Math.min(20, Math.max(0, deadline - clock.now()))))
    } while (clock.isPaused || clock.now() < deadline)
  },
}

async function start(input: Extract<SimulationInput, { type: 'start' }>): Promise<void> {
  if (started) return
  started = true
  config = input.config
  snapshot = { phase: 'loading', pixels: Array.from({ length: Math.max(1, Math.min(300, config.ledCount)) }, () => [0, 0, 0]), ledCurrent: null, elapsedMs: 0, bleEnabled: false, modes: [], actions: [], log: '', error: '' }
  clock.pause()
  publish()
  const heartbeat = setInterval(() => {
    scope.postMessage({ type: 'heartbeat' })
    if (snapshot.phase === 'running') schedulePublish()
  }, 500)
  try {
    const runtime = await import(/* @vite-ignore */ `${input.runtimeUrl}pyodide.mjs`) as { loadPyodide: typeof LoadPyodide }
    const pyodide = await runtime.loadPyodide({ indexURL: input.runtimeUrl, stdout: log, stderr: log, packages: [] })
    pyodide.globals.set('_sim_bridge', bridge)
    pyodide.globals.set('_sim_config', JSON.stringify(config))
    await pyodide.runPythonAsync(bootstrap, { filename: '<simulator>' })
    const unrestricted = restrictSimulationHost(scope)
    if (unrestricted.length) throw new Error('このブラウザではシミュレーション用の通信制限を設定できません。')
    pyodide.globals.set('_sim_source', input.source)
    clock = new SimulationClock()
    snapshot.phase = 'running'
    publish()
    await pyodide.runPythonAsync('_sim_execute(_sim_source)', { filename: '<simulator-entry>' })
    snapshot.phase = 'finished'
  } catch (error) {
    snapshot.phase = 'error'
    snapshot.error = (error instanceof Error ? error.message : String(error)).slice(-8192)
  } finally {
    clock.pause()
    pressed = false
    snapshot.bleEnabled = false
    clearInterval(heartbeat)
    if (updateTimer !== undefined) clearTimeout(updateTimer)
    updateTimer = undefined
    publish()
  }
}

scope.onmessage = (event: MessageEvent<SimulationInput>) => {
  const input = event.data
  if (input.type === 'start') { void start(input); return }
  if (!snapshot || (snapshot.phase !== 'running' && snapshot.phase !== 'paused')) return
  if (input.type === 'pause') { clock.pause(); pressed = false; snapshot.phase = 'paused'; publish() }
  else if (input.type === 'resume') { clock.resume(); snapshot.phase = 'running'; publish() }
  else if (input.type === 'button') pressed = input.pressed
  else if (input.type === 'ble' && snapshot.phase === 'running' && snapshot.bleEnabled && commands.length < 16 && /^[\x20-\x7e]{1,19}\n$/.test(input.command)) commands.push(input.command)
}
