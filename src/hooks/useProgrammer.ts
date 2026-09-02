import { useEffect, useMemo, useRef, useState } from 'react'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import { TracebackParser } from '../services/micropython/TracebackParser'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { SerialStateMachine } from '../services/serial/SerialStateMachine'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import type { AppError, DeviceInfo, DeviceState } from '../types'

const starter = 'print("Hello from M5NanoC6")\n'
const emptyInfo: DeviceInfo = { deviceName: '未接続', microPythonVersion: '未取得', firmwareInfo: '未取得', nanoC6Confirmed: false, bootOptionSupported: false, nvsFallbackSupported: false }
export function useProgrammer() {
  const transport = useMemo(() => new WebSerialTransport(), []); const initialState: DeviceState = transport.supported ? 'disconnected' : 'unsupported'; const machine = useRef(new SerialStateMachine(transport.supported)); const device = useRef<MicroPythonDevice | undefined>(undefined); const parser = useMemo(() => new TracebackParser(), []); const prompt = useMemo(() => new RepairPromptBuilder(), [])
  const [state, setState] = useState<DeviceState>(initialState); const [info, setInfo] = useState<DeviceInfo>(emptyInfo); const [log, setLog] = useState(''); const [error, setError] = useState<AppError>(); const [source, setSource] = useState(() => localStorage.getItem('mpw-source') ?? starter); const [baudRate, setBaudRate] = useState(() => Number(localStorage.getItem('mpw-baud') ?? 115200));
  const move = (next: DeviceState) => setState(machine.current.move(next)); const force = (next: DeviceState) => setState(machine.current.force(next))
  useEffect(() => { localStorage.setItem('mpw-source', source) }, [source]); useEffect(() => { localStorage.setItem('mpw-baud', String(baudRate)) }, [baudRate])
  useEffect(() => { const unsubscribe = transport.onData(bytes => setLog(old => `${old}${new TextDecoder().decode(bytes)}`)); return () => { unsubscribe(); transport.dispose() } }, [transport])
  const trap = async (stage: string, action: () => Promise<void>) => { try { setError(undefined); await action() } catch (caught) { force('error'); const parsed = parser.parse(caught instanceof Error ? caught.message : String(caught), source) ?? { exceptionType: caught instanceof Error ? caught.name : 'Error', message: caught instanceof Error ? caught.message : String(caught), traceback: caught instanceof Error ? caught.stack ?? caught.message : String(caught), intentionalInterrupt: false }; setError({ ...parsed, stage, repairPrompt: prompt.build(parsed, source, info, log.slice(-8000), stage) }) } }
  const connect = () => trap('USB接続', async () => { move('requesting-port'); move('opening'); await transport.connect(baudRate); device.current = new MicroPythonDevice(transport); move('connected'); await developmentMode() })
  const developmentMode = () => trap('一時開発モード', async () => { if (!device.current) return; move('interrupting'); move('entering-raw-repl'); await device.current.temporaryDevelopmentMode(); move('raw-repl-ready'); move('probing'); const next = await device.current.probe.probe(); setInfo(next); move('raw-repl-ready') })
  const disconnect = async () => { await transport.disconnect(); device.current = undefined; setInfo(emptyInfo); force('disconnected') }
  const load = () => trap('main.py読込み', async () => { if (!device.current) return; const next = await device.current.files.readMain(); if (source && source !== starter && !confirm('ローカルの未保存編集を上書きしますか？')) return; setSource(next) })
  const write = () => trap('main.py書込み', async () => { if (!device.current) return; if (!confirm('既存のmain.pyをmain.py.bakへ退避してから上書きします。続ける？')) return; move('uploading'); await device.current.files.writeMain(source); move('raw-repl-ready') })
  const run = () => trap('main.py実行', async () => { if (!device.current) return; await writeWithoutConfirm(); move('running'); const result = await device.current.runMain(); processResult(result.stdout, result.stderr, 'main.py実行'); move('raw-repl-ready') })
  const writeWithoutConfirm = async () => { if (!device.current) return; move('uploading'); await device.current.files.writeMain(source); move('raw-repl-ready') }
  const processResult = (stdout: string, stderr: string, stage: string, intentionalStop = false) => { const parsed = parser.parse(`${stdout}\n${stderr}`, source, intentionalStop); if (parsed && !parsed.intentionalInterrupt) setError({ ...parsed, stage, repairPrompt: prompt.build(parsed, source, info, log.slice(-8000), stage) }) }
  const stop = () => trap('停止', async () => { if (!device.current) return; move('stopping'); await device.current.repl.interrupt(); processResult('', 'KeyboardInterrupt', '停止', true); move('raw-repl-ready') })
  const setBoot = (mode: 0 | 1) => trap('起動モード設定', async () => { if (!device.current) return; const text = mode === 0 ? '動作OKとして自動起動モードに変更し、リセットします。実機動作を確認済み？' : '次回起動を永続プログラムモードに変更します。続ける？'; if (!confirm(text)) return; move('setting-boot-mode'); await device.current.boot.set(mode, info); setInfo(old => ({ ...old, bootOption: mode })); move('resetting'); await device.current.boot.reset(); force('disconnected') })
  const reset = () => trap('ハードリセット', async () => { if (!device.current || !confirm('MicroPython機器をリセットします。続ける？')) return; move('resetting'); await device.current.boot.reset(); force('disconnected') })
  return { supported: transport.supported, state, info, log, setLog, error, source, setSource, baudRate, setBaudRate, connect, disconnect, developmentMode, load, write, run, stop, setBoot, reset }
}
