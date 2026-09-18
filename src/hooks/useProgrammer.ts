import { getLocale, translate, type Locale } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MicroPythonDevice } from '../services/micropython/MicroPythonDevice'
import type { LongRunningCompletion } from '../services/micropython/RawReplClient'
import { TracebackParser } from '../services/micropython/TracebackParser'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import type { WorkshopContext } from '../services/prompt/WorkshopRules'
import { SerialStateMachine } from '../services/serial/SerialStateMachine'
import { WebSerialTransport } from '../services/serial/WebSerialTransport'
import { SerialDisconnectedError, type AppError, type DeviceInfo, type DeviceState, type ParsedTraceback } from '../types'

const starter = 'print("Hello from M5NanoC6 / AtomS3Lite")\n'
const emptyInfo: DeviceInfo = { deviceName: '未接続', microPythonVersion: '未取得', firmwareInfo: '未取得', nanoC6Confirmed: false, bootOptionSupported: false, nvsFallbackSupported: false }
interface OperationSnapshot { source: string; sourceKnown: boolean; device: DeviceInfo; workshop: WorkshopContext | null; locale: Locale }
const readPreference = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const savePreference = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* 保存できない環境でも編集・通信は継続する */ } }
export function useProgrammer(workshop: WorkshopContext | null = null, fallbackSource?: string, preferProjectSource = false) {
  const transport = useMemo(() => new WebSerialTransport(), [])
  const initialState: DeviceState = transport.supported ? 'disconnected' : 'unsupported'
  const machine = useRef(new SerialStateMachine(transport.supported))
  const device = useRef<MicroPythonDevice | undefined>(undefined)
  const connectionLost = useRef(false)
  const runId = useRef(0)
  const programOperation = useRef<number | undefined>(undefined)
  const activeSnapshot = useRef<OperationSnapshot | undefined>(undefined)
  const fileSnapshot = useRef<OperationSnapshot | undefined>(undefined)
  const infoRef = useRef<DeviceInfo>(emptyInfo)
  const logRef = useRef('')
  const [errorContext, setErrorContext] = useState<{ snapshot: OperationSnapshot; terminalLog: string }>()
  const parser = useMemo(() => new TracebackParser(), [])
  const prompt = useMemo(() => new RepairPromptBuilder(), [])
  const [state, setState] = useState<DeviceState>(initialState)
  const [info, setInfo] = useState<DeviceInfo>(emptyInfo)
  const [log, updateLog] = useState('')
  const [error, setError] = useState<AppError>()
  const [source, setSource] = useState(() => preferProjectSource && fallbackSource !== undefined ? fallbackSource : readPreference('mpw-source') ?? fallbackSource ?? starter)
  const [writtenSource, setWrittenSource] = useState<string | null>(null)
  const [runningSource, setRunningSource] = useState<string | null>(null)
  const [bootConfigured, setBootConfigured] = useState<{ source: string | null; mode: 0 | 1 } | null>(null)
  const [baudRate, setBaudRate] = useState(() => Number(readPreference('mpw-baud') ?? 115200))
  const move = (next: DeviceState) => setState(machine.current.move(next))
  const force = (next: DeviceState) => setState(machine.current.force(next))
  const setLog = useCallback((next: string | ((previous: string) => string)) => { logRef.current = typeof next === 'function' ? next(logRef.current) : next; updateLog(logRef.current) }, [])
  const appendLog = useCallback((text: string) => setLog(old => `${old}${text}`), [setLog])
  const setDeviceInfo = (next: DeviceInfo) => { infoRef.current = next; setInfo(next) }
  const capture = (sourceKnown = true): OperationSnapshot => ({ source: sourceKnown ? source : '', sourceKnown, locale: getLocale(), device: structuredClone(infoRef.current), workshop: workshop ? structuredClone(workshop) : null })
  const deviceContext = () => activeSnapshot.current ?? fileSnapshot.current ?? capture(false)
  const saveError = (stage: string, parsed: ParsedTraceback, snapshot: OperationSnapshot) => {
    const terminalLog = logRef.current.slice(-8000)
    setErrorContext({ snapshot, terminalLog })
    setError({ ...parsed, stage, sourceSnapshot: snapshot.sourceKnown ? snapshot.source : undefined, sourceKnown: snapshot.sourceKnown, deviceSnapshot: snapshot.device, repairPrompt: prompt.build(parsed, snapshot.source, snapshot.device, terminalLog, stage, snapshot.workshop, { sourceKnown: snapshot.sourceKnown, locale: snapshot.locale }) })
  }
  const showError = (stage: string, caught: unknown, snapshot: OperationSnapshot) => {
    const parsed = parser.parse(caught instanceof Error ? caught.message : String(caught), snapshot.source) ?? { exceptionType: caught instanceof Error ? caught.name : 'Error', message: caught instanceof Error ? caught.message : String(caught), traceback: caught instanceof Error ? caught.stack ?? caught.message : String(caught), intentionalInterrupt: false }
    saveError(stage, parsed, snapshot)
  }
  const handleCompletion = (id: number, result: LongRunningCompletion, snapshot: OperationSnapshot) => {
    if (id !== runId.current) return
    activeSnapshot.current = undefined
    if (result.hostError) { force('error'); showError('HOST_SERIAL_ERROR', result.hostError, snapshot); return }
    if (result.stderr && !result.intentionalStop) { force('error'); const parsed = parser.parse(`${result.stdout}\n${result.stderr}`, snapshot.source) ?? { exceptionType: 'DEVICE_RUNTIME_ERROR', message: result.stderr, traceback: result.stderr, intentionalInterrupt: false }; saveError('DEVICE_RUNTIME_ERROR', parsed, snapshot); return }
    force(result.state === 'stopped' ? 'stopped' : 'raw-repl-ready')
  }
  useEffect(() => { savePreference('mpw-source', source) }, [source])
  useEffect(() => { savePreference('mpw-baud', String(baudRate)) }, [baudRate])
  useEffect(() => {
    const unsubscribe = transport.onData(bytes => appendLog(new TextDecoder().decode(bytes)))
    const unsubscribeDisconnect = transport.onDisconnectDetected(() => { connectionLost.current = true; runId.current++; programOperation.current = undefined; device.current = undefined; activeSnapshot.current = undefined; fileSnapshot.current = undefined; setWrittenSource(null); setRunningSource(null); appendLog('\n[USB切断を検出しました。再接続してください。]\n'); force('connection-lost') })
    return () => { unsubscribe(); unsubscribeDisconnect(); transport.dispose() }
  }, [transport, appendLog])
  const trap = async (stage: string, action: () => Promise<void>, isCurrent = () => true, snapshot: OperationSnapshot | (() => OperationSnapshot) = capture()) => { try { setError(undefined); await action() } catch (caught) { if (!isCurrent()) return; const disconnected = connectionLost.current || caught instanceof SerialDisconnectedError; force(disconnected ? 'connection-lost' : 'error'); showError(disconnected ? 'SERIAL_DISCONNECTED' : stage, caught, typeof snapshot === 'function' ? snapshot() : snapshot) } }
  const normalMode = () => trap('RAW_REPL_SYNC_ERROR', async () => { if (!device.current || programOperation.current !== undefined) return; runId.current++; move('interrupting'); move('entering-raw-repl'); await device.current.enterNormalMode(); activeSnapshot.current = undefined; move('raw-repl-ready'); move('probing'); setDeviceInfo(await device.current.probe.probe()); move('raw-repl-ready') }, undefined, deviceContext())
  const connect = () => trap('USB接続', async () => { connectionLost.current = false; setBootConfigured(null); setWrittenSource(null); setRunningSource(null); setDeviceInfo(emptyInfo); move('requesting-port'); move('opening'); await transport.connect(baudRate); device.current = new MicroPythonDevice(transport); move('connected'); await normalMode() }, undefined, { ...capture(false), device: structuredClone(emptyInfo) })
  const reconnect = async () => { const snapshot = { ...capture(false), device: structuredClone(emptyInfo) }; try { connectionLost.current = false; setBootConfigured(null); setDeviceInfo(emptyInfo); setError(undefined); move('reconnecting'); await transport.reconnect(baudRate); device.current = new MicroPythonDevice(transport); move('connected'); await normalMode() } catch (caught) { connectionLost.current = true; device.current = undefined; force('connection-lost'); showError('SERIAL_DISCONNECTED', caught, snapshot) } }
  const disconnect = async () => { runId.current++; programOperation.current = undefined; device.current = undefined; activeSnapshot.current = undefined; fileSnapshot.current = undefined; setWrittenSource(null); setRunningSource(null); await transport.disconnect(); connectionLost.current = false; setDeviceInfo(emptyInfo); force('disconnected') }
  const load = () => {
    const snapshot = capture(false)
    return trap('プログラム読込み', async () => { if (!device.current || programOperation.current !== undefined) return; const next = await device.current.files.readMain(); fileSnapshot.current = { ...snapshot, source: next, sourceKnown: true }; if (source && source !== starter && !confirm(translate(getLocale(), 'ローカルの未保存編集を上書きしますか？'))) return; setSource(next) }, undefined, deviceContext())
  }
  const updateProgram = async (execute: boolean) => {
    const target = device.current
    if (!target || programOperation.current !== undefined || !['raw-repl-ready', 'stopped', 'running', 'running-no-marker'].includes(machine.current.state)) return
    if (!execute && !confirm(translate(getLocale(), '既存のmain.pyをmain.py.bakへ退避して、編集内容で更新します。実行はしません。続ける？'))) return
    const id = ++runId.current
    programOperation.current = id
    setRunningSource(null)
    setBootConfigured(null)
    const snapshot = capture()
    let errorSnapshot = ['running', 'running-no-marker'].includes(machine.current.state) ? deviceContext() : snapshot
    const isCurrent = () => id === runId.current && device.current === target && !connectionLost.current
    try {
      await trap(execute ? '実行' : 'プログラム更新', async () => {
        const wasRunning = ['running', 'running-no-marker'].includes(machine.current.state)
        if (wasRunning) move('stopping')
        await target.prepareForWrite()
        if (!isCurrent()) return
        activeSnapshot.current = undefined
        errorSnapshot = snapshot
        if (wasRunning) move('stopped')
        move('uploading')
        appendLog(`\n===== ${execute ? '実行' : 'プログラム更新'}開始 #${id} ${new Date().toLocaleTimeString()} =====\n`)
        fileSnapshot.current = undefined
        setWrittenSource(null)
        await target.files.writeMain(snapshot.source)
        if (!isCurrent()) return
        fileSnapshot.current = snapshot
        setWrittenSource(snapshot.source)
        if (!execute) { move('raw-repl-ready'); return }
        move('verifying')
        await target.validateMain()
        if (!isCurrent()) return
        move('starting')
        activeSnapshot.current = snapshot
        const started = await target.startMain({ onComplete: result => handleCompletion(id, result, snapshot) })
        if (!isCurrent() || started.state === 'completed') return
        setRunningSource(snapshot.source)
        force(started.confirmedBy === 'still-running' ? 'running-no-marker' : 'running')
      }, isCurrent, () => errorSnapshot)
    } finally {
      if (programOperation.current === id) programOperation.current = undefined
    }
  }
  const write = () => updateProgram(false)
  const run = () => updateProgram(true)
  const stop = () => {
    const target = device.current
    if (!target || programOperation.current !== undefined || !['running', 'running-no-marker'].includes(machine.current.state)) return
    const snapshot = deviceContext()
    const id = ++runId.current
    const isCurrent = () => id === runId.current && device.current === target
    return trap('停止', async () => {
      move('stopping')
      const result = await target.stopMain()
      if (!isCurrent()) return
      if (result) handleCompletion(id, result, snapshot)
      else { await target.repl.interrupt(); if (isCurrent()) { activeSnapshot.current = undefined; force('stopped') } }
    }, isCurrent, snapshot)
  }
  const finishReset = async () => { await transport.disconnect(); connectionLost.current = false; device.current = undefined; activeSnapshot.current = undefined; fileSnapshot.current = undefined; setWrittenSource(null); setRunningSource(null); setDeviceInfo(emptyInfo); force('disconnected') }
  const setBoot = (mode: 0 | 1) => trap('起動モード設定', async () => { if (!device.current || programOperation.current !== undefined) return; setBootConfigured(null); const bootSource = fileSnapshot.current?.source ?? null; const text = mode === 0 ? '動作OKとして自動起動モードに変更し、リセットします。実機動作を確認済み？' : '次回起動を永続プログラムモードに変更します。続ける？'; if (!confirm(translate(getLocale(), text))) return; await device.current.prepareForWrite(); move('setting-boot-mode'); await device.current.boot.set(mode, info); setDeviceInfo({ ...infoRef.current, bootOption: mode }); move('resetting'); await device.current.boot.reset(); await finishReset(); setBootConfigured({ source: bootSource, mode }) }, undefined, deviceContext())
  const reset = () => trap('ハードリセット', async () => { if (!device.current || programOperation.current !== undefined || !confirm(translate(getLocale(), 'MicroPython機器をリセットします。続ける？'))) return; setBootConfigured(null); await device.current.prepareForWrite(); move('resetting'); await device.current.boot.reset(); await finishReset() }, undefined, deviceContext())
  const locale = getLocale()
  const localizedError = useMemo(() => {
    const saved = errorContext
    if (!error || !saved) return error
    const { snapshot, terminalLog } = saved
    return { ...error, repairPrompt: prompt.build(error, snapshot.source, snapshot.device, terminalLog, error.stage, snapshot.workshop, { sourceKnown: snapshot.sourceKnown, locale }) }
  }, [error, errorContext, locale, prompt])
  return { supported: transport.supported, state, info, log, setLog, error: localizedError, source, setSource, writtenSource, runningSource, bootConfigured, baudRate, setBaudRate, connect, reconnect, disconnect, normalMode, load, write, run, stop, setBoot, reset }
}
