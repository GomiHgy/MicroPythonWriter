import { afterEach, describe, expect, it, vi } from 'vitest'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import { clearPreparedProgramCommand } from '../services/micropython/ProgramCommands'
import { ByteQueue } from '../services/serial/ByteQueue'
import { DeviceTimeoutError, RawReplProtocolError, ReplNotAvailableError, SerialDisconnectedError, type ExecutionResult } from '../types'
import type { LongRunningCompletion } from '../services/micropython/RawReplClient'

const ready: ExecutionResult = { stdout: '__M5_NORMAL_MODE_READY__\n', stderr: '', completed: true, interrupted: false, durationMs: 0 }
const stopped: LongRunningCompletion = { stdout: '', stderr: '', state: 'stopped', intentionalStop: true }

function fixture(managed = false) {
  const device = new MicroPythonDevice({} as never)
  const order: string[] = []
  const invalidate = vi.spyOn(device.files, 'invalidatePreparedProgram').mockImplementation(() => { order.push('invalidate') })
  vi.spyOn(device.repl, 'hasLongRunningSession').mockReturnValue(managed)
  const stop = vi.spyOn(device.repl, 'stopLongRunning').mockImplementation(async () => { order.push('stop'); return stopped })
  const interrupt = vi.spyOn(device.repl, 'interrupt').mockImplementation(async () => { order.push('interrupt') })
  const discard = vi.spyOn(device.repl, 'discardPendingInput').mockImplementation(() => { order.push('discard'); return new Uint8Array() })
  const enter = vi.spyOn(device.repl, 'enterRawRepl').mockImplementation(async () => { order.push('raw') })
  const execute = vi.spyOn(device.repl, 'execute').mockImplementation(async () => { order.push('cleanup'); return ready })
  const reset = vi.spyOn(device.repl, 'reset')
  return { device, order, invalidate, stop, interrupt, discard, enter, execute, reset }
}

afterEach(() => vi.useRealTimers())

describe('リセットせずUSB操作を復旧する', () => {
  it('実際のRaw REPLクライアントでも自動起動中の模擬機器を止め、リセットせず復旧する', async () => {
    vi.useFakeTimers()
    const queue = new ByteQueue()
    const encoder = new TextEncoder()
    const commands: string[] = []
    let automaticallyRunning = true
    let pendingCode = ''
    const device = new MicroPythonDevice({ queue, write: async (bytes: Uint8Array) => {
      if (bytes.every(value => value === 3)) { automaticallyRunning = false; queue.push(encoder.encode('KeyboardInterrupt:\r\n>>> ')); return }
      if (bytes.length === 1 && bytes[0] === 1) { if (!automaticallyRunning) queue.push(encoder.encode('raw REPL; CTRL-B to exit\r\n>')); return }
      if (bytes.length === 1 && bytes[0] === 4) { queue.push(new Uint8Array([...encoder.encode('OK__M5_NORMAL_MODE_READY__\n'), 4, 4, 62])); commands.push(pendingCode); return }
      pendingCode = new TextDecoder().decode(bytes)
    } } as never)
    const pending = device.enterNormalMode()
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toBeUndefined()
    expect(automaticallyRunning).toBe(false)
    expect(commands).toHaveLength(1)
    expect(commands.join('\n')).not.toMatch(/soft_reset|machine\.reset|boot_option|NVS|open\(/)
  })

  it('本体で自動起動したプログラムを割り込み、古い入力を捨ててRaw REPLを確保する', async () => {
    const { device, order, stop, execute, reset } = fixture()
    await device.enterNormalMode()
    expect(order).toEqual(['invalidate', 'interrupt', 'discard', 'raw', 'cleanup'])
    expect(stop).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][0]).toContain(clearPreparedProgramCommand())
    expect(execute.mock.calls[0][0]).not.toMatch(/soft_reset|machine\.reset|boot_option|NVS|open\(|remove\(|rename\(/)
    expect(reset).not.toHaveBeenCalled()
  })

  it('Writerの常駐プログラムは停止確認を済ませてから復旧する', async () => {
    const { device, order } = fixture(true)
    await device.enterNormalMode()
    expect(order).toEqual(['invalidate', 'stop', 'interrupt', 'discard', 'raw', 'cleanup'])
  })

  it.each(['KeyboardInterrupt', 'KeyboardInterrupt:', 'Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n  File "/flash/main.py", line 3, in main\nKeyboardInterrupt:'])('意図したKeyboardInterruptだけは正常な停止として扱う (%s)', async stderr => {
    const { device, stop, enter } = fixture(true)
    stop.mockResolvedValueOnce({ ...stopped, stderr })
    await expect(device.enterNormalMode()).resolves.toBeUndefined()
    expect(enter).toHaveBeenCalledOnce()
  })

  it.each([
    undefined,
    { ...stopped, state: 'error' as const },
    { ...stopped, stderr: 'RuntimeError: cleanup failed' },
    { ...stopped, stderr: 'KeyboardInterrupt:', intentionalStop: false },
    { ...stopped, stderr: 'RuntimeError: earlier failure\nKeyboardInterrupt:' },
  ])('停止を確認できない応答やstderrを握りつぶさない (%j)', async response => {
    const { device, stop, interrupt, enter, execute } = fixture(true)
    stop.mockResolvedValueOnce(response)
    await expect(device.enterNormalMode()).rejects.toBeInstanceOf(RawReplProtocolError)
    expect(interrupt).not.toHaveBeenCalled()
    expect(enter).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'hostError'] as const)('停止時の通信エラーを維持する (%s)', async kind => {
    const { device, stop, interrupt, execute } = fixture(true)
    const error = new SerialDisconnectedError('lost during stop')
    if (kind === 'rejected') stop.mockRejectedValueOnce(error)
    else stop.mockResolvedValueOnce({ ...stopped, hostError: error })
    await expect(device.enterNormalMode()).rejects.toBe(error)
    expect(interrupt).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('Ctrl-C送信失敗後に有限コマンドを送らない', async () => {
    const { device, interrupt, enter, execute } = fixture()
    const error = new SerialDisconnectedError()
    interrupt.mockRejectedValueOnce(error)
    await expect(device.enterNormalMode()).rejects.toBe(error)
    expect(enter).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('Raw REPLが返らないときは再試行やリセットで強行せず停止する', async () => {
    const { device, enter, execute, reset } = fixture()
    enter.mockRejectedValueOnce(new ReplNotAvailableError())
    await expect(device.enterNormalMode()).rejects.toBeInstanceOf(ReplNotAvailableError)
    expect(enter).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  it.each([
    { ...ready, stdout: '' },
    { ...ready, stderr: 'MemoryError: cleanup failed' },
    { ...ready, completed: false },
    { ...ready, interrupted: true },
  ])('参照解放の完了を確認できなければ復旧成功にしない (%j)', async response => {
    const { device, execute } = fixture()
    execute.mockResolvedValueOnce(response)
    await expect(device.enterNormalMode()).rejects.toBeInstanceOf(RawReplProtocolError)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('ネイティブハングやCtrl-C無視を想定し、実際のRaw REPL待機は有限時間で終了する', async () => {
    vi.useFakeTimers()
    const queue = new ByteQueue()
    const write = vi.fn<(data: Uint8Array) => Promise<void>>().mockResolvedValue(undefined)
    const device = new MicroPythonDevice({ queue, write } as never)
    const failure = device.enterNormalMode().catch(error => error)
    await vi.advanceTimersByTimeAsync(4000)
    expect(await failure).toBeInstanceOf(ReplNotAvailableError)
    expect(write.mock.calls.map(call => Array.from(call[0]))).toEqual([[3], [3], [3], [3, 3], [1]])
  })

  it('常駐停止のタイムアウトを上位へ返して復旧コマンドを続けない', async () => {
    const { device, stop, execute } = fixture(true)
    const error = new DeviceTimeoutError('stop timeout')
    stop.mockRejectedValueOnce(error)
    await expect(device.enterNormalMode()).rejects.toBe(error)
    expect(execute).not.toHaveBeenCalled()
  })
})
