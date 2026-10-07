export type DeviceState = 'unsupported' | 'disconnected' | 'connection-lost' | 'reconnecting' | 'requesting-port' | 'opening' | 'connected' | 'interrupting' | 'entering-raw-repl' | 'raw-repl-ready' | 'probing' | 'uploading' | 'verifying' | 'starting' | 'running' | 'running-no-marker' | 'stopping' | 'stopped' | 'setting-boot-mode' | 'resetting' | 'error'

export interface DeviceInfo { deviceName: string; boardId?: import('../config/boards').BoardId; soc?: import('../config/boards').BoardSoc; boardConfirmed?: boolean; microPythonVersion: string; firmwareInfo: string; bootOption?: number; cwd?: string; files?: string[]; nanoC6Confirmed: boolean; bootOptionSupported: boolean; nvsFallbackSupported: boolean }
export interface ExecutionResult { stdout: string; stderr: string; durationMs: number; interrupted: boolean; completed: boolean }
export interface ParsedTraceback { exceptionType: string; message: string; traceback: string; line?: number; codeLine?: string; intentionalInterrupt: boolean }
export interface AppError extends ParsedTraceback { stage: string; repairPrompt: string; sourceSnapshot?: string; sourceKnown?: boolean; deviceSnapshot?: DeviceInfo }
export class SerialNotSupportedError extends Error { constructor() { super('このブラウザはUSB接続に対応していません。パソコン版Chrome・Edge、またはAndroid版ChromeでHTTPSのページを開いてください。') } }
export class SerialPermissionError extends Error { constructor(message = 'USBシリアルポートの選択がキャンセルされたか、許可されませんでした。') { super(message) } }
export class SerialDisconnectedError extends Error { constructor(message = 'USBシリアル接続が切断されました。') { super(message) } }
export class ReplNotAvailableError extends Error { constructor(message = 'MicroPython REPLを取得できませんでした。') { super(message) } }
export class RawReplProtocolError extends Error { constructor(message: string) { super(message) } }
export class RawPasteProtocolError extends Error { constructor(message: string) { super(message) } }
export class DeviceTimeoutError extends Error { constructor(message: string) { super(message) } }
export class DeviceCompileError extends Error { constructor(message: string) { super(message) } }
export class DeviceRuntimeError extends Error { constructor(message: string) { super(message) } }
export class DeviceRestartError extends Error {
  readonly reason: 'panic' | 'restart'
  constructor(reason: 'panic' | 'restart') {
    super(reason === 'panic' ? '機器内部でクラッシュが発生しました。実行は正常に継続していません。' : '実行中に機器の再起動を検出しました。実行は正常に継続していません。')
    this.name = reason === 'panic' ? 'DEVICE_PANIC' : 'DEVICE_RESTART'
    this.reason = reason
  }
}
export class FileSystemError extends Error { constructor(message: string) { super(message) } }
export class BootModeUnsupportedError extends Error { constructor() { super('このファームウェアではUIFlowの起動モードを安全に変更できません。main.pyの書込みと実行は利用できますが、boot_optionの変更は行いません。') } }
