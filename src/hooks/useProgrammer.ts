import { useEffect, useMemo, useRef, useState } from 'react'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import type { LongRunningCompletion } from '../services/micropython/RawReplClient'
import { TracebackParser } from '../services/micropython/TracebackParser'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { SerialStateMachine } from '../services/serial/SerialStateMachine'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { SerialDisconnectedError, type AppError, type DeviceInfo, type DeviceState, type ParsedTraceback } from '../types'

const starter = 'print("Hello from M5NanoC6")\n'
const emptyInfo: DeviceInfo = { deviceName: '未接続', microPythonVersion: '未取得', firmwareInfo: '未取得', nanoC6Confirmed: false, bootOptionSupported: false, nvsFallbackSupported: false }
export function useProgrammer() {
  const transport = useMemo(() => new WebSerialTransport(), [])
  const initialState: DeviceState = transport.supported ? 'disconnected' : 'unsupported'
  const machine = useRef(new SerialStateMachine(transport.supported))
  const device = useRef<MicroPythonDevice | undefined>(undefined)
  const connectionLost = useRef(false)
  const runId = useRef(0)
  const programOperation = useRef<number | undefined>(undefined)
  const parser = useMemo(() => new TracebackParser(), [])
  const prompt = useMemo(() => new RepairPromptBuilder(), [])
  const [state, setState] = useState<DeviceState>(initialState)
  const [info, setInfo] = useState<DeviceInfo>(emptyInfo)
  const [log, setLog] = useState('')
  const [error, setError] = useState<AppError>()
  const [source, setSource] = useState(() => localStorage.getItem('mpw-source') ?? starter)
  const [baudRate, setBaudRate] = useState(() => Number(localStorage.getItem('mpw-baud') ?? 115200))
  const move = (next: DeviceState) => setState(machine.current.move(next))
  const force = (next: DeviceState) => setState(machine.current.force(next))
  const appendLog = (text: string) => setLog(old => `${old}${text}`)
  const createParsedError = (caught: unknown): ParsedTraceback => parser.parse(caught instanceof Error ? caught.message : String(caught), source) ?? { exceptionType: caught instanceof Error ? caught.name : 'Error', message: caught instanceof Error ? caught.message : String(caught), traceback: caught instanceof Error ? caught.stack ?? caught.message : String(caught), intentionalInterrupt: false }
  const showError = (stage: string, caught: unknown) => { const parsed = createParsedError(caught); setError({ ...parsed, stage, repairPrompt: prompt.build(parsed, source, info, log.slice(-8000), stage) }) }
  const handleCompletion = (id: number, result: LongRunningCompletion) => {
    if (id !== runId.current) return
    if (result.hostError) { force('error'); showError('HOST_SERIAL_ERROR', result.hostError); return }
    if (result.stderr && !result.intentionalStop) { force('error'); const parsed = parser.parse(`${result.stdout}\n${result.stderr}`, source) ?? { exceptionType: 'DEVICE_RUNTIME_ERROR', message: result.stderr, traceback: result.stderr, intentionalInterrupt: false }; setError({ ...parsed, stage: 'DEVICE_RUNTIME_ERROR', repairPrompt: prompt.build(parsed, source, info, log.slice(-8000), 'DEVICE_RUNTIME_ERROR') }); return }
    force(result.state === 'stopped' ? 'stopped' : 'raw-repl-ready')
  }
  useEffect(() => { localStorage.setItem('mpw-source', source) }, [source])
  useEffect(() => { localStorage.setItem('mpw-baud', String(baudRate)) }, [baudRate])
  useEffect(() => {
    const unsubscribe = transport.onData(bytes => appendLog(new TextDecoder().decode(bytes)))
    const unsubscribeDisconnect = transport.onDisconnectDetected(() => { connectionLost.current = true; runId.current++; programOperation.current = undefined; device.current = undefined; appendLog('\n[USB切断を検出しました。再接続してください。]\n'); force('connection-lost') })
    return () => { unsubscribe(); unsubscribeDisconnect(); transport.dispose() }
  }, [transport])
  const trap = async (stage: string, action: () => Promise<void>, isCurrent = () => true) => { try { setError(undefined); await action() } catch (caught) { if (!isCurrent()) return; const disconnected = connectionLost.current || caught instanceof SerialDisconnectedError; force(disconnected ? 'connection-lost' : 'error'); showError(disconnected ? 'SERIAL_DISCONNECTED' : stage, caught) } }
  const normalMode = () => trap('RAW_REPL_SYNC_ERROR', async () => { if (!device.current || programOperation.current !== undefined) return; runId.current++; move('interrupting'); move('entering-raw-repl'); await device.current.enterNormalMode(); move('raw-repl-ready'); move('probing'); setInfo(await device.current.probe.probe()); move('raw-repl-ready') })
  const connect = () => trap('USB接続', async () => { connectionLost.current = false; move('requesting-port'); move('opening'); await transport.connect(baudRate); device.current = new MicroPythonDevice(transport); move('connected'); await normalMode() })
  const reconnect = async () => { try { connectionLost.current = false; setError(undefined); move('reconnecting'); await transport.reconnect(baudRate); device.current = new MicroPythonDevice(transport); move('connected'); await normalMode() } catch (caught) { connectionLost.current = true; device.current = undefined; force('connection-lost'); showError('SERIAL_DISCONNECTED', caught) } }
  const disconnect = async () => { runId.current++; programOperation.current = undefined; device.current = undefined; await transport.disconnect(); connectionLost.current = false; setInfo(emptyInfo); force('disconnected') }
  const load = () => trap('プログラム読込み', async () => { if (!device.current || programOperation.current !== undefined) return; const next = await device.current.files.readMain(); if (source && source !== starter && !confirm('ローカルの未保存編集を上書きしますか？')) return; setSource(next) })
  const updateProgram = async (execute: boolean) => {
    const target = device.current
    if (!target || programOperation.current !== undefined || !['raw-repl-ready', 'stopped', 'running', 'running-no-marker'].includes(machine.current.state)) return
    if (!execute && !confirm('既存のmain.pyをmain.py.bakへ退避して、編集内容で更新します。実行はしません。続ける？')) return
    const id = ++runId.current
    programOperation.current = id
    const isCurrent = () => id === runId.current && device.current === target && !connectionLost.current
    try {
      await trap(execute ? '実行' : 'プログラム更新', async () => {
        const wasRunning = ['running', 'running-no-marker'].includes(machine.current.state)
        if (wasRunning) move('stopping')
        await target.prepareForWrite()
        if (!isCurrent()) return
        if (wasRunning) move('stopped')
        move('uploading')
        appendLog(`\n===== ${execute ? '実行' : 'プログラム更新'}開始 #${id} ${new Date().toLocaleTimeString()} =====\n`)
        await target.files.writeMain(source)
        if (!isCurrent()) return
        if (!execute) { move('raw-repl-ready'); return }
        move('verifying')
        await target.validateMain()
        if (!isCurrent()) return
        move('starting')
        const started = await target.startMain({ onComplete: result => handleCompletion(id, result) })
        if (!isCurrent() || started.state === 'completed') return
        force(started.confirmedBy === 'still-running' ? 'running-no-marker' : 'running')
      }, isCurrent)
    } finally {
      if (programOperation.current === id) programOperation.current = undefined
    }
  }
  const write = () => updateProgram(false)
  const run = () => updateProgram(true)
  const stop = () => trap('停止', async () => {
    const target = device.current
    if (!target || programOperation.current !== undefined || !['running', 'running-no-marker'].includes(machine.current.state)) return
    const id = ++runId.current
    move('stopping')
    const result = await target.stopMain()
    if (id !== runId.current || device.current !== target) return
    if (result) handleCompletion(id, result)
    else { await target.repl.interrupt(); if (id === runId.current && device.current === target) force('stopped') }
  })
  const finishReset = async () => { await transport.disconnect(); connectionLost.current = false; device.current = undefined; setInfo(emptyInfo); force('disconnected') }
  const setBoot = (mode: 0 | 1) => trap('起動モード設定', async () => { if (!device.current || programOperation.current !== undefined) return; const text = mode === 0 ? '動作OKとして自動起動モードに変更し、リセットします。実機動作を確認済み？' : '次回起動を永続プログラムモードに変更します。続ける？'; if (!confirm(text)) return; await device.current.prepareForWrite(); move('setting-boot-mode'); await device.current.boot.set(mode, info); setInfo(old => ({ ...old, bootOption: mode })); move('resetting'); await device.current.boot.reset(); await finishReset() })
  const reset = () => trap('ハードリセット', async () => { if (!device.current || programOperation.current !== undefined || !confirm('MicroPython機器をリセットします。続ける？')) return; await device.current.prepareForWrite(); move('resetting'); await device.current.boot.reset(); await finishReset() })
  return { supported: transport.supported, state, info, log, setLog, error, source, setSource, baudRate, setBaudRate, connect, reconnect, disconnect, normalMode, load, write, run, stop, setBoot, reset }
}
