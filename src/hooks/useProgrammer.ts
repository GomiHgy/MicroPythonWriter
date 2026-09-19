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
import type { ProgramFeedback } from '../types/programFeedback'

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
  const feedbackRef = useRef<ProgramFeedback | null>(null)
  const [programFeedback, setProgramFeedback] = useState<ProgramFeedback | null>(null)
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
  const replaceFeedback = useCallback((next: ProgramFeedback | null) => { feedbackRef.current = next; setProgramFeedback(next) }, [])
  const updateFeedback = (id: number, patch: Partial<ProgramFeedback>) => {
    if (id !== runId.current || feedbackRef.current?.id !== id) return
    replaceFeedback({ ...feedbackRef.current, ...patch })
  }
  const disconnectFeedback = useCallback(() => {
    const previous = feedbackRef.current
    if (previous && ['preparing', 'writing', 'verifying', 'starting', 'running'].includes(previous.phase)) replaceFeedback({ ...previous, phase: 'disconnected' })
  }, [replaceFeedback])
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
  const handleCompletion = (id: number, result: LongRunningCompletion, snapshot: OperationSnapshot, failedAt: 'runtime' | 'stop' = 'runtime') => {
    if (id !== runId.current) return
    activeSnapshot.current = undefined
    setRunningSource(null)
    if (result.hostError) {
      const disconnected = connectionLost.current || result.hostError instanceof SerialDisconnectedError
      updateFeedback(id, { phase: disconnected ? 'disconnected' : 'failed', failedAt, message: result.hostError.message })
      force(disconnected ? 'connection-lost' : 'error'); showError(disconnected ? 'SERIAL_DISCONNECTED' : 'HOST_SERIAL_ERROR', result.hostError, snapshot); return
    }
    if ((result.stderr && !result.intentionalStop) || result.state === 'error') { force('error'); const text = `${result.stdout}\n${result.stderr}`; const parsed = parser.parse(text, snapshot.source) ?? { exceptionType: 'DEVICE_RUNTIME_ERROR', message: result.stderr || 'DEVICE_RUNTIME_ERROR', traceback: text, intentionalInterrupt: false }; updateFeedback(id, { phase: 'failed', failedAt, message: parsed.message }); saveError('DEVICE_RUNTIME_ERROR', parsed, snapshot); return }
    updateFeedback(id, { phase: result.state === 'stopped' ? 'stopped' : 'completed' })
    force(result.state === 'stopped' ? 'stopped' : 'raw-repl-ready')
  }
  useEffect(() => { savePreference('mpw-source', source) }, [source])
  useEffect(() => { savePreference('mpw-baud', String(baudRate)) }, [baudRate])
  useEffect(() => {
    const unsubscribe = transport.onData(bytes => appendLog(new TextDecoder().decode(bytes)))
    const unsubscribeDisconnect = transport.onDisconnectDetected(() => { disconnectFeedback(); connectionLost.current = true; runId.current++; programOperation.current = undefined; device.current = undefined; activeSnapshot.current = undefined; fileSnapshot.current = undefined; setWrittenSource(null); setRunningSource(null); appendLog('\n[USB切断を検出しました。再接続してください。]\n'); force('connection-lost') })
    return () => { unsubscribe(); unsubscribeDisconnect(); transport.dispose() }
  }, [transport, appendLog, disconnectFeedback])
  const trap = async (stage: string, action: () => Promise<void>, isCurrent = () => true, snapshot: OperationSnapshot | (() => OperationSnapshot) = capture(), onFailure?: (caught: unknown, disconnected: boolean) => void) => { try { setError(undefined); await action() } catch (caught) { if (!isCurrent()) return; const disconnected = connectionLost.current || caught instanceof SerialDisconnectedError; onFailure?.(caught, disconnected); force(disconnected ? 'connection-lost' : 'error'); showError(disconnected ? 'SERIAL_DISCONNECTED' : stage, caught, typeof snapshot === 'function' ? snapshot() : snapshot) } }
  const normalMode = () => {
    let id: number | undefined
    return trap('RAW_REPL_SYNC_ERROR', async () => {
      if (!device.current || programOperation.current !== undefined) return
      const target = device.current
      id = ++runId.current
      if (feedbackRef.current?.phase === 'running') replaceFeedback({ ...feedbackRef.current, id })
      move('interrupting'); move('entering-raw-repl'); await target.enterNormalMode()
      if (id !== runId.current || device.current !== target) return
      activeSnapshot.current = undefined; setRunningSource(null)
      if (feedbackRef.current?.phase === 'running') updateFeedback(id, { phase: 'stopped' })
      move('raw-repl-ready'); move('probing'); const nextInfo = await target.probe.probe()
      if (id !== runId.current || device.current !== target) return
      setDeviceInfo(nextInfo); move('raw-repl-ready')
    }, () => id === undefined || id === runId.current, deviceContext(), (caught, disconnected) => {
      if (id !== undefined && feedbackRef.current?.phase === 'running') updateFeedback(id, { phase: disconnected ? 'disconnected' : 'failed', failedAt: 'stop', message: caught instanceof Error ? caught.message : String(caught) })
    })
  }
  const connect = () => trap('USB接続', async () => { replaceFeedback(null); connectionLost.current = false; setBootConfigured(null); setWrittenSource(null); setRunningSource(null); setDeviceInfo(emptyInfo); move('requesting-port'); move('opening'); await transport.connect(baudRate); device.current = new MicroPythonDevice(transport); move('connected'); await normalMode() }, undefined, { ...capture(false), device: structuredClone(emptyInfo) })
  const reconnect = async () => { const snapshot = { ...capture(false), device: structuredClone(emptyInfo) }; try { replaceFeedback(null); connectionLost.current = false; setBootConfigured(null); setDeviceInfo(emptyInfo); setError(undefined); move('reconnecting'); await transport.reconnect(baudRate); device.current = new MicroPythonDevice(transport); move('connected'); await normalMode() } catch (caught) { connectionLost.current = true; device.current = undefined; force('connection-lost'); showError('SERIAL_DISCONNECTED', caught, snapshot) } }
  const disconnect = async () => { disconnectFeedback(); runId.current++; programOperation.current = undefined; device.current = undefined; activeSnapshot.current = undefined; fileSnapshot.current = undefined; setWrittenSource(null); setRunningSource(null); await transport.disconnect(); connectionLost.current = false; setDeviceInfo(emptyInfo); force('disconnected') }
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
    replaceFeedback({ id, operation: execute ? 'run' : 'write', phase: 'preparing', source: snapshot.source, saved: false })
    let failedAt: ProgramFeedback['failedAt'] = 'prepare'
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
        failedAt = 'write'
        updateFeedback(id, { phase: 'writing' })
        appendLog(`\n===== ${execute ? '実行' : 'プログラム更新'}開始 #${id} ${new Date().toLocaleTimeString()} =====\n`)
        fileSnapshot.current = undefined
        setWrittenSource(null)
        await target.files.writeMain(snapshot.source)
        if (!isCurrent()) return
        fileSnapshot.current = snapshot
        setWrittenSource(snapshot.source)
        updateFeedback(id, { saved: true })
        if (!execute) { updateFeedback(id, { phase: 'saved' }); move('raw-repl-ready'); return }
        move('verifying')
        failedAt = 'verify'
        updateFeedback(id, { phase: 'verifying' })
        await target.validateMain()
        if (!isCurrent()) return
        move('starting')
        failedAt = 'start'
        updateFeedback(id, { phase: 'starting' })
        activeSnapshot.current = snapshot
        let completionReceived = false
        const started = await target.startMain({ onComplete: result => { completionReceived = true; handleCompletion(id, result, snapshot) } })
        if (!isCurrent()) return
        updateFeedback(id, { confirmation: started.confirmedBy })
        // 終了通知は起動受付のPromiseより先に届くことがある。終了・失敗を実行中へ戻さない。
        if (completionReceived) return
        if (started.state === 'completed') { handleCompletion(id, { state: started.stderr ? 'error' : 'completed', stdout: started.initialOutput, stderr: started.stderr, intentionalStop: false }, snapshot); return }
        setRunningSource(snapshot.source)
        updateFeedback(id, { phase: 'running' })
        force(started.confirmedBy === 'still-running' ? 'running-no-marker' : 'running')
      }, isCurrent, () => errorSnapshot, (caught, disconnected) => { updateFeedback(id, { phase: disconnected ? 'disconnected' : 'failed', failedAt, message: caught instanceof Error ? caught.message : String(caught) }) })
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
    if (feedbackRef.current) replaceFeedback({ ...feedbackRef.current, id })
    const isCurrent = () => id === runId.current && device.current === target
    return trap('停止', async () => {
      move('stopping')
      const result = await target.stopMain()
      if (!isCurrent()) return
      if (result) handleCompletion(id, result, snapshot, 'stop')
      else { await target.repl.interrupt(); if (isCurrent()) { activeSnapshot.current = undefined; setRunningSource(null); updateFeedback(id, { phase: 'stopped' }); force('stopped') } }
    }, isCurrent, snapshot, (caught, disconnected) => { updateFeedback(id, { phase: disconnected ? 'disconnected' : 'failed', failedAt: 'stop', message: caught instanceof Error ? caught.message : String(caught) }) })
  }
  const finishReset = async () => { disconnectFeedback(); runId.current++; await transport.disconnect(); connectionLost.current = false; device.current = undefined; activeSnapshot.current = undefined; fileSnapshot.current = undefined; setWrittenSource(null); setRunningSource(null); setDeviceInfo(emptyInfo); force('disconnected') }
  const resetFailure = (caught: unknown, disconnected: boolean) => {
    const current = feedbackRef.current
    if (current?.phase === 'running') updateFeedback(current.id, { phase: disconnected ? 'disconnected' : 'failed', failedAt: 'stop', message: caught instanceof Error ? caught.message : String(caught) })
  }
  const setBoot = (mode: 0 | 1) => trap('起動モード設定', async () => { if (!device.current || programOperation.current !== undefined) return; setBootConfigured(null); const bootSource = fileSnapshot.current?.source ?? null; const text = mode === 0 ? '動作OKとして自動起動モードに変更し、リセットします。実機動作を確認済み？' : '次回起動を永続プログラムモードに変更します。続ける？'; if (!confirm(translate(getLocale(), text))) return; await device.current.prepareForWrite(); move('setting-boot-mode'); await device.current.boot.set(mode, info); setDeviceInfo({ ...infoRef.current, bootOption: mode }); move('resetting'); await device.current.boot.reset(); await finishReset(); setBootConfigured({ source: bootSource, mode }) }, undefined, deviceContext(), resetFailure)
  const reset = () => trap('ハードリセット', async () => { if (!device.current || programOperation.current !== undefined || !confirm(translate(getLocale(), 'MicroPython機器をリセットします。続ける？'))) return; setBootConfigured(null); await device.current.prepareForWrite(); move('resetting'); await device.current.boot.reset(); await finishReset() }, undefined, deviceContext(), resetFailure)
  const locale = getLocale()
  const localizedError = useMemo(() => {
    const saved = errorContext
    if (!error || !saved) return error
    const { snapshot, terminalLog } = saved
    return { ...error, repairPrompt: prompt.build(error, snapshot.source, snapshot.device, terminalLog, error.stage, snapshot.workshop, { sourceKnown: snapshot.sourceKnown, locale }) }
  }, [error, errorContext, locale, prompt])
  return { supported: transport.supported, state, info, log, setLog, error: localizedError, source, setSource, writtenSource, runningSource, bootConfigured, programFeedback, baudRate, setBaudRate, connect, reconnect, disconnect, normalMode, load, write, run, stop, setBoot, reset }
}
