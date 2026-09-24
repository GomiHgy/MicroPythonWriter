import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import { clearPreparedProgramCommand, startPreparedProgramCommand, verifyPreparedProgramCommand } from '../services/micropython/ProgramCommands'
import { type ExecutionResult, SerialDisconnectedError } from '../types'
import { FakeMicroPythonRepl } from './fakes'

const result = (stdout = '', stderr = ''): ExecutionResult => ({ stdout, stderr, durationMs: 0, interrupted: false, completed: true })
const source = 'print("作品🌟")\n'
const promotion = (code: string) => code.includes('os.rename("/flash/main.py.tmp"')

function fixture() {
  const fake = new FakeMicroPythonRepl()
  const device = new MicroPythonDevice({} as never)
  const execute = vi.spyOn(device.repl, 'execute').mockImplementation(code => {
    if (code.includes('def _mpw_verify():')) return Promise.resolve(result('__M5_COMPILE_OK__\n'))
    return fake.execute(code)
  })
  const started = { state: 'completed' as const, initialOutput: '作品🌟', stderr: '', confirmedBy: 'execution-accepted' as const, session: { state: 'completed' as const, stop: vi.fn(), dispose: vi.fn() } }
  const start = vi.spyOn(device.repl, 'startLongRunning').mockResolvedValue(started)
  return { fake, device, files: device.files, execute, start, started }
}

describe('実行準備とファイル書込みの連携', () => {
  it('保存確認が完了するまでは実行を許可せず、UTF-8内容のSHA-256と単発トークンを結び付ける', async () => {
    const { fake, files, execute } = fixture()
    execute.mockImplementation(async code => {
      expect(files.peekPreparedProgram()).toBeUndefined()
      return fake.execute(code)
    })
    await files.writeMain(source, true, true)
    const prepared = files.peekPreparedProgram()!
    expect(prepared).toEqual({ token: expect.any(String), path: '/flash/main.py', byteLength: Buffer.byteLength(source), digest: createHash('sha256').update(source).digest('hex') })
    expect(fake.commands.filter(code => code.includes('return compile('))).toHaveLength(1)
    expect(fake.commands.at(-1)).toContain('__MAIN_SIZE__')
    prepared.token = 'cannot-modify-internal-state'
    expect(files.peekPreparedProgram()?.token).not.toBe(prepared.token)
  })

  it('再実行は新しいトークンを使い、保存だけでは実行コードを保持しない', async () => {
    const { files, fake } = fixture()
    await files.writeMain(source, true, true)
    const first = files.peekPreparedProgram()!
    await files.writeMain(source, true, true)
    expect(files.peekPreparedProgram()?.token).not.toBe(first.token)
    await files.writeMain(source)
    expect(files.peekPreparedProgram()).toBeUndefined()
    expect(fake.commands.filter(code => code.includes('def _mpw_compile():')).at(-1)).not.toContain('_mpw_prepared=(')
  })

  it.each(['stderr', 'missing marker', 'size', 'promotion', 'saved size', 'disconnect'] as const)('%s の失敗後は実行できない', async failure => {
    const { files, fake, execute, device, start } = fixture()
    fake.files.set('/flash/main.py', new TextEncoder().encode('old main'))
    execute.mockImplementation(async code => {
      if (code.includes('def _mpw_compile():')) {
        if (failure === 'stderr') return result('', 'ImportError: no module named hashlib')
        if (failure === 'missing marker') return result(`__SIZE__${Buffer.byteLength(source)}\n`)
        if (failure === 'size') return result('__SIZE__1\n__M5_COMPILE_OK__\n')
        if (failure === 'disconnect') throw new SerialDisconnectedError()
      }
      if (promotion(code) && failure === 'promotion') return result('', 'OSError: rename failed')
      if (code.includes('__MAIN_SIZE__') && failure === 'saved size') return result('__MAIN_SIZE__1\n')
      return fake.execute(code)
    })
    const error = await files.writeMain(source, true, true).catch(error => error)
    expect(error).toBeInstanceOf(Error)
    if (failure === 'stderr') expect(error.message).toContain('ImportError: no module named hashlib')
    expect(files.peekPreparedProgram()).toBeUndefined()
    expect(execute.mock.calls.at(-1)?.[0]).toBe(clearPreparedProgramCommand())
    await expect(device.startMain()).rejects.toThrow('実行準備がありません')
    expect(start).not.toHaveBeenCalled()
    if (['stderr', 'missing marker', 'size', 'disconnect'].includes(failure)) {
      expect(fake.commands.some(promotion)).toBe(false)
      expect(new TextDecoder().decode(fake.files.get('/flash/main.py'))).toBe('old main')
    }
  })

  it('次の書込みが最初に失敗しても以前の実行準備へ戻さない', async () => {
    const { files, execute } = fixture()
    await files.writeMain(source, true, true)
    execute.mockRejectedValueOnce(new SerialDisconnectedError())
    await expect(files.writeMain(source, true, true)).rejects.toBeInstanceOf(SerialDisconnectedError)
    expect(files.peekPreparedProgram()).toBeUndefined()
    expect(files.takePreparedProgram()).toBeUndefined()
  })

  it('接続喪失で後始末も失敗した場合に元のエラーを維持する', async () => {
    const { files, execute, fake } = fixture()
    const failure = new SerialDisconnectedError('first failure')
    execute.mockImplementation(async code => {
      if (code.includes('def _mpw_compile():')) throw failure
      if (code === clearPreparedProgramCommand()) throw new Error('cleanup failed')
      return fake.execute(code)
    })
    await expect(files.writeMain(source, true, true)).rejects.toBe(failure)
    expect(files.peekPreparedProgram()).toBeUndefined()
  })

  it.each(['restoreBackup', 'removeMain'] as const)('%s の前に実行準備を破棄する', async operation => {
    const { files, execute } = fixture()
    await files.writeMain(source, true, true)
    execute.mockClear()
    await files[operation]()
    expect(execute.mock.calls[0][0]).toBe(clearPreparedProgramCommand())
    expect(files.peekPreparedProgram()).toBeUndefined()
  })
})

describe('準備したコードを単発で実行する', () => {
  it('照合は再コンパイルせず、実行準備を消費して同じコールバックへ結果を返す', async () => {
    const { files, device, execute, start, started } = fixture()
    await files.writeMain(source, true, true)
    const prepared = files.peekPreparedProgram()!
    await device.validateMain()
    expect(execute).toHaveBeenLastCalledWith(verifyPreparedProgramCommand(prepared))
    expect(files.peekPreparedProgram()).toEqual(prepared)
    const callbacks = { onOutput: vi.fn(), onComplete: vi.fn() }
    await expect(device.startMain(callbacks)).resolves.toBe(started)
    expect(start).toHaveBeenCalledWith(startPreparedProgramCommand(prepared), callbacks)
    expect(start.mock.calls[0][0]).not.toContain('compile(')
    expect(start.mock.calls[0][0]).not.toContain('.read()')
    expect(files.peekPreparedProgram()).toBeUndefined()
    await expect(device.startMain()).rejects.toThrow('実行準備がありません')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it.each(['stderr', 'missing marker', 'disconnect'] as const)('照合が%sなら準備を破棄し起動しない', async failure => {
    const { files, device, execute, start } = fixture()
    await files.writeMain(source, true, true)
    if (failure === 'disconnect') execute.mockRejectedValueOnce(new SerialDisconnectedError())
    else execute.mockResolvedValueOnce(result('', failure === 'stderr' ? 'RuntimeError: PROGRAM_CHANGED' : ''))
    await expect(device.validateMain()).rejects.toBeInstanceOf(Error)
    expect(execute).toHaveBeenLastCalledWith(clearPreparedProgramCommand())
    expect(files.peekPreparedProgram()).toBeUndefined()
    await expect(device.startMain()).rejects.toThrow('実行準備がありません')
    expect(start).not.toHaveBeenCalled()
  })

  it('起動中の通信例外で準備を復活させず、動いている可能性のある機器へ有限コマンドを送らない', async () => {
    const { files, device, execute, start } = fixture()
    await files.writeMain(source, true, true)
    const failure = new SerialDisconnectedError()
    start.mockRejectedValueOnce(failure)
    execute.mockClear()
    await expect(device.startMain()).rejects.toBe(failure)
    expect(files.peekPreparedProgram()).toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
    await expect(device.startMain()).rejects.toThrow('実行準備がありません')
  })

  it('準備がない場合は照合もファイルからの代替実行も行わない', async () => {
    const { device, execute, start } = fixture()
    await expect(device.validateMain()).rejects.toThrow('実行準備がありません')
    await expect(device.startMain()).rejects.toThrow('実行準備がありません')
    expect(execute).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('通常動作の復旧前に準備を無効化し、リセットせず参照を解放する', async () => {
    const { files, device, execute } = fixture()
    await files.writeMain(source, true, true)
    vi.spyOn(device.repl, 'interrupt').mockImplementation(async () => { expect(files.peekPreparedProgram()).toBeUndefined() })
    vi.spyOn(device.repl, 'discardPendingInput').mockReturnValue(new Uint8Array())
    vi.spyOn(device.repl, 'enterRawRepl').mockResolvedValue()
    execute.mockResolvedValueOnce(result('__M5_NORMAL_MODE_READY__\n'))
    await device.enterNormalMode()
    expect(files.peekPreparedProgram()).toBeUndefined()
    expect(execute.mock.calls.at(-1)?.[0]).toContain(clearPreparedProgramCommand())
    expect(execute.mock.calls.at(-1)?.[0]).not.toContain('soft_reset')
  })
})

describe('保存済みコードのチャンク読込み', () => {
  it.each(['', '# 日本語🌟\n'.repeat(200)])('UTF-8を保ち全文保持するコマンドを送らない', async text => {
    const { files, fake, execute } = fixture()
    fake.files.set('/flash/main.py', new TextEncoder().encode(text))
    expect(await files.readMain()).toBe(text)
    const command = execute.mock.calls[0][0]
    expect(command).toContain('f.read(384)')
    expect(command).not.toContain('.read()')
    expect(command).toContain('del _mpw_read')
  })

  it('機器が返した例外を空ファイル扱いにしない', async () => {
    const { files, execute } = fixture()
    execute.mockResolvedValueOnce(result('', 'MemoryError: allocation failed'))
    await expect(files.readMain()).rejects.toThrow('MemoryError: allocation failed')
  })
})
