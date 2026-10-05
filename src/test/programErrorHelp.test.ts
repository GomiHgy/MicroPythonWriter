import { describe, expect, it } from 'vitest'
import { canOfferProgramRepair } from '../services/programs/programErrorHelp'
import type { AppError } from '../types'

const error = (exceptionType: string, stage = '実行'): AppError => ({
  exceptionType, stage, message: 'example', traceback: 'record', intentionalInterrupt: false, repairPrompt: 'captured request',
})

describe('プログラムの修正と通信復旧の案内', () => {
  it.each(['SyntaxError', 'IndentationError', 'NameError', 'OSError', 'MemoryError', 'DeviceCompileError'])('%s はコード修正を案内する', type => {
    expect(canOfferProgramRepair(error(type))).toBe(true)
  })
  it('通常の実行エラーは未知の例外型でも修正依頼を用意する', () => {
    expect(canOfferProgramRepair(error('CustomError', 'DEVICE_RUNTIME_ERROR'))).toBe(true)
  })
  it.each(['SERIAL_DISCONNECTED', 'HOST_SERIAL_ERROR', 'USB接続'])('%s は通信復旧を優先する', stage => {
    expect(canOfferProgramRepair(error('OSError', stage))).toBe(false)
  })
  it.each(['SerialDisconnectedError', 'DeviceTimeoutError', 'KeyboardInterrupt', 'FileSystemError'])('%s をプログラムの不具合と断定しない', type => {
    expect(canOfferProgramRepair(error(type))).toBe(false)
  })
  it('エラーがなければ修正操作を出さない', () => {
    expect(canOfferProgramRepair(undefined)).toBe(false)
  })
})
