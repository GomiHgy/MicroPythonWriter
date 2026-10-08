import { afterEach, describe, expect, it, vi } from 'vitest'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import { DeviceRestartError } from '../types'

afterEach(() => vi.restoreAllMocks())

function fixture() {
  const device = new MicroPythonDevice({} as never)
  const discard = vi.spyOn(device.files, 'discardPreparedProgram').mockResolvedValue()
  const execute = vi.spyOn(device.repl, 'execute').mockResolvedValue({ stdout: '__M5_BLE_PREPARED__\r\n', stderr: '', completed: true, interrupted: false, durationMs: 0 })
  const write = vi.spyOn(device.files, 'writeMain')
  const boot = vi.spyOn(device.boot, 'set')
  return { device, discard, execute, write, boot }
}

describe('BLE先行準備の機器側処理', () => {
  it('旧実行準備を解放してから有限コマンドを一度だけ実行し、ファイルと起動設定を変えない', async () => {
    const { device, discard, execute, write, boot } = fixture()
    await device.prepareBleForRun()
    expect(discard).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
    expect(discard.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0])
    expect(execute.mock.calls[0][0]).toContain('ble.active(True)')
    expect(write).not.toHaveBeenCalled()
    expect(boot).not.toHaveBeenCalled()
  })
  it.each([
    { stdout: '', stderr: '' },
    { stdout: 'prefix__M5_BLE_PREPARED__\n', stderr: '' },
    { stdout: '__M5_BLE_PREPARED__\n', stderr: 'ImportError: no module named bluetooth' },
    { stdout: '__M5_BLE_PREPARED__\n', stderr: '', completed: false },
    { stdout: '__M5_BLE_PREPARED__\n', stderr: '', interrupted: true },
  ])('正常終端と独立した成功行がなければ止める: %j', async overrides => {
    const { device, execute, write } = fixture()
    execute.mockResolvedValueOnce({ completed: true, interrupted: false, durationMs: 0, ...overrides })
    await expect(device.prepareBleForRun()).rejects.toThrow('BLE先行準備の完了を確認できませんでした')
    expect(write).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
  })
  it('参照解放が失敗したらBLEを有効化しない', async () => {
    const { device, discard, execute } = fixture()
    discard.mockRejectedValueOnce(new Error('cleanup failed'))
    await expect(device.prepareBleForRun()).rejects.toThrow('cleanup failed')
    expect(execute).not.toHaveBeenCalled()
  })
  it('native panicを保持し、後始末や再試行のコマンドを送らない', async () => {
    const { device, execute } = fixture()
    const panic = new DeviceRestartError('panic')
    execute.mockRejectedValueOnce(panic)
    await expect(device.prepareBleForRun()).rejects.toBe(panic)
    expect(execute).toHaveBeenCalledOnce()
  })
})
