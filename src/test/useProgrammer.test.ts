import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProgrammer } from '../hooks/useProgrammer'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import { RawReplClient, type LongRunningCallbacks, type LongRunningCompletion, type LongRunningConfirmation } from '../services/micropython/RawReplClient'
import { FileTransferService } from '../services/micropython/FileTransferService'
import { DeviceProbe } from '../services/micropython/DeviceProbe'
import { BootModeService } from '../services/micropython/BootModeService'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { SerialStateMachine } from '../services/serial/SerialStateMachine'
import { DeviceTimeoutError, SerialDisconnectedError } from '../types'
import { workshopPresets } from '../config/workshops'
import { setLocale } from '../i18n'
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

function HookHarness() { return useProgrammer(selectedWorkshop, projectFallback, preferProjectSource) }

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
let projectFallback: string | undefined
let preferProjectSource = false

function completeStop() {
  active = false
  callbacks.at(-1)?.onComplete?.(stopped)
  return stopped
}

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.mounted = false; hooks.effects = []
  active = false; callbacks = []; confirmedBy = 'still-running'
  selectedWorkshop = null
  projectFallback = undefined; preferProjectSource = false
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  setLocale('ja')
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

function kit(label: string) {
  return createWorkshopContext({ ...workshopPresets[0].profile, firmwareVersion: `target-${label}`, ledModel: 'WS2812B', ledCount: 37, maxBrightnessPercent: 25 })
}

describe('修正依頼のコードと教材のスナップショット', () => {
  it.each(['', 'project source'])('一式保存した作品下書きのコードを古いmpw-sourceより優先する (%s)', source => {
    projectFallback = source; preferProjectSource = true
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'mpw-source' ? 'old independent source' : null, setItem: vi.fn() })
    expect(render().source).toBe(source)
  })
  it('一式下書きがなければ既存コードの自動保存を優先する', () => {
    projectFallback = 'old named project'
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'mpw-source' ? 'latest legacy draft' : null, setItem: vi.fn() })
    expect(render().source).toBe('latest legacy draft')
  })
  it('自動起動の書込みと再起動が成功した場合だけコードに結び付けて記録する', async () => {
    vi.spyOn(BootModeService.prototype, 'set').mockResolvedValue()
    vi.spyOn(BootModeService.prototype, 'reset').mockResolvedValue()
    await render().connect(); render().setSource('known main')
    await render().run(); await render().stop(); await render().setBoot(0)
    expect(render().state).toBe('disconnected')
    expect(render().info.bootOption).toBeUndefined()
    expect(render().bootConfigured).toEqual({ source: 'known main', mode: 0 })
    await render().connect()
    expect(render().bootConfigured).toBeNull()
  })
  it('自動起動設定失敗では持ち出し確認を解禁しない', async () => {
    vi.spyOn(BootModeService.prototype, 'set').mockRejectedValue(new Error('NVS failed'))
    vi.spyOn(BootModeService.prototype, 'reset').mockResolvedValue()
    await render().connect(); await render().run(); await render().stop(); await render().setBoot(0)
    expect(render().state).toBe('error')
    expect(render().bootConfigured).toBeNull()
    expect(BootModeService.prototype.reset).not.toHaveBeenCalled()
  })
  it('作品確認用のコード一致は書込み成功・実行受付後だけ記録する', async () => {
    await render().connect()
    expect(render().writtenSource).toBeNull()
    expect(render().runningSource).toBeNull()
    render().setSource('print("known")')
    await render().run()
    expect(render().writtenSource).toBe('print("known")')
    expect(render().runningSource).toBe('print("known")')
    render().setSource('print("edited")')
    expect(render().runningSource).toBe('print("known")')
    await render().stop()
    expect(render().writtenSource).toBe('print("known")')
    await render().disconnect()
    expect(render().writtenSource).toBeNull()
    expect(render().runningSource).toBeNull()
  })

  it('書込み失敗・切断時は過去のコード記録を動作確認に流用しない', async () => {
    await render().connect()
    await render().run()
    vi.mocked(FileTransferService.prototype.writeMain).mockRejectedValueOnce(new Error('write failed'))
    await render().run()
    expect(render().state).toBe('error')
    expect(render().writtenSource).toBeNull()
    expect(render().runningSource).toBeNull()
    disconnectDetected()
    expect(render().writtenSource).toBeNull()
    expect(render().runningSource).toBeNull()
  })
  it.each(['en', 'zh'] as const)('エラー後の言語変更 %s でも操作時のコード・機器・教材・ログを維持する', async locale => {
    selectedWorkshop = kit('007')
    await render().connect()
    render().setSource('print("running-007")\nraise ValueError("failure")')
    await render().run()
    render().setLog('original-device-log')
    callbacks[0].onComplete?.({ ...stopped, state: 'error', intentionalStop: false, stderr: 'Traceback (most recent call last):\n  File "main.py", line 2\nValueError: failure' })
    const original = render().error!
    selectedWorkshop = createWorkshopContext({ ...kit('008').profile, ledPin: 3, ledCount: 10, maxBrightnessPercent: 20 })
    render().setSource('print("unrelated-008")')
    render().setLog('unrelated-new-log')
    setLocale(locale)
    const translated = render().error!
    expect(translated.repairPrompt).toContain(locale === 'en' ? 'Respond in English' : '请用简体中文回答')
    expect(translated.repairPrompt).toContain('target-007')
    expect(translated.repairPrompt).toContain('LED_PIN: 2')
    expect(translated.repairPrompt).toContain('LED_COUNT: 37')
    expect(translated.repairPrompt).not.toContain('LED_PIN: 3')
    expect(translated.repairPrompt).toContain('original-device-log')
    expect(translated.repairPrompt).not.toContain('target-008')
    expect(translated.repairPrompt).not.toContain('unrelated-008')
    expect(translated.repairPrompt).not.toContain('unrelated-new-log')
    expect(translated.sourceSnapshot).toBe(original.sourceSnapshot)
    expect(translated.deviceSnapshot).toEqual(original.deviceSnapshot)
    expect(translated.traceback).toBe(original.traceback)
    expect(WebSerialTransport.prototype.connect).toHaveBeenCalledTimes(1)
    expect(FileTransferService.prototype.writeMain).toHaveBeenCalledTimes(1)
    expect(RawReplClient.prototype.startLongRunning).toHaveBeenCalledTimes(1)
  })

  it('USB切断後の新しい機器の同期失敗で、以前の機種を確認済みとして使わない', async () => {
    await render().connect()
    expect(render().info.nanoC6Confirmed).toBe(true)
    disconnectDetected()
    vi.mocked(MicroPythonDevice.prototype.enterNormalMode).mockRejectedValueOnce(new Error('new-device-sync-failure'))
    await render().connect()
    const app = render()
    expect(app.error?.message).toBe('new-device-sync-failure')
    expect(app.info.nanoC6Confirmed).toBe(false)
    expect(app.error?.deviceSnapshot?.deviceName).toBe('未接続')
    expect(app.error?.deviceSnapshot?.nanoC6Confirmed).toBe(false)
    expect(app.error?.deviceSnapshot?.boardId).toBeUndefined()
    expect(app.error?.repairPrompt).toContain('確認できた機種: 未確認')
    expect(app.error?.repairPrompt).toContain('SoC: 未確認')
  })

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
    selectedWorkshop.profile.displayName = 'mutated'
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

afterEach(() => { setLocale('ja'); vi.restoreAllMocks(); vi.unstubAllGlobals() })

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

describe('書込み・実行結果の構造化フィードバック', () => {
  it('接続だけでは結果を作らず、受け付けた操作から準備・書込み・構文確認・起動へ進む', async () => {
    expect(render().programFeedback).toBeNull()
    await render().run()
    expect(render().programFeedback).toBeNull()
    await render().connect()
    expect(render().programFeedback).toBeNull()
    render().setSource('print("snapshot")')
    const prepare = deferred(), write = deferred(), verify = deferred(), start = deferred()
    const preparing = deferred(), writing = deferred(), verifying = deferred(), starting = deferred()
    vi.spyOn(MicroPythonDevice.prototype, 'prepareForWrite').mockImplementationOnce(async () => { preparing.resolve(); await prepare.promise })
    vi.mocked(FileTransferService.prototype.writeMain).mockImplementationOnce(async () => { writing.resolve(); await write.promise; return 100 })
    vi.mocked(MicroPythonDevice.prototype.validateMain).mockImplementationOnce(async () => { verifying.resolve(); await verify.promise })
    vi.mocked(RawReplClient.prototype.startLongRunning).mockImplementationOnce(async (_code, nextCallbacks = {}) => {
      callbacks.push(nextCallbacks); starting.resolve(); await start.promise
      return { state: 'running', confirmedBy: 'startup-marker', initialOutput: '', stderr: '', session: { state: 'running', stop: async () => stopped, dispose: () => {} } }
    })
    const operation = render().run()
    await preparing.promise
    const id = render().programFeedback!.id
    expect(render().programFeedback).toEqual({ id, operation: 'run', source: 'print("snapshot")', phase: 'preparing', saved: false })
    render().setSource('print("later-edit")')
    prepare.resolve(); await writing.promise
    expect(render().programFeedback).toMatchObject({ id, phase: 'writing', saved: false })
    write.resolve(); await verifying.promise
    expect(render().programFeedback).toMatchObject({ id, phase: 'verifying', saved: true })
    verify.resolve(); await starting.promise
    expect(render().programFeedback).toMatchObject({ id, phase: 'starting', saved: true })
    start.resolve(); await operation
    expect(render().programFeedback).toEqual({ id, operation: 'run', source: 'print("snapshot")', phase: 'running', saved: true, confirmation: 'startup-marker' })
  })

  it.each(['prepare', 'write', 'verify', 'start'] as const)('%s失敗は成功と表示せず、保存完了前後を区別する', async stage => {
    await render().connect()
    render().setSource('attempted-code')
    const failure = new Error(`${stage}-failed`)
    if (stage === 'prepare') vi.spyOn(MicroPythonDevice.prototype, 'prepareForWrite').mockRejectedValueOnce(failure)
    if (stage === 'write') vi.mocked(FileTransferService.prototype.writeMain).mockRejectedValueOnce(failure)
    if (stage === 'verify') vi.mocked(MicroPythonDevice.prototype.validateMain).mockRejectedValueOnce(failure)
    if (stage === 'start') vi.mocked(RawReplClient.prototype.startLongRunning).mockRejectedValueOnce(failure)
    await render().run()
    expect(render().programFeedback).toMatchObject({ operation: 'run', phase: 'failed', failedAt: stage, message: `${stage}-failed`, saved: stage === 'verify' || stage === 'start', source: 'attempted-code' })
    expect(render().state).toBe('error')
    expect(render().runningSource).toBeNull()
  })

  it.each(['startup-marker', 'still-running', 'execution-accepted'] as const)('%sを保持し、後から届いた実行エラーで成功表示を置き換える', async confirmation => {
    confirmedBy = confirmation
    await startProgram()
    const feedback = render().programFeedback!
    expect(feedback).toMatchObject({ phase: 'running', saved: true, confirmation })
    render().setSource('not-the-running-source')
    callbacks[0].onComplete?.({ state: 'error', stdout: '', stderr: 'ValueError: runtime-error', intentionalStop: false })
    expect(render().programFeedback).toMatchObject({ id: feedback.id, source: feedback.source, phase: 'failed', saved: true, failedAt: 'runtime', confirmation })
    expect(render().programFeedback?.message).toContain('runtime-error')
    expect(render().runningSource).toBeNull()
  })

  it.each(['host', 'empty-stderr'] as const)('常駐処理の%sエラーも終了成功と混同しない', async kind => {
    await startProgram()
    callbacks[0].onComplete?.({ state: 'error', stdout: '', stderr: '', intentionalStop: false, hostError: kind === 'host' ? new Error('host failed') : undefined })
    expect(render().programFeedback).toMatchObject({ phase: 'failed', saved: true, failedAt: 'runtime' })
    expect(render().state).toBe('error')
  })

  it.each(['completed', 'error'] as const)('起動Promiseより先に%s通知が届いても、遅い起動結果で実行中へ戻さない', async finalState => {
    await render().connect()
    vi.mocked(RawReplClient.prototype.startLongRunning).mockImplementationOnce(async (_code, nextCallbacks) => {
      nextCallbacks?.onComplete?.({ state: finalState, stdout: '', stderr: finalState === 'error' ? 'RuntimeError: early-failure' : '', intentionalStop: false })
      return { state: 'running', confirmedBy: 'startup-marker', initialOutput: '', stderr: '', session: { state: finalState, stop: async () => stopped, dispose: () => {} } }
    })
    await render().run()
    expect(render().programFeedback).toMatchObject({ phase: finalState === 'error' ? 'failed' : 'completed', saved: true, confirmation: 'startup-marker' })
    expect(render().state).toBe(finalState === 'error' ? 'error' : 'raw-repl-ready')
    expect(render().runningSource).toBeNull()
  })

  it.each([true, false])('短いプログラムの正常終了を表示する（終了通知あり=%s）', async notify => {
    await render().connect()
    vi.mocked(RawReplClient.prototype.startLongRunning).mockImplementationOnce(async (_code, nextCallbacks) => {
      if (notify) nextCallbacks?.onComplete?.({ state: 'completed', stdout: 'done', stderr: '', intentionalStop: false })
      return { state: 'completed', confirmedBy: 'execution-accepted', initialOutput: 'done', stderr: '', session: { state: 'completed', stop: async () => stopped, dispose: () => {} } }
    })
    await render().run()
    expect(render().programFeedback).toMatchObject({ phase: 'completed', saved: true, confirmation: 'execution-accepted' })
    expect(render().state).toBe('raw-repl-ready')
  })

  it('起動後の自然終了で実行中表示を終了へ変える', async () => {
    await startProgram()
    callbacks[0].onComplete?.({ state: 'completed', stdout: 'done', stderr: '', intentionalStop: false })
    expect(render().programFeedback).toMatchObject({ phase: 'completed', saved: true })
    expect(render().runningSource).toBeNull()
  })

  it('意図した停止のKeyboardInterruptは失敗ではなく停止済みとして保持する', async () => {
    await startProgram()
    const previous = render().programFeedback!
    vi.mocked(RawReplClient.prototype.stopLongRunning).mockResolvedValueOnce({ ...stopped, stderr: 'Traceback:\nKeyboardInterrupt:' })
    await render().stop()
    expect(render().programFeedback).toEqual({ ...previous, id: previous.id + 1, phase: 'stopped' })
    expect(render().error).toBeUndefined()
    expect(render().runningSource).toBeNull()
    callbacks[0].onComplete?.({ state: 'error', stdout: '', stderr: 'late error', intentionalStop: false })
    expect(render().programFeedback?.phase).toBe('stopped')
  })

  it.each(['throw', 'host', 'runtime'] as const)('手動停止の%sエラーは保存成功と停止失敗を別に保持する', async kind => {
    await startProgram()
    if (kind === 'throw') vi.mocked(RawReplClient.prototype.stopLongRunning).mockRejectedValueOnce(new Error('stop-failed'))
    else vi.mocked(RawReplClient.prototype.stopLongRunning).mockResolvedValueOnce({ ...stopped, state: 'error', hostError: kind === 'host' ? new Error('stop-failed') : undefined, stderr: kind === 'runtime' ? 'RuntimeError: stop-failed' : '', intentionalStop: false })
    await render().stop()
    expect(render().programFeedback).toMatchObject({ phase: 'failed', saved: true, failedAt: 'stop' })
    expect(render().programFeedback?.message).toContain('stop-failed')
  })

  it('保存だけの操作は実行成功と区別し、結果を次の操作まで保持する', async () => {
    await render().connect()
    render().setSource('saved-program')
    await render().write()
    const feedback = render().programFeedback
    expect(feedback).toMatchObject({ operation: 'write', phase: 'saved', saved: true, source: 'saved-program' })
    expect(feedback?.confirmation).toBeUndefined()
    expect(MicroPythonDevice.prototype.validateMain).not.toHaveBeenCalled()
    expect(RawReplClient.prototype.startLongRunning).not.toHaveBeenCalled()
    render().setSource('later-edit'); render().setLog('log-cleared')
    expect(render().programFeedback).toEqual(feedback)
    vi.mocked(confirm).mockReturnValueOnce(false)
    await render().write()
    expect(render().programFeedback).toEqual(feedback)
  })

  it('保存確認の取消・起動中の連打では最後の結果を消さない', async () => {
    await startProgram()
    const previous = render().programFeedback
    vi.mocked(confirm).mockReturnValueOnce(false)
    await render().write()
    expect(render().programFeedback).toEqual(previous)
    const barrier = deferred(), entered = deferred()
    vi.spyOn(MicroPythonDevice.prototype, 'prepareForWrite').mockImplementationOnce(async () => { entered.resolve(); await barrier.promise })
    const operation = render().run()
    await entered.promise
    const inProgress = render().programFeedback
    await Promise.all([render().run(), render().write(), render().stop()])
    expect(render().programFeedback).toEqual(inProgress)
    barrier.resolve(); await operation
  })

  it.each(['prepare', 'write', 'verify', 'start'] as const)('%s待機中のUSB切断を表示し、遅い成功では上書きしない', async stage => {
    await render().connect()
    const barrier = deferred(), entered = deferred()
    const wait = async () => { entered.resolve(); await barrier.promise }
    if (stage === 'prepare') vi.spyOn(MicroPythonDevice.prototype, 'prepareForWrite').mockImplementationOnce(wait)
    if (stage === 'write') vi.mocked(FileTransferService.prototype.writeMain).mockImplementationOnce(async () => { await wait(); return 100 })
    if (stage === 'verify') vi.mocked(MicroPythonDevice.prototype.validateMain).mockImplementationOnce(wait)
    if (stage === 'start') vi.mocked(RawReplClient.prototype.startLongRunning).mockImplementationOnce(async (_code, nextCallbacks) => {
      await wait()
      nextCallbacks?.onComplete?.({ state: 'completed', stdout: '', stderr: '', intentionalStop: false })
      return { state: 'running', confirmedBy: 'still-running', initialOutput: '', stderr: '', session: { state: 'running', stop: async () => stopped, dispose: () => {} } }
    })
    const operation = render().run()
    await entered.promise
    disconnectDetected()
    const disconnected = render().programFeedback
    expect(disconnected).toMatchObject({ phase: 'disconnected', saved: stage === 'verify' || stage === 'start' })
    barrier.resolve(); await operation
    expect(render().programFeedback).toEqual(disconnected)
    expect(render().state).toBe('connection-lost')
  })

  it.each(['event', 'runtime-error', 'manual'] as const)('実行中のUSB切断（%s）で現在も実行中と表示しない', async kind => {
    await startProgram()
    if (kind === 'event') disconnectDetected()
    if (kind === 'runtime-error') callbacks[0].onComplete?.({ state: 'error', stdout: '', stderr: '', intentionalStop: false, hostError: new SerialDisconnectedError() })
    if (kind === 'manual') await render().disconnect()
    expect(render().programFeedback).toMatchObject({ phase: 'disconnected', saved: true })
    expect(render().runningSource).toBeNull()
  })

  it.each(['connect', 'reconnect'] as const)('%sで古い結果を消し、古い通知は新しい結果へ影響しない', async method => {
    vi.spyOn(WebSerialTransport.prototype, 'reconnect').mockResolvedValue()
    await startProgram()
    const oldCallbacks = callbacks[0]
    disconnectDetected(); active = false
    await render()[method]()
    expect(render().programFeedback).toBeNull()
    await render().run()
    const current = render().programFeedback
    oldCallbacks.onComplete?.({ state: 'error', stdout: '', stderr: 'old-error', intentionalStop: false })
    expect(render().programFeedback).toEqual(current)
  })

  it('USBイベントなしの書込み中の切断エラーも切断として表示する', async () => {
    await render().connect()
    vi.mocked(FileTransferService.prototype.writeMain).mockRejectedValueOnce(new SerialDisconnectedError())
    await render().write()
    expect(render().programFeedback).toMatchObject({ phase: 'disconnected', saved: false, failedAt: 'write' })
  })

  it('再接続後に旧操作が失敗しても新しい準備表示を壊さない', async () => {
    await render().connect()
    const oldBarrier = deferred(), oldEntered = deferred()
    vi.mocked(FileTransferService.prototype.writeMain).mockImplementationOnce(async () => { oldEntered.resolve(); await oldBarrier.promise; throw new Error('old failure') })
    const oldOperation = render().run()
    await oldEntered.promise
    disconnectDetected(); await render().connect()
    const newBarrier = deferred(), newEntered = deferred()
    vi.spyOn(MicroPythonDevice.prototype, 'prepareForWrite').mockImplementationOnce(async () => { newEntered.resolve(); await newBarrier.promise })
    const newOperation = render().run()
    await newEntered.promise
    const current = render().programFeedback
    oldBarrier.resolve(); await oldOperation
    expect(render().programFeedback).toEqual(current)
    expect(current?.phase).toBe('preparing')
    newBarrier.resolve(); await newOperation
    expect(render().programFeedback).toMatchObject({ id: current?.id, phase: 'running', saved: true })
  })

  it('同期操作で停止したプログラムを実行中と表示し続けない', async () => {
    await startProgram()
    await render().normalMode()
    expect(render().programFeedback).toMatchObject({ phase: 'stopped', saved: true })
    expect(render().runningSource).toBeNull()
  })

  it('同期操作の停止失敗も保存成功と分ける', async () => {
    await startProgram()
    vi.mocked(MicroPythonDevice.prototype.enterNormalMode).mockRejectedValueOnce(new Error('cannot stop'))
    await render().normalMode()
    expect(render().programFeedback).toMatchObject({ phase: 'failed', saved: true, failedAt: 'stop' })
  })

  it('リセット後は停止済みを示し、取消なら元の実行結果を保持する', async () => {
    vi.spyOn(BootModeService.prototype, 'reset').mockResolvedValue()
    await startProgram()
    const previous = render().programFeedback
    vi.mocked(confirm).mockReturnValueOnce(false)
    await render().reset()
    expect(render().programFeedback).toEqual(previous)
    await render().reset()
    expect(render().programFeedback).toMatchObject({ phase: 'stopped', saved: true })
    expect(render().state).toBe('disconnected')
  })

  it.each(['reset', 'setBoot'] as const)('%s前の停止失敗も実行中の成功表示のままにしない', async operation => {
    await startProgram()
    vi.mocked(RawReplClient.prototype.stopLongRunning).mockRejectedValueOnce(new Error('reset stop failed'))
    if (operation === 'reset') await render().reset()
    else await render().setBoot(0)
    expect(render().programFeedback).toMatchObject({ phase: 'failed', saved: true, failedAt: 'stop', message: 'reset stop failed' })
  })
})
