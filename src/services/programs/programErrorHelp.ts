import type { AppError } from '../../types'

const pythonErrors = new Set([
  'SyntaxError', 'IndentationError', 'NameError', 'TypeError', 'ValueError',
  'ImportError', 'ModuleNotFoundError', 'OSError', 'MemoryError', 'RuntimeError',
  'ZeroDivisionError', 'IndexError', 'KeyError', 'AttributeError', 'AssertionError', 'DeviceCompileError',
])

/** 通信の復旧案内を、作品コードの修正依頼より優先する。 */
export function canOfferProgramRepair(error: AppError | undefined): boolean {
  if (!error || ['SERIAL_DISCONNECTED', 'HOST_SERIAL_ERROR', 'USB接続'].includes(error.stage)) return false
  return error.stage === 'DEVICE_RUNTIME_ERROR' || pythonErrors.has(error.exceptionType)
}
