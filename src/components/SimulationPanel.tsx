import { useEffect, useRef, useState } from 'react'
import { boardDefinitions, type BoardId } from '../config/boards'
import { useLocale } from '../i18n'
import type { ProjectSettings } from '../services/projects/types'
import { isSimulationSupported, SimulationClient } from '../services/simulation/SimulationClient'
import type { SimulationConfig, SimulationSnapshot } from '../services/simulation/types'
import './SimulationPanel.css'

export interface SimulationPanelProps { source: string; settings: ProjectSettings | null; active?: boolean }

const initialSnapshot = (): SimulationSnapshot => ({ phase: 'idle', pixels: [], elapsedMs: 0, bleEnabled: false, modes: [], actions: [], log: '', error: '' })
const phaseLabels = { idle: '再生すると試せます', loading: 'シミュレーターを準備中…', running: 'シミュレーション中', paused: 'シミュレーションを一時停止中', finished: 'シミュレーションが終了しました', error: 'シミュレーションを続けられません' } as const

export function SimulationPanel({ source, settings, active = true }: SimulationPanelProps) {
  const { t } = useLocale()
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(initialSnapshot)
  const [overrides, setOverrides] = useState<Partial<Pick<SimulationConfig, 'boardId' | 'ledCount' | 'ledPin'>>>({})
  const [layout, setLayout] = useState<'strip' | 'ring'>('strip')
  const [run, setRun] = useState<{ source: string; config: string } | null>(null)
  const [held, setHeld] = useState(false)
  const [brightness, setBrightness] = useState(100)
  const [trigger, setTrigger] = useState('')
  const [appliedLedCount, setAppliedLedCount] = useState<number | null>(null)
  const client = useRef<SimulationClient | null>(null)
  const pressed = useRef(false)
  const pendingBrightness = useRef<number | null>(null)
  const boardId = overrides.boardId ?? settings?.boardId ?? 'm5nanoc6'
  const board = boardDefinitions[boardId]
  const config: SimulationConfig = { boardId, ledPin: overrides.ledPin ?? settings?.ledPin ?? 2, ledCount: overrides.ledCount ?? settings?.ledCount ?? 10, buttonPin: board.buttonPin }
  const configKey = JSON.stringify(config)
  const validConfig = Number.isInteger(config.ledCount) && config.ledCount >= 1 && config.ledCount <= 300 && Number.isInteger(config.ledPin) && config.ledPin >= 0 && config.ledPin <= (boardId === 'm5nanoc6' ? 30 : 48)
  const supported = isSimulationSupported()
  const stale = run !== null && (run.source !== source || run.config !== configKey)
  const running = snapshot.phase === 'running'
  const busy = snapshot.phase === 'loading'
  const interactive = running && active && !stale
  const canPlay = supported && validConfig && Boolean(source.trim()) && !busy && active
  const canApplyLedCount = run !== null && !stale && !busy && snapshot.phase !== 'idle' && snapshot.pixels.length >= 1 && snapshot.pixels.length <= 300
  const applyLedCount = () => {
    if (!canApplyLedCount) return
    const ledCount = snapshot.pixels.length
    setOverrides(previous => ({ ...previous, ledCount }))
    // 出力を受け取った後の表示数だけを変更する。実行中の演出を止めたり再起動しない。
    setRun(previous => previous ? { ...previous, config: JSON.stringify({ ...config, ledCount }) } : previous)
    setAppliedLedCount(ledCount)
  }

  const releaseButton = () => {
    if (!pressed.current) return
    pressed.current = false
    setHeld(false)
    client.current?.button(false)
  }
  const pressButton = () => {
    if (!interactive || pressed.current) return
    pressed.current = true
    setHeld(true)
    client.current?.button(true)
  }
  const pause = () => { releaseButton(); pendingBrightness.current = null; client.current?.pause() }
  const play = () => {
    if (!canPlay) return
    if (snapshot.phase === 'paused' && !stale) { client.current?.resume(); return }
    releaseButton()
    pendingBrightness.current = null
    client.current ??= new SimulationClient(next => {
      setSnapshot(next)
      if (next.phase !== 'running') setHeld(false)
    })
    setRun({ source, config: configKey })
    setAppliedLedCount(null)
    client.current.start(source, config)
  }
  const reset = () => {
    releaseButton()
    pendingBrightness.current = null
    client.current?.reset()
    setSnapshot(initialSnapshot())
    setRun(null)
    setAppliedLedCount(null)
    setBrightness(100)
  }
  const send = (command: string) => { if (interactive && snapshot.bleEnabled) client.current?.command(command) }
  const commitBrightness = () => {
    if (pendingBrightness.current !== null) send(`BRIGHTNESS ${pendingBrightness.current}`)
    pendingBrightness.current = null
  }

  useEffect(() => () => { client.current?.dispose(); client.current = null }, [])
  useEffect(() => {
    if (active && !stale) return
    // 入力を離してから停止する。別タブへ移動しても押しっぱなしにしない。
    pressed.current = false
    pendingBrightness.current = null
    client.current?.button(false)
    client.current?.pause()
  }, [active, stale, running])
  useEffect(() => {
    const leave = () => {
      pressed.current = false
      setHeld(false)
      pendingBrightness.current = null
      client.current?.button(false)
      if (document.hidden) client.current?.pause()
    }
    window.addEventListener('blur', leave)
    document.addEventListener('visibilitychange', leave)
    return () => { window.removeEventListener('blur', leave); document.removeEventListener('visibilitychange', leave) }
  }, [])

  const pixels = Array.from({ length: config.ledCount >= 1 && config.ledCount <= 300 ? config.ledCount : 10 }, (_, index) => snapshot.pixels[index] ?? [0, 0, 0])
  const lit = pixels.filter(pixel => pixel.some(value => value > 0)).length
  const columns = Math.min(pixels.length, 20)
  const rows = Math.ceil(pixels.length / columns)
  const height = layout === 'ring' ? 300 : Math.max(110, rows * 23 + 36)
  const dotRadius = layout === 'ring' ? Math.min(11, Math.max(1.1, 310 / pixels.length)) : Math.min(9, 160 / columns)
  const actionId = trigger.trim().toUpperCase()
  const validAction = /^[A-Z][A-Z0-9_]{0,11}$/.test(actionId) && !['OFF', 'PLAY', 'PAUSE', 'STATUS', 'BRIGHTNESS', 'SPEED', 'MODE', 'ACTION'].includes(actionId)

  return <section className="panel simulation-panel" aria-labelledby="simulation-title">
    <div className="simulation-heading"><div><p className="eyebrow">{t('機器につながず、画面で試す')}</p><h2 id="simulation-title">{t('LED・ボタンのシミュレーション')}</h2></div><span className="simulation-only">{t('画面だけ')}</span></div>
    <p className="simulation-intro">{t('編集したコードを仮想のLEDとボタンで動かします。実機への書き込みやBluetooth通信は行いません。')}</p>
    <p className="simulation-help">{t('内容が分からないコードは実行しないでください。')}</p>
    <div className="simulation-toolbar">
      <button className="run-button" type="button" onClick={running ? pause : play} disabled={running ? false : !canPlay}>{t(running ? 'Ⅱ シミュレーションを一時停止' : stale ? '▶ 最新コードで再生' : snapshot.phase === 'paused' ? '▶ シミュレーションを再開' : '▶ シミュレーションを再生')}</button>
      <button className="quiet-button" type="button" onClick={reset} disabled={snapshot.phase === 'idle'}>{t('↺ リセット')}</button>
    </div>
    <p className={`simulation-state ${snapshot.phase}`}><span role="status">{t(phaseLabels[snapshot.phase])}</span><span>{(snapshot.elapsedMs / 1000).toFixed(1)} s</span></p>
    {busy && <p className="simulation-help">{t('初回は約12MBの実行環境を読み込みます。回線によって少し時間がかかります。')}</p>}
    {!supported && <p className="simulation-warning" role="alert">{t('この環境ではシミュレーターを動かせません。対応するChrome・Edgeで、HTTPSまたはlocalhostから開いてください。')}</p>}
    {stale && <p className="simulation-warning">{t('コードまたは設定が変わりました。「最新コードで再生」で最初から試してください。')}</p>}
    {snapshot.error && <div className="simulation-warning" role="alert"><strong>{t('画面上の実行エラー')}</strong><pre>{t(snapshot.error)}</pre><p>{t('未対応の機能もあります。画面上のエラーだけで、実機でも動かないとは判断できません。')}</p></div>}
    <div className="simulation-display-head"><div className="simulation-display-meta"><span>{board.name} · GPIO {config.ledPin}</span><span>{t('{count}個のLED / 点灯 {lit}個', { count: pixels.length, lit })}</span></div><div className="simulation-layout" role="group" aria-label={t('LEDの並べ方')}><button type="button" className="quiet-button" aria-pressed={layout === 'strip'} onClick={() => setLayout('strip')}>{t('テープ')}</button><button type="button" className="quiet-button" aria-pressed={layout === 'ring'} onClick={() => setLayout('ring')}>{t('リング')}</button></div></div>
    {validConfig && snapshot.pixels.length > 0 && snapshot.pixels.length !== config.ledCount && <div className="simulation-warning"><p>{t('コードの出力は{actual}個、表示設定は{configured}個です。ボタンで出力されたLED数を表示に反映できます。', { actual: snapshot.pixels.length, configured: config.ledCount })}</p><button type="button" disabled={!canApplyLedCount} onClick={applyLedCount}>{t('コードのLED数を反映')}</button></div>}
    {!stale && appliedLedCount !== null && appliedLedCount === config.ledCount && appliedLedCount === snapshot.pixels.length && <p className="simulation-help" role="status">{t('表示するLED数を{count}個に変更しました。コードや実機の設定は変更していません。', { count: appliedLedCount })}</p>}
    <div className="simulation-led-view"><svg viewBox={`0 0 360 ${height}`} role="img" aria-label={t('仮想LED。{count}個中{lit}個が点灯。実機の状態ではありません。', { count: pixels.length, lit })}>
      {layout === 'ring' && <circle cx="180" cy="150" r="110" fill="none" stroke="#293d50" strokeWidth="15" />}
      {pixels.map((pixel, index) => {
        const angle = (index / pixels.length) * Math.PI * 2 - Math.PI / 2
        const x = layout === 'ring' ? 180 + Math.cos(angle) * 110 : 20 + ((index % columns) + .5) * (320 / columns)
        const y = layout === 'ring' ? 150 + Math.sin(angle) * 110 : (height - rows * 23) / 2 + Math.floor(index / columns) * 23 + 11.5
        return <g key={index}><circle cx={x} cy={y} r={dotRadius} fill={`rgb(${pixel.join(',')})`} stroke="#657990" strokeWidth="1" /><title>{`LED ${index + 1}: RGB ${pixel.join(', ')}`}</title>{index === 0 && <text x={x} y={y - dotRadius - 6} fill="#c4d9ed" textAnchor="middle" fontSize="10">1</text>}</g>
      })}
    </svg></div>
    <div className="simulation-inputs"><h3>{t('内蔵ボタンを試す')}</h3><button type="button" className={`simulation-hardware-button${held && interactive ? ' pressed' : ''}`} disabled={!interactive} aria-pressed={held && interactive}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); pressButton() }}
      onPointerUp={releaseButton} onPointerCancel={releaseButton} onLostPointerCapture={releaseButton} onBlur={releaseButton}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) pressButton() } }}
      onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); releaseButton() } }}>
      {t(held && interactive ? '● ボタンを押しています' : '● 本体ボタン（押している間ON）')}</button><p className="simulation-help">{t('短く押す・2回押す・長押しを試せます。動きはコードの内容で決まります。キーボードはSpaceまたはEnterです。')}</p></div>
    {snapshot.bleEnabled ? <div className="simulation-inputs simulation-ble"><h3>{t('BLEリモコンを試す（仮想通信）')}</h3><div className="simulation-ble-buttons"><button type="button" disabled={!interactive} onClick={() => send('PLAY')}>{t('▶ LEDを再生')}</button><button type="button" className="quiet-button" disabled={!interactive} onClick={() => send('PAUSE')}>{t('Ⅱ LEDを停止')}</button><button type="button" className="quiet-button" disabled={!interactive} onClick={() => send('OFF')}>{t('○ ライトを消す')}</button></div>
      <label className="simulation-brightness" htmlFor="simulation-brightness"><span>{t('仮想リモコンの明るさ')}</span><strong>{brightness}%</strong></label><input id="simulation-brightness" type="range" min="0" max="100" step="1" value={brightness} disabled={!interactive} onChange={event => { const value = Number(event.target.value); setBrightness(value); pendingBrightness.current = value }} onPointerUp={commitBrightness} onKeyUp={commitBrightness} onBlur={commitBrightness} onPointerCancel={() => { pendingBrightness.current = null }} />
      {snapshot.modes.length > 0 && <div className="simulation-control-list" role="group" aria-label={t('仮想モード')}><h4>{t('モードを選ぶ')}</h4>{snapshot.modes.map(mode => <button type="button" className="quiet-button" disabled={!interactive} key={mode.id} onClick={() => send(`MODE ${mode.id}`)}>{mode.label}</button>)}</div>}
      <div className="simulation-control-list" role="group" aria-label={t('仮想アクション')}><h4>{t('演出を試す')}</h4>{snapshot.actions.map(action => <button type="button" disabled={!interactive} key={action.id} onClick={() => send(`ACTION ${action.id}`)}>{action.label}</button>)}{snapshot.actions.length === 0 && <p className="simulation-help">{t('コードから演出名がまだ届いていません。対応するACTIONのIDが分かる場合は下で試せます。')}</p>}</div>
      <details className="simulation-details"><summary>{t('演出のIDを指定して試す')}</summary><label htmlFor="simulation-action">{t('ACTIONのID（英数字・_、12文字まで）')}</label><div className="simulation-trigger"><input id="simulation-action" type="text" value={trigger} maxLength={12} placeholder="SPARKLE" onChange={event => setTrigger(event.target.value)} /><button type="button" disabled={!interactive || !validAction} onClick={() => send(`ACTION ${actionId}`)}>{t('演出を送る')}</button></div></details>
      <p className="simulation-help">{t('NanoLED対応の命令をコードへ渡します。BLEの接続品質や電波は再現しません。')}</p></div> : <p className="simulation-help">{t('コード内でNanoLED対応のBLE通信が始まると、仮想BLEリモコンが表示されます。その他のBLE仕様は未対応です。')}</p>}
    <details className="simulation-details simulation-settings"><summary>{t('シミュレーションの機器・LED設定')}</summary><p className="simulation-help">{t(settings ? 'AIの準備または保存プログラムの設定を初期値にしています。コード内のピン・LED数と合わせてください。' : '仮の初期値はNanoC6・GPIO 2・LED 10個です。コード内の設定に合わせてください。')}</p><div className="simulation-config-grid"><label>{t('使う機器')}<select value={boardId} onChange={event => setOverrides(previous => ({ ...previous, boardId: event.target.value as BoardId }))}><option value="m5nanoc6">M5NanoC6</option><option value="atoms3lite">AtomS3Lite</option></select></label><label>{t('外部LEDピン（GPIO）')}<input type="number" min="0" max={boardId === 'm5nanoc6' ? 30 : 48} value={config.ledPin} onChange={event => setOverrides(previous => ({ ...previous, ledPin: Number(event.target.value) }))} /></label><label>{t('LEDの数')}<input type="number" min="1" max="300" value={config.ledCount} onChange={event => setOverrides(previous => ({ ...previous, ledCount: Number(event.target.value) }))} /></label></div><p className="simulation-help">{t('内蔵ボタン: GPIO {pin}。ここの設定はコードや機器を変更しません。', { pin: config.buttonPin })}</p>{!validConfig && <p className="simulation-warning">{t('LED数は1〜300、GPIOは機器に合う範囲で入力してください。')}</p>}</details>
    <details className="simulation-details"><summary>{t('シミュレーションの記録・対応範囲')}</summary><p className="simulation-help">{t('Pyodide（CPython）と仮想の機器APIで動かしています。MicroPythonそのものの実行環境ではなく、すべての機能や動作の一致は保証できません。')}</p><p className="simulation-help">{t('画面の色・明るさ・時間は目安です。配線、電源、実際のLEDの発色、UIFlow2固有の機能は実機で確認してください。')}</p><pre className="simulation-log" aria-label={t('シミュレーションの出力')}>{snapshot.log || t('まだ出力はありません。')}</pre></details>
  </section>
}
