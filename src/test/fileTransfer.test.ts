import { describe, expect, it, vi } from 'vitest'
import { FileTransferService } from '../services/micropython/FileTransferService'
import { FileSystemError, type ExecutionResult } from '../types'
import { FakeMicroPythonRepl } from './fakes'

const main = '/flash/main.py'
const temporary = `${main}.tmp`
const backup = `${main}.bak`
const oldSource = 'print(1)'
const newSource = 'print(2)'
const encoder = new TextEncoder()
const result = (stderr: string): ExecutionResult => ({ stdout: '', stderr, durationMs: 0, interrupted: false, completed: true })
const promotion = (code: string) => code.includes('os.rename("/flash/main.py.tmp"')
const rollback = (code: string) => code.includes('os.rename("/flash/main.py.bak"')

function fixture() {
  const fake = new FakeMicroPythonRepl()
  fake.files.set(main, encoder.encode(oldSource))
  const originalExecute = fake.execute.bind(fake)
  const execute = vi.spyOn(fake, 'execute')
  const service = new FileTransferService(fake as never, 4)
  return { fake, execute, originalExecute, service }
}

describe('main.py書込みの機器側エラー判定', () => {
  it('同じサイズの古いmain.pyが残っていても、最終renameのstderrを成功にしない', async () => {
    const { fake, execute, originalExecute, service } = fixture()
    const stderr = 'Traceback (most recent call last):\nOSError: rename failed'
    execute.mockImplementation(async code => {
      if (promotion(code)) { fake.commands.push(code); return result(stderr) }
      return originalExecute(code)
    })
    expect(encoder.encode(newSource).length).toBe(fake.files.get(main)?.length)
    const failure = await service.writeMain(newSource).catch(error => error)
    expect(failure).toBeInstanceOf(FileSystemError)
    expect(failure.message).toBe(stderr)
    expect(new TextDecoder().decode(fake.files.get(main))).toBe(oldSource)
    expect(fake.commands.some(rollback)).toBe(true)
    expect(fake.commands.some(code => code.includes('__MAIN_SIZE__'))).toBe(false)
  })

  it('元main.pyの退避後に最終renameが失敗した場合は既存の復旧処理を呼ぶ', async () => {
    const { fake, execute, originalExecute, service } = fixture()
    execute.mockImplementation(async code => {
      if (promotion(code)) {
        fake.commands.push(code)
        fake.files.set(backup, fake.files.get(main)!)
        fake.files.delete(main)
        return result('OSError: final rename failed')
      }
      if (rollback(code)) {
        fake.commands.push(code)
        fake.files.set(main, fake.files.get(backup)!)
        fake.files.delete(backup)
        return result('')
      }
      return originalExecute(code)
    })
    await expect(service.writeMain(newSource)).rejects.toThrow('final rename failed')
    expect(new TextDecoder().decode(fake.files.get(main))).toBe(oldSource)
    expect(fake.commands.at(-1)).toSatisfy(rollback)
  })

  it('tmp作成のstderrではチャンク送信・検証・置換を始めない', async () => {
    const { fake, execute, service } = fixture()
    execute.mockResolvedValueOnce(result('OSError: read-only filesystem'))
    await expect(service.writeMain(newSource)).rejects.toBeInstanceOf(FileSystemError)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toContain("'wb'")
    expect(new TextDecoder().decode(fake.files.get(main))).toBe(oldSource)
  })

  it.each([1, 2])('%i個目のチャンクのstderrで中断し、古いmain.pyを変更しない', async chunkNumber => {
    const { fake, execute, originalExecute, service } = fixture()
    let chunks = 0
    execute.mockImplementation(async code => {
      if (code.includes("'ab'") && ++chunks === chunkNumber) { fake.commands.push(code); return result('OSError: no space left') }
      return originalExecute(code)
    })
    await expect(service.writeMain(newSource)).rejects.toThrow('no space left')
    expect(chunks).toBe(chunkNumber)
    expect(fake.commands.some(code => code.includes('__SIZE__'))).toBe(false)
    expect(fake.commands.some(promotion)).toBe(false)
    expect(fake.commands.some(rollback)).toBe(false)
    expect(new TextDecoder().decode(fake.files.get(main))).toBe(oldSource)
  })

  it.each(['stderr', 'reject'] as const)('復旧処理が%sで失敗しても最初の書込みエラーを報告する', async rollbackFailure => {
    const { execute, originalExecute, service } = fixture()
    execute.mockImplementation(async code => {
      if (promotion(code)) return result('OSError: original rename failure')
      if (rollback(code)) {
        if (rollbackFailure === 'reject') throw new Error('rollback connection lost')
        return result('OSError: rollback failed')
      }
      return originalExecute(code)
    })
    await expect(service.writeMain(newSource)).rejects.toThrow('original rename failure')
    expect(execute.mock.calls.some(([code]) => rollback(code))).toBe(true)
  })

  it('ホスト側rename例外も既存どおり復旧してから失敗を返す', async () => {
    const { execute, originalExecute, service } = fixture()
    const failure = new Error('connection lost while renaming')
    execute.mockImplementation(async code => {
      if (promotion(code)) throw failure
      return originalExecute(code)
    })
    await expect(service.writeMain(newSource)).rejects.toBe(failure)
    expect(execute.mock.calls.some(([code]) => rollback(code))).toBe(true)
  })

  it.each([newSource, 'print("日本語")', ''])('成功時は今までどおりUTF-8のサイズとmain.pyを確認する (%s)', async source => {
    const { fake, service } = fixture()
    const size = encoder.encode(source).length
    await expect(service.writeMain(source)).resolves.toBe(size)
    expect(new TextDecoder().decode(fake.files.get(main))).toBe(source)
    expect(fake.commands.some(code => code.includes(temporary) && code.includes("'wb'"))).toBe(true)
    expect(fake.commands.some(code => code.includes('__SIZE__'))).toBe(true)
    expect(fake.commands.some(promotion)).toBe(true)
    expect(fake.commands.at(-1)).toContain('__MAIN_SIZE__')
    expect(fake.commands.some(rollback)).toBe(false)
  })
})
