import { describe, expect, it, vi } from 'vitest'
import { ByteQueue } from '../services/serial/ByteQueue'
import { RawReplClient } from '../services/micropython/RawReplClient'
import { DeviceFaultMonitor, detectDeviceFault } from '../services/micropython/DeviceFault'
import { DeviceRestartError } from '../types'
import { TracebackParser } from '../services/micropython/TracebackParser'

const encode = (text: string) => new TextEncoder().encode(text)
const panic = "A fatal error occurred. The crash dump printed below may be used to help\r\nGuru Meditation Error: Core  0 panic'ed (Load access fault). Exception was unhandled.\r\nMTVAL: 0x000000a8\r\nRebooting...\r\nESP-ROM:esp32c6-20220919\r\n>>> "

function fixture(startupGrace = 10) {
  const queue = new ByteQueue()
  const write = vi.fn(async (data: Uint8Array) => { if (data.length === 1 && data[0] === 4) queue.push(encode('OK')) })
  const client = new RawReplClient({ queue, write } as never, { command: 30, startupGrace, stop: 20, rawRepl: 30 })
  return { client, queue, write }
}

describe('機器のpanic・再起動の検知', () => {
  it.each([panic, "Guru Meditation Error: Core 1 panic'ed (LoadProhibited).\n", 'ESP-ROM:esp32c6-20220919\n', 'ESP-ROM:esp32s3-20210327\r\n', 'MPY: soft reboot\n'])('1バイトずつ届いても検知する: %s', text => {
    const monitor = new DeviceFaultMonitor()
    const detected = [...encode(text)].map(byte => monitor.consume(byte)).find(Boolean)
    expect(detected).toBeInstanceOf(DeviceRestartError)
  })
  it.each(['説明: Guru Meditation Errorについて', 'please reboot', 'Rebooting...', 'ESP-ROMではありません', 'MPY: soft rebootについての説明\n', 'ESP-ROM:esp32c6について\n', 'x'.repeat(1000) + 'MPY: soft reboot\n'])('通常の出力を再起動扱いしない: %s', text => {
    const monitor = new DeviceFaultMonitor()
    expect([...encode(text)].map(byte => monitor.consume(byte)).filter(Boolean)).toEqual([])
  })
  it('起動猶予中のpanicをrunningにせず、終了・失敗を一度だけ通知する', async () => {
    const { client, queue, write } = fixture(1000)
    const complete = vi.fn()
    const starting = client.startLongRunning('while True: pass', { onComplete: complete })
    await vi.waitFor(() => expect(client.hasLongRunningSession()).toBe(true))
    queue.push(encode(panic))
    const result = await starting
    expect(result.state).toBe('completed')
    expect(result.hostError).toBeInstanceOf(DeviceRestartError)
    expect(result.session.state).toBe('error')
    expect(complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ state: 'error', intentionalStop: false, hostError: expect.any(DeviceRestartError) }))
    expect(client.hasLongRunningSession()).toBe(false)
    await expect(result.session.stop()).resolves.toMatchObject({ state: 'error' })
    expect(write.mock.calls.filter(([data]) => data.length === 1 && data[0] === 3)).toHaveLength(0)
    const count = write.mock.calls.length
    await expect(client.execute('print(1)')).rejects.toThrow('復旧または再接続')
    await expect(client.startLongRunning('pass')).rejects.toThrow('復旧または再接続')
    await expect(client.reset()).rejects.toThrow('復旧または再接続')
    expect(write).toHaveBeenCalledTimes(count)
  })
  it('実行中・停止待ちの再起動も意図した停止成功にはしない', async () => {
    const { client, queue } = fixture()
    const complete = vi.fn()
    const started = await client.startLongRunning('while True: pass', { onComplete: complete })
    expect(started.state).toBe('running')
    const stopping = started.session.stop()
    queue.push(encode('ESP-ROM:esp32c6-20220919\n>>> '))
    await expect(stopping).resolves.toMatchObject({ state: 'error', intentionalStop: false, hostError: expect.any(DeviceRestartError) })
    expect(complete).toHaveBeenCalledOnce()
    expect(client.hasLongRunningSession()).toBe(false)
    // 明示的なRaw REPL取得が成功した後だけ管理コマンドを許可する。
    const synchronizing = client.enterRawRepl()
    setTimeout(() => queue.push(encode('raw REPL; CTRL-B to exit\r\n>')), 90)
    await synchronizing
    await expect(client.reset()).resolves.toBeUndefined()
  })
  it('panic後にboot.pyのKeyboardInterruptが出ても本体クラッシュの記録を優先する', () => {
    const error = new TracebackParser().parse(panic + '\nTraceback (most recent call last):\nKeyboardInterrupt:\n', '', true)
    expect(error).toMatchObject({ exceptionType: 'DEVICE_PANIC', intentionalInterrupt: false })
    expect(error?.traceback).toContain('0x000000a8')
    expect(detectDeviceFault('MPY: soft reboot\n')?.reason).toBe('restart')
  })
})
