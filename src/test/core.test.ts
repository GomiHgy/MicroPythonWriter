import { describe, expect, it } from 'vitest'
import { ByteQueue } from '../services/serial/ByteQueue'
import { SerialStateMachine } from '../services/serial/SerialStateMachine'
import { RawPasteProtocol } from '../services/micropython/RawPasteProtocol'
import { RawReplClient } from '../services/micropython/RawReplClient'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { FileTransferService } from '../services/micropython/FileTransferService'
import { TracebackParser } from '../services/micropython/TracebackParser'
import { BootModeService } from '../services/micropython/BootModeService'
import { RepairPromptBuilder, hasSensitiveAssignments } from '../services/prompt/RepairPromptBuilder'
import { BootModeUnsupportedError, DeviceTimeoutError } from '../types'
import { FakeMicroPythonRepl } from './fakes'

describe('ByteQueue', () => {
  it('複数チャンクに分割されたパターンを待つ', async () => { const q = new ByteQueue(); q.push(new TextEncoder().encode('raw RE')); q.push(new TextEncoder().encode('PL; CTRL-B')); expect(new TextDecoder().decode(await q.readUntil(new TextEncoder().encode('REPL;'), 20))).toBe('raw REPL;') })
  it('1バイト単位で読み取る', async () => { const q = new ByteQueue(); q.push(new Uint8Array([1])); q.push(new Uint8Array([2])); expect([...await q.readExact(2, 20)]).toEqual([1, 2]) })
  it('タイムアウトを区別する', async () => { await expect(new ByteQueue().readExact(1, 1)).rejects.toBeInstanceOf(DeviceTimeoutError) })
})
describe('状態機械', () => {
  it('未接続で書込み状態へ遷移できない', () => expect(() => new SerialStateMachine(true).move('uploading')).toThrow('不正な状態遷移'))
  it('通常の接続から通常動作用Raw REPLまで遷移する', () => { const s = new SerialStateMachine(true); s.move('requesting-port'); s.move('opening'); s.move('connected'); s.move('entering-raw-repl'); expect(s.move('raw-repl-ready')).toBe('raw-repl-ready') })
  it('実行中から通常動作用の割込みへ遷移できる', () => { const s = new SerialStateMachine(true); s.force('running'); expect(s.move('interrupting')).toBe('interrupting') })
})
describe('Web Serial API境界', () => {
  it('Web Serial非対応を検出する', () => expect(new WebSerialTransport(undefined).supported).toBe(false))
  it('ポート選択キャンセルを許可エラーとして返す', async () => { const serial = { requestPort: async () => { throw new Error('cancel') }, getPorts: async () => [], addEventListener: () => undefined, removeEventListener: () => undefined }; await expect(new WebSerialTransport(serial).connect()).rejects.toThrow('cancel') })
  it('切断イベントを購読者へ通知する', () => { let listener: ((event: Event) => void) | undefined; const serial = { requestPort: async () => { throw new Error('unused') }, getPorts: async () => [], addEventListener: (_type: string, callback: (event: Event) => void) => { listener = callback }, removeEventListener: () => undefined }; const transport = new WebSerialTransport(serial); let notified = false; transport.onDisconnectDetected(() => { notified = true }); listener?.(new Event('disconnect')); expect(notified).toBe(true) })
})
describe('Raw-paste', () => {
  it('対応機器のリトルエンディアン窓サイズを使う', async () => { const queue = new ByteQueue(); queue.push(new Uint8Array([0x52, 1, 4, 0])); const writes: number[][] = []; const transport = { queue, write: async (d: Uint8Array) => { writes.push([...d]) } }; const raw = new RawPasteProtocol(transport as never); expect(await raw.negotiate(20)).toBe(4); expect(writes[0]).toEqual([5, 65, 1]) })
  it('未対応時は標準Raw REPLへのフォールバック値を返す', async () => { const queue = new ByteQueue(); queue.push(new Uint8Array([0x52, 0])); const raw = new RawPasteProtocol({ queue, write: async () => undefined } as never); expect(await raw.negotiate(20)).toBe(false) })
})
describe('Raw REPL', () => {
  it('Raw REPLバナーの分割受信を認識する', async () => { const queue = new ByteQueue(); queue.push(new TextEncoder().encode('raw REPL; CTRL-B to exit')); const writes: number[][] = []; const client = new RawReplClient({ queue, write: async (bytes: Uint8Array) => { writes.push([...bytes]) } } as never, { interrupt: 20, rawRepl: 20, command: 20 }); await client.enterRawRepl(); expect(writes.at(-1)).toEqual([1]) })
  it('Raw REPLバナー待機のタイムアウトを区別する', async () => { const client = new RawReplClient({ queue: new ByteQueue(), write: async () => undefined } as never, { interrupt: 1, rawRepl: 1, command: 1 }); await expect(client.enterRawRepl()).rejects.toThrow('REPL') })
  it('有限コードはstdoutと終了シーケンスを待つ', async () => { const queue = new ByteQueue(); let writes = 0; const client = new RawReplClient({ queue, write: async () => { if (++writes === 2) queue.push(new Uint8Array([...new TextEncoder().encode('OKhello'), 4, 4, 62])) } } as never, { command: 20 }); await expect(client.execute('print("hello")')).resolves.toMatchObject({ stdout: 'hello', stderr: '', completed: true }) })
  it('機器リセットはRaw REPLの完了応答を待たずに送信する', async () => { const queue = new ByteQueue(); const writes: number[][] = []; const client = new RawReplClient({ queue, write: async (data: Uint8Array) => { writes.push([...data]) } } as never); await expect(client.reset()).resolves.toBeUndefined(); expect(new TextDecoder().decode(new Uint8Array(writes[0]))).toContain('machine.reset()'); expect(writes[1]).toEqual([4]) })
  it('起動マーカーを受信した常駐main.pyを完了待ちせずrunningにする', async () => { const queue = new ByteQueue(); let writes = 0; const client = new RawReplClient({ queue, write: async () => { if (++writes === 2) queue.push(new TextEncoder().encode('OK__M5_MAIN_STARTED__\r\n')) } } as never, { command: 20, startupGrace: 5 }); const started = await client.startLongRunning('while True: pass'); expect(started).toMatchObject({ state: 'running', confirmedBy: 'startup-marker' }); started.session.dispose() })
  it('分割された起動マーカーも常駐実行として認識する', async () => { const queue = new ByteQueue(); let writes = 0; const client = new RawReplClient({ queue, write: async () => { if (++writes === 2) { queue.push(new TextEncoder().encode('OK__M5_MAIN_')); setTimeout(() => queue.push(new TextEncoder().encode('STARTED__\r\n')), 0) } } } as never, { command: 20, startupGrace: 20 }); const started = await client.startLongRunning('while True: pass'); expect(started.confirmedBy).toBe('startup-marker'); started.session.dispose() })
  it('起動マーカーなしの常駐main.pyを猶予後runningにする', async () => { const queue = new ByteQueue(); let writes = 0; const client = new RawReplClient({ queue, write: async () => { if (++writes === 2) queue.push(new TextEncoder().encode('OK')) } } as never, { command: 20, startupGrace: 5 }); const started = await client.startLongRunning('while True: pass'); expect(started).toMatchObject({ state: 'running', confirmedBy: 'still-running' }); started.session.dispose() })
  it('即時TracebackはHOST_TIMEOUTではなくcompleted結果として返す', async () => { const queue = new ByteQueue(); let writes = 0; const client = new RawReplClient({ queue, write: async () => { if (++writes === 2) queue.push(new Uint8Array([...new TextEncoder().encode('OK'), 4, ...new TextEncoder().encode('Traceback (most recent call last):\nImportError: no module named neopixel'), 4, 62])) } } as never, { command: 20, startupGrace: 5 }); const started = await client.startLongRunning('raise ImportError'); expect(started.state).toBe('completed'); expect(started.stderr).toContain('ImportError') })
  it('Ctrl-C停止後はRaw REPLを再利用できる', async () => { const queue = new ByteQueue(); const writes: number[][] = []; const client = new RawReplClient({ queue, write: async (data: Uint8Array) => { writes.push([...data]); if (writes.length === 2) queue.push(new TextEncoder().encode('OK__M5_MAIN_STARTED__')) } } as never, { command: 20, startupGrace: 5, stop: 20 }); const started = await client.startLongRunning('while True: pass'); const stopping = started.session.stop(); queue.push(new Uint8Array([4, ...new TextEncoder().encode('__M5_MAIN_STOPPED__'), 4, 62])); await expect(stopping).resolves.toMatchObject({ state: 'stopped', intentionalStop: true }); expect(writes.some(write => write.length === 1 && write[0] === 3)).toBe(true) })
})
describe('ファイル安全書込み', () => {
  it('tmpへチャンク送信してサイズ照合する', async () => { const fake = new FakeMicroPythonRepl(); const files = new FileTransferService(fake as never, 4); await files.writeMain('print(1)'); expect(fake.commands.filter(c => c.includes('main.py.tmp') && c.includes("'ab'")).length).toBe(2); expect(fake.commands.some(c => c.includes('/flash/main.py.tmp') && c.includes('/flash/main.py'))).toBe(true) })
  it('main.pyが無い読込みは空文字で正常扱い', async () => { const fake = new FakeMicroPythonRepl(); expect(await new FileTransferService(fake as never).readMain()).toBe('') })
})
describe('Traceback', () => {
  const parser = new TracebackParser()
  it('SyntaxErrorとmain.py行を抽出する', () => { const error = parser.parse('Traceback (most recent call last):\n  File "main.py", line 2\nSyntaxError: bad', 'a\nb'); expect(error?.exceptionType).toBe('SyntaxError'); expect(error?.line).toBe(2); expect(error?.codeLine).toBe('b') })
  it('RuntimeErrorを抽出する', () => expect(parser.parse('Traceback (most recent call last):\nRuntimeError: no')?.exceptionType).toBe('RuntimeError'))
  it('意図的KeyboardInterruptを修正対象から除外する', () => expect(parser.parse('KeyboardInterrupt', '', true)?.intentionalInterrupt).toBe(true))
})
describe('起動モード', () => {
  it('boot_option=0を使う', async () => { const fake = new FakeMicroPythonRepl(); await new BootModeService(fake as never).set(0, { bootOptionSupported: true, nvsFallbackSupported: false }); expect(fake.commands[0]).toContain('set_boot_option(0)') })
  it('boot_optionなしではNVS set_u8だけへフォールバックする', async () => { const fake = new FakeMicroPythonRepl(); await new BootModeService(fake as never).set(1, { bootOptionSupported: false, nvsFallbackSupported: true }); expect(fake.commands[0]).toContain('set_u8') })
  it('set_u8非対応なら拒否する', async () => await expect(new BootModeService(new FakeMicroPythonRepl() as never).set(1, { bootOptionSupported: false, nvsFallbackSupported: false })).rejects.toBeInstanceOf(BootModeUnsupportedError))
})
describe('修正依頼プロンプト', () => {
  it('必要な実行環境とエラーを含む', () => { const prompt = new RepairPromptBuilder().build({ exceptionType: 'NameError', message: 'x', traceback: 'trace', intentionalInterrupt: false }, 'x', { deviceName: 'NanoC6', microPythonVersion: 'v1', firmwareInfo: 'impl', nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }, 'log', '実行'); expect(prompt).toContain('NameError'); expect(prompt).toContain('NanoC6') })
  it('秘密情報らしき代入を警告対象にする', () => expect(hasSensitiveAssignments('ssid = "private"')).toBe(true))
})
