import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProgrammer } from '../hooks/useProgrammer'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import { RawReplClient, type LongRunningCallbacks, type LongRunningCompletion, type LongRunningConfirmation } from '../services/micropython/RawReplClient'
import { FileTransferService } from '../services/micropython/FileTransferService'
import { DeviceProbe } from '../services/micropython/DeviceProbe'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { SerialStateMachine } from '../services/serial/SerialStateMachine'
import { DeviceTimeoutError, SerialDisconnectedError } from '../types'
import { workshopPresets } from '../config/workshops'
import { createWorkshopContext, type WorkshopContext } from '../services/prompt/WorkshopRules'

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, mounted: false, effects: [] as Array<() => unknown> }))
vi.mock('react', () => ({
  useCallback: <Value,>(value: Value, dependencies?: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.slots[index] as { value: Value; dependencies?: unknown[] } | undefined
    if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) hooks.slots[index] = { value, dependencies }
    return (hooks.slots[index] as { value: Value }).value
  },
  useRef: <Value,>(initial: Value) => {
    const index = hooks.cursor++
    if (!hooks.mounted) hooks.slots[index] = { current: initial }
    return hooks.slots[index]
  },
  useMemo: <Value,>(factory: () => Value, dependencies?: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.slots[index] as { value: Value; dependencies?: unknown[] } | undefined
    if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) hooks.slots[index] = { value: factory(), dependencies }
    return (hooks.slots[index] as { value: Value }).value
  },
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = hooks.cursor++
    if (!hooks.mounted) hooks.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [hooks.slots[index], (next: Value | ((previous: Value) => Value)) => {
      hooks.slots[index] = typeof next === 'function' ? (next as (previous: Value) => Value)(hooks.slots[index] as Value) : next
    }]
  },
  useEffect: (effect: () => unknown, dependencies?: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.slots[index] as { dependencies?: unknown[]; cleanup?: () => void } | undefined
    if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
      hooks.effects.push(() => {
        previous?.cleanup?.()
        const cleanup = effect()
        hooks.slots[index] = { dependencies, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
      })
    }
  },
}))

function HookHarness() { return useProgrammer(selectedWorkshop) }

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
let selectedWorkshop: WorkshopContext | null = null

function completeStop() {
  active = false
  callbacks.at(-1)?.onComplete?.(stopped)
  return stopped
}

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.mounted = false; hooks.effects = []
  active = false; callbacks = []; confirmedBy = 'still-running'
  selectedWorkshop = null
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

function kit(kitId: string) {
  return createWorkshopContext({ ...workshopPresets[0].profile, kitId, firmwareVersion: `target-${kitId}`, ledModel: 'test-RGB', ledCount: 37, maxBrightnessPercent: 25 })
}

describe('修正依頼のコードと教材のスナップショット', () => {
  it('実行後にコード・キットを変更しても、実行時の文脈と最新ログを使う', async () => {
    selectedWorkshop = kit('007')
    await render().connect()
    render().setSource('print("running-007")\nraise ValueError("failure")')
    await render().run()
    render().setSource('print("unrelated-008")')
    selectedWorkshop = kit('008')
    render().setLog('z'.repeat(9000) + '\nlatest-device-failure')
    callbacks[0].onComplete?.({ ...stopped, state: 'error', intentionalStop: false, stderr: 'Traceback (most recent call last):\n  File "main.py", line 2\nValueError: failure' })
    const error = render().error!
    expect(error.sourceSnapshot).toBe('print("running-007")\nraise ValueError("failure")')
    expect(error.codeLine).toBe('raise ValueError("failure")')
    expect(error.deviceSnapshot?.microPythonVersion).toBe('test')
    expect(error.repairPrompt).toContain('target-007')
    expect(error.repairPrompt).toContain('latest-device-failure')
    expect(error.repairPrompt).not.toContain('z'.repeat(8001))
    expect(error.repairPrompt).not.toContain('unrelated-008')
    expect(error.repairPrompt).not.toContain('target-008')
  })

  it('手動停止時のエラーも停止ボタンを押した時の編集内容と混同しない', async () => {
    selectedWorkshop = kit('010')
    await render().connect()
    render().setSource('print("running-code")')
    await render().run()
    render().setSource('print("not-yet-running")')
    selectedWorkshop = kit('011')
    vi.mocked(RawReplClient.prototype.stopLongRunning).mockResolvedValueOnce({ ...stopped, state: 'error', hostError: new Error('stop-host-error') })
    await render().stop()
    const prompt = render().error!.repairPrompt
    expect(prompt).toContain('running-code')
    expect(prompt).toContain('target-010')
    expect(prompt).not.toContain('not-yet-running')
    expect(prompt).not.toContain('target-011')
  })

  it('再実行の自動停止が失敗した場合は、まだ実行中だったコードを示す', async () => {
    selectedWorkshop = kit('020')
    await render().connect()
    render().setSource('print("old-running")')
    await render().run()
    render().setSource('print("next-version")')
    selectedWorkshop = kit('021')
    vi.mocked(RawReplClient.prototype.stopLongRunning).mockRejectedValueOnce(new Error('stop failed'))
    await render().run()
    expect(render().error!.repairPrompt).toContain('old-running')
    expect(render().error!.repairPrompt).toContain('target-020')
    expect(render().error!.repairPrompt).not.toContain('next-version')
  })

  it.each(['write', 'validate', 'start'] as const)('%sの待機中の編集・設定変更で失敗対象を取り違えない', async phase => {
    selectedWorkshop = kit('030')
    await render().connect()
    render().setSource('print("attempted-source")')
    const barrier = deferred()
    const entered = deferred()
    const fail = async () => { entered.resolve(); await barrier.promise; throw new Error(`${phase} failed`) }
    if (phase === 'write') vi.mocked(FileTransferService.prototype.writeMain).mockImplementationOnce(fail)
    if (phase === 'validate') vi.mocked(MicroPythonDevice.prototype.validateMain).mockImplementationOnce(fail)
    if (phase === 'start') vi.mocked(RawReplClient.prototype.startLongRunning).mockImplementationOnce(fail)
    const operation = render().run()
    await entered.promise
    selectedWorkshop.profile.kitId = 'mutated'
    selectedWorkshop.rules = 'mutated-rules'
    selectedWorkshop = kit('031')
    render().setSource('print("later-edit")')
    render().setLog('log-after-async-operation-start')
    barrier.resolve(); await operation
    const prompt = render().error!.repairPrompt
    expect(prompt).toContain('attempted-source')
    expect(prompt).toContain('target-030')
    expect(prompt).toContain('log-after-async-operation-start')
    expect(prompt).not.toContain('later-edit')
    expect(prompt).not.toContain('mutated-rules')
    expect(prompt).not.toContain('target-031')
  })

  it('キットの変更と解除だけでは通信オブジェクト・プログラム・編集中コードを変更しない', async () => {
    selectedWorkshop = kit('040')
    const dispose = vi.spyOn(WebSerialTransport.prototype, 'dispose')
    const stop = vi.spyOn(MicroPythonDevice.prototype, 'stopMain')
    await render().connect()
    render().setSource('print("kept")')
    await render().run()
    const originalSerialListener = vi.mocked(navigator.serial!.addEventListener).mock.calls[0][1]
    selectedWorkshop = kit('041')
    render()
    selectedWorkshop = null
    const app = render()
    expect(app.source).toBe('print("kept")')
    expect(app.state).toBe('running-no-marker')
    expect(WebSerialTransport.prototype.connect).toHaveBeenCalledTimes(1)
    expect(WebSerialTransport.prototype.disconnect).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(1)
    expect(navigator.serial!.addEventListener).toHaveBeenCalledTimes(1)
    expect(vi.mocked(navigator.serial!.addEventListener).mock.calls[0][1]).toBe(originalSerialListener)
  })

  it('機器の既存コードが不明なら編集欄を実行コード扱いせず、不正な教材も明示する', async () => {
    selectedWorkshop = createWorkshopContext(workshopPresets[0].profile)
    await render().connect()
    render().setSource('print("unrelated-local-editor")')
    vi.mocked(MicroPythonDevice.prototype.enterNormalMode).mockRejectedValueOnce(new Error('sync failure'))
    await render().normalMode()
    const error = render().error!
    expect(error.sourceKnown).toBe(false)
    expect(error.sourceSnapshot).toBeUndefined()
    expect(error.repairPrompt).toContain('機器で実行されたmain.pyは未取得')
    expect(error.repairPrompt).toContain('対応は未確認')
    expect(error.repairPrompt).toContain('設定が未設定または不正')
    expect(error.repairPrompt).not.toContain('unrelated-local-editor')
  })

  it.each(['load', 'save'] as const)('%sしたコードを後の機器操作時にも対応づける', async kind => {
    selectedWorkshop = kit('050')
    await render().connect()
    if (kind === 'load') {
      vi.spyOn(FileTransferService.prototype, 'readMain').mockResolvedValueOnce('print("known-device-file")')
      await render().load()
    } else {
      render().setSource('print("known-device-file")')
      await render().write()
    }
    selectedWorkshop = kit('051')
    render().setSource('print("not-device-file")')
    vi.mocked(MicroPythonDevice.prototype.enterNormalMode).mockRejectedValueOnce(new Error('sync failure'))
    await render().normalMode()
    expect(render().error!.sourceSnapshot).toBe('print("known-device-file")')
    expect(render().error!.repairPrompt).toContain('target-050')
    expect(render().error!.repairPrompt).not.toContain('target-051')
  })

  it('ローカル保存が利用不可でも編集・実行を継続できる', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } })
    expect(render().source).toContain('Hello from M5NanoC6')
    await render().connect()
    render().setSource('print("memory-only")')
    await render().run()
    expect(render().state).toBe('running-no-marker')
    expect(FileTransferService.prototype.writeMain).toHaveBeenLastCalledWith('print("memory-only")')
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
