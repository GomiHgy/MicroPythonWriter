import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProgrammer } from '../hooks/useProgrammer'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import { RawReplClient, type LongRunningCallbacks, type LongRunningCompletion, type LongRunningConfirmation } from '../services/micropython/RawReplClient'
import { FileTransferService } from '../services/micropython/FileTransferService'
import { DeviceProbe } from '../services/micropython/DeviceProbe'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { SerialStateMachine } from '../services/serial/SerialStateMachine'
import { DeviceTimeoutError, SerialDisconnectedError } from '../types'

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, mounted: false, effects: [] as Array<() => unknown> }))
vi.mock('react', () => ({
  useRef: <Value,>(initial: Value) => {
    const index = hooks.cursor++
    if (!hooks.mounted) hooks.slots[index] = { current: initial }
    return hooks.slots[index]
  },
  useMemo: <Value,>(factory: () => Value) => {
    const index = hooks.cursor++
    if (!hooks.mounted) hooks.slots[index] = factory()
    return hooks.slots[index]
  },
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = hooks.cursor++
    if (!hooks.mounted) hooks.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [hooks.slots[index], (next: Value | ((previous: Value) => Value)) => {
      hooks.slots[index] = typeof next === 'function' ? (next as (previous: Value) => Value)(hooks.slots[index] as Value) : next
    }]
  },
  useEffect: (effect: () => unknown) => { if (!hooks.mounted) hooks.effects.push(effect) },
}))

function HookHarness() { return useProgrammer() }

function render() {
  hooks.cursor = 0
  const app = HookHarness()
  hooks.mounted = true
  hooks.effects.splice(0).forEach(effect => effect())
  return app
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const stopped: LongRunningCompletion = { state: 'stopped', stdout: '', stderr: '', intentionalStop: true }
let active = false
let confirmedBy: LongRunningConfirmation = 'still-running'
let callbacks: LongRunningCallbacks[] = []
let disconnectDetected: () => void

function completeStop() {
  active = false
  callbacks.at(-1)?.onComplete?.(stopped)
  return stopped
}

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.mounted = false; hooks.effects = []
  active = false; callbacks = []; confirmedBy = 'still-running'
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal('confirm', vi.fn(() => true))
  vi.stubGlobal('navigator', { serial: { addEventListener: vi.fn(), removeEventListener: vi.fn() } })
  vi.spyOn(WebSerialTransport.prototype, 'connect').mockResolvedValue()
  vi.spyOn(WebSerialTransport.prototype, 'disconnect').mockResolvedValue()
  vi.spyOn(WebSerialTransport.prototype, 'onDisconnectDetected').mockImplementation(callback => { disconnectDetected = callback; return () => {} })
  vi.spyOn(MicroPythonDevice.prototype, 'enterNormalMode').mockResolvedValue()
  vi.spyOn(DeviceProbe.prototype, 'probe').mockResolvedValue({ deviceName: 'NanoC6', microPythonVersion: 'test', firmwareInfo: 'test', nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false })
  vi.spyOn(FileTransferService.prototype, 'writeMain').mockResolvedValue(100)
  vi.spyOn(MicroPythonDevice.prototype, 'validateMain').mockResolvedValue()
  vi.spyOn(RawReplClient.prototype, 'hasLongRunningSession').mockImplementation(() => active)
  vi.spyOn(RawReplClient.prototype, 'discardPendingInput').mockReturnValue(new Uint8Array())
  vi.spyOn(RawReplClient.prototype, 'stopLongRunning').mockImplementation(async () => completeStop())
  vi.spyOn(RawReplClient.prototype, 'startLongRunning').mockImplementation(async (_code, nextCallbacks = {}) => {
    callbacks.push(nextCallbacks); active = true
    return { state: 'running', confirmedBy, initialOutput: '', stderr: '', session: { state: 'running', stop: async () => completeStop(), dispose: () => {} } }
  })
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function startProgram() {
  await render().connect()
  await render().run()
  expect(render().state).toBe(confirmedBy === 'still-running' ? 'running-no-marker' : 'running')
}

describe('実行・編集・再実行（実際のhook・状態機械、機器通信は模擬）', () => {
  it.each(['still-running', 'startup-marker'] as const)('%s: 手動停止なしで編集内容を再実行する', async confirmation => {
    confirmedBy = confirmation
    await startProgram()
    render().setSource('print("edited")')
    const transitions = vi.spyOn(SerialStateMachine.prototype, 'move')
    await render().run()
    expect(transitions.mock.calls.map(([state]) => state)).toEqual(['stopping', 'stopped', 'uploading', 'verifying', 'starting'])
    expect(FileTransferService.prototype.writeMain).toHaveBeenLastCalledWith('print("edited")')
    expect(RawReplClient.prototype.startLongRunning).toHaveBeenCalledTimes(2)
    expect(render().error).toBeUndefined()
  })

  it.each(['still-running', 'startup-marker'] as const)('%s: 更新は自動停止後に保存だけ行う', async confirmation => {
    confirmedBy = confirmation
    await startProgram()
    render().setSource('print("saved")')
    await render().write()
    expect(render().state).toBe('raw-repl-ready')
    expect(FileTransferService.prototype.writeMain).toHaveBeenLastCalledWith('print("saved")')
    expect(RawReplClient.prototype.startLongRunning).toHaveBeenCalledTimes(1)
    expect(render().error).toBeUndefined()
  })

  it('停止確認を待ち、その間の連打・更新・手動停止を受け付けない', async () => {
    await startProgram()
    const barrier = deferred()
    vi.mocked(RawReplClient.prototype.stopLongRunning).mockImplementationOnce(async () => { await barrier.promise; return completeStop() })
    const operation = render().run()
    expect(render().state).toBe('stopping')
    await Promise.all([render().run(), render().write(), render().stop()])
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(1)
    expect(RawReplClient.prototype.stopLongRunning).toHaveBeenCalledTimes(1)
    barrier.resolve(); await operation
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(2)
    expect(render().state).toBe('running-no-marker')
  })

  it.each(['timeout', 'host-error', 'runtime-error'] as const)('停止失敗 %s では書き込まない', async failure => {
    await startProgram()
    const stopMock = vi.mocked(RawReplClient.prototype.stopLongRunning)
    if (failure === 'timeout') stopMock.mockRejectedValueOnce(new DeviceTimeoutError('停止タイムアウト'))
    else stopMock.mockResolvedValueOnce({ ...stopped, state: 'error', hostError: failure === 'host-error' ? new Error('通信異常') : undefined, stderr: failure === 'runtime-error' ? '停止失敗' : '' })
    await render().run()
    expect(render().state).toBe('error')
    expect(render().error).toBeDefined()
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(1)
    expect(RawReplClient.prototype.startLongRunning).toHaveBeenCalledTimes(1)
  })

  it.each(['stop', 'write', 'validate', 'start'] as const)('%s 待機中のUSB切断後は後続処理と状態更新を行わない', async phase => {
    await startProgram()
    const barrier = deferred()
    const entered = deferred()
    const wait = async () => { entered.resolve(); await barrier.promise }
    if (phase === 'stop') vi.mocked(RawReplClient.prototype.stopLongRunning).mockImplementationOnce(async () => { await wait(); return completeStop() })
    if (phase === 'write') vi.mocked(FileTransferService.prototype.writeMain).mockImplementationOnce(async () => { await wait(); return 100 })
    if (phase === 'validate') vi.mocked(MicroPythonDevice.prototype.validateMain).mockImplementationOnce(wait)
    if (phase === 'start') vi.mocked(RawReplClient.prototype.startLongRunning).mockImplementationOnce(async () => { await wait(); throw new SerialDisconnectedError() })
    const operation = render().run()
    await entered.promise
    disconnectDetected()
    barrier.resolve(); await operation
    expect(render().state).toBe('connection-lost')
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(phase === 'stop' ? 1 : 2)
    expect(MicroPythonDevice.prototype.validateMain).toHaveBeenCalledTimes(['stop', 'write'].includes(phase) ? 1 : 2)
    expect(RawReplClient.prototype.startLongRunning).toHaveBeenCalledTimes(phase === 'start' ? 2 : 1)
  })

  it('停止待機中に手動切断しても旧処理が状態を上書きしない', async () => {
    await startProgram()
    const barrier = deferred()
    vi.mocked(RawReplClient.prototype.stopLongRunning).mockImplementationOnce(async () => { await barrier.promise; return completeStop() })
    const operation = render().run()
    await render().disconnect()
    barrier.resolve(); await operation
    expect(render().state).toBe('disconnected')
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(1)
  })

  it('旧セッションの遅延通知を無視する', async () => {
    await startProgram()
    const oldCallbacks = callbacks[0]
    await render().run()
    oldCallbacks.onComplete?.({ ...stopped, state: 'error', hostError: new Error('古い通知') })
    expect(render().state).toBe('running-no-marker')
    expect(render().error).toBeUndefined()
  })

  it('再接続後の新しい操作を旧処理の失敗やfinallyで解除しない', async () => {
    await startProgram()
    const oldBarrier = deferred()
    vi.mocked(RawReplClient.prototype.stopLongRunning).mockImplementationOnce(async () => { await oldBarrier.promise; throw new SerialDisconnectedError() })
    const oldOperation = render().run()
    disconnectDetected()
    active = false
    await render().connect()
    const newBarrier = deferred()
    vi.spyOn(MicroPythonDevice.prototype, 'prepareForWrite').mockImplementationOnce(async () => { await newBarrier.promise })
    const newOperation = render().run()
    oldBarrier.resolve(); await oldOperation
    await render().run()
    expect(render().state).toBe('raw-repl-ready')
    expect(render().error).toBeUndefined()
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(1)
    newBarrier.resolve(); await newOperation
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(2)
    expect(render().state).toBe('running-no-marker')
  })

  it('起動受付待ちの連打では実行・更新を追加しない', async () => {
    await render().connect()
    const barrier = deferred()
    const entered = deferred()
    vi.mocked(RawReplClient.prototype.startLongRunning).mockImplementationOnce(async (_code, nextCallbacks) => {
      entered.resolve(); await barrier.promise
      nextCallbacks?.onComplete?.({ ...stopped, state: 'completed' })
      return { state: 'completed', confirmedBy: 'execution-accepted', initialOutput: '', stderr: '', session: { state: 'completed', stop: async () => stopped, dispose: () => {} } }
    })
    const operation = render().run()
    await entered.promise
    expect(render().state).toBe('starting')
    await Promise.all([render().run(), render().write(), render().stop()])
    barrier.resolve(); await operation
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(1)
    expect(render().state).toBe('raw-repl-ready')
    await render().run()
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(2)
  })

  it('保存確認の取消では実行中プログラムを止めない', async () => {
    await startProgram()
    vi.mocked(confirm).mockReturnValueOnce(false)
    await render().write()
    expect(RawReplClient.prototype.stopLongRunning).not.toHaveBeenCalled()
    expect(render().state).toBe('running-no-marker')
  })
})
