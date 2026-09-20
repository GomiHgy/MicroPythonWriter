import { useEffect, useState, useSyncExternalStore } from 'react'
import { BluetoothController } from '../services/bluetooth/BluetoothController'
import { MAX_STATUS_AGE_MS } from '../services/bluetooth/protocol'
import { useLocale } from '../i18n'
import { effectIcons, type RemoteButton } from '../services/projects/types'
import { RemoteButtonEditor } from './RemoteButtonEditor'
import './BluetoothPanel.css'

const modes = [
  { command: 'PINK', name: 'ピンク', description: 'やさしい一色の光', icon: '●', color: '#ff68b0' },
  { command: 'BLUE', name: 'ブルー', description: 'すっきり青い光', icon: '●', color: '#62aaff' },
  { command: 'MAGIC', name: 'マジック', description: '光が流れる', icon: '✦', color: '#c49aff' },
  { command: 'RAINBOW', name: 'にじいろ', description: '色がゆっくり変わる', icon: '🌈', color: '#ffca68' },
]

function ControlSlider({ command, label, value, disabled, send }: { command: 'BRIGHTNESS' | 'SPEED'; label: string; value: number | null; disabled: boolean; send: (command: string) => Promise<boolean> }) {
  const { t } = useLocale()
  const [editing, setEditing] = useState<number | null>(null)
  const chosen = editing ?? value ?? (command === 'BRIGHTNESS' ? 100 : 0)
  const commit = () => {
    if (editing === null) return
    if (!disabled) void send(`${command} ${editing}`)
    setEditing(null)
  }
  return <div className="control-slider">
    <label htmlFor={`ble-${command}`}><strong>{label}</strong><span>{value === null && editing === null ? t('未受信') : <>{t(editing === null ? '機器の設定' : '選択中')} <b>{chosen}%</b></>}</span></label>
    <input id={`ble-${command}`} type="range" min="0" max="100" step="1" value={chosen} disabled={disabled}
      onChange={event => setEditing(Number(event.target.value))}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={() => setEditing(null)}
      aria-valuetext={value === null && editing === null ? t('未受信') : t('{value}パーセント', { value: chosen })} />
    <div className="slider-scale"><span>{t(command === 'BRIGHTNESS' ? '暗く' : 'ゆっくり')}</span><span>{t(command === 'BRIGHTNESS' ? '明るく' : 'はやく')}</span></div>
  </div>
}

export function BluetoothPanel({ onOpenProgram, onOpenPreparation, remoteButtons = [], projectName, onRemoteButtonsChange }: { onOpenProgram: () => void; onOpenPreparation: () => void; remoteButtons?: RemoteButton[]; projectName?: string; onRemoteButtonsChange?: (buttons: RemoteButton[]) => void }) {
  const { locale, t } = useLocale()
  const [controller] = useState(() => new BluetoothController())
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [now, setNow] = useState(() => Date.now())
  const [custom, setCustom] = useState('')
  const [sentNotice, setSentNotice] = useState<{ connectedAt: number | null; at: number } | null>(null)
  const [focused, setFocused] = useState(false)
  useEffect(() => () => controller.disconnect(), [controller])
  useEffect(() => {
    if (state.phase !== 'connected') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state.phase])

  const connected = state.phase === 'connected'
  const connecting = state.phase === 'connecting'
  const stale = connected && state.receivedAt !== null && now - state.receivedAt > MAX_STATUS_AGE_MS
  const waitingTooLong = connected && state.receivedAt === null && state.connectedAt !== null && now - state.connectedAt > MAX_STATUS_AGE_MS
  const canControl = connected && state.status !== null && !stale
  const artwork = state.status?.v === 2 ? state.status : null
  const legacy = state.status?.v === 1
  const canPlay = canControl && artwork !== null && (artwork.playback !== 'playing' || artwork.action !== null)
  const canPause = canControl && artwork !== null && artwork.playback === 'playing'
  const connectionLabel = state.phase === 'unsupported' ? '接続非対応' : connecting ? '接続中' : !connected ? '未接続' : !state.status ? '状態待ち' : legacy ? '旧仕様（NanoLED v1）' : '新仕様（NanoLED v2）'
  const availabilityReason = state.phase === 'unsupported'
    ? 'この環境では操作できません。対応するChrome・Edgeで開いてください。'
    : connecting ? '機器を選び、接続が完了するまで待ってください。'
    : !connected ? 'まだ機器とつながっていません。対応プログラムを実行し、「Bluetoothでつなぐ」を押してください。'
    : !state.status ? 'Bluetoothには接続できました。機器から操作一覧と状態が届くまで待っています。通信仕様はまだ未確認です。'
    : stale ? '状態の更新が止まったため、操作を一時的に無効にしています。再受信を試し、戻らなければ接続を切ってつなぎ直してください。'
    : legacy ? '明るさ・消灯・従来の4モードは使えます。再生・停止・作品専用アクションには、新仕様の対応プログラムが必要です。'
    : '機器から新仕様の状態と操作一覧を受け取りました。この作品で使えるボタンを表示しています。'
  const showSpeed = !artwork || artwork.controls.speed
  const pixels = state.status?.pixels.match(/.{6}/g) ?? []
  const litCount = pixels.filter(pixel => pixel !== '000000').length
  const mode = state.status?.mode
  const knownMode = mode === 'OFF' ? '消灯' : modes.find(item => item.command === mode)?.name
  const modeName = artwork ? artwork.controls.modes.find(item => item.id === mode)?.label : knownMode ? t(knownMode) : mode
  const playbackName = artwork ? t(artwork.playback === 'playing' ? '再生中' : artwork.playback === 'paused' ? '停止中（色を保持）' : '消灯') : t(legacy ? 'このプログラムでは未対応' : '未受信')
  const actionName = artwork?.controls.actions.find(item => item.id === artwork.action)?.label
  const appearance = (kind: RemoteButton['kind'], id: string, label: string): RemoteButton => remoteButtons.find(button => button.kind === kind && button.id === id) ?? { kind, id, label, icon: kind === 'mode' ? 'light' : 'star' }
  const title = connected ? t('{name} とつながっています', { name: state.deviceName ?? 'M5NanoC6 / AtomS3Lite' }) : t(connecting ? '機器につないでいます…' : '光を、手元でコントロール')
  const description = t(connected ? 'ボタンやスライダーで光り方を変えてみよう。' : connecting ? '機器を選んだら、このまま少し待ってください。' : 'M5NanoC6／AtomS3Liteの電源を入れて、「Bluetoothでつなぐ」を押してください。')
  const customValid = /^[A-Z][A-Z0-9_]{0,15}$/.test(custom.trim().toUpperCase()) && !['BRIGHTNESS', 'SPEED', 'MODE', 'ACTION', 'PLAY', 'PAUSE'].includes(custom.trim().toUpperCase())
  const send = async (command: string) => {
    const session = state.connectedAt
    const sent = await controller.send(command)
    if (sent && command !== 'STATUS' && controller.getSnapshot().phase === 'connected' && controller.getSnapshot().connectedAt === session) setSentNotice({ connectedAt: session, at: Date.now() })
    return sent
  }

  return <div className={`bluetooth-panel${focused && artwork ? ' using-view' : ''}`}>
    <section className={`device-card ${connected ? 'ready' : 'waiting'}`}>
      <div className="status-badge" aria-hidden="true">{connected ? '✓' : connecting ? '…' : '⌁'}</div>
      <div className="device-copy"><p className="eyebrow">{t('コードを書かずに、光をあそぼう')}</p><h2>{title}</h2><p>{description}</p></div>
      <div className="device-actions">
        <button className="connect-button" disabled={state.phase === 'unsupported' || connecting || connected} onClick={() => void controller.connect()}>{t('Bluetoothでつなぐ')}</button>
        {(connected || connecting) && <button className="quiet-button" onClick={() => controller.disconnect()}>{t(connecting ? 'キャンセル' : '接続を切る')}</button>}
      </div>
    </section>

    {state.phase === 'unsupported' && <div className="notice warn" role="alert">{t('この環境ではBluetooth接続を使えません。パソコン版Chrome・Edge、またはAndroid版Chromeで、HTTPSのページ（開発時はlocalhost）を開いてください。iPhone・iPadの標準ブラウザでは使えません。')}</div>}
    {state.error && state.phase !== 'unsupported' && <div className="notice warn" role="alert">{t(state.error)}</div>}
    <p className="bluetooth-guide">{t('はじめてなら、プログラム画面で対応プログラムを「実行」しよう。タブを変えてもプログラムは止まりません。')}</p>
    {artwork && <div className="remote-view-toggle"><strong>{projectName}</strong><button className="quiet-button" aria-pressed={focused} onClick={() => setFocused(value => !value)}>{t(focused ? '設定も表示する' : '作品を使う画面にする')}</button></div>}

    <div className="controller-grid">
      <section className="panel remote-panel" aria-labelledby="remote-title">
        <div className="section-heading"><div><p className="eyebrow">{t('1. 光り方をえらぶ')}</p><h2 id="remote-title">{t('リモコン')}</h2></div><span className="small-badge">{t(state.sending ? '送信中…' : canControl ? '操作できます' : '接続・受信してから操作')}</span></div>
        <div className={`remote-availability${canControl ? ' available' : ''}`} role="status" aria-live="polite">
          <p><span>{t(stale ? '最後に確認した仕様' : '接続・対応状況')}</span><strong>{t(connectionLabel)}</strong>{stale && <span className="small-badge">{t('更新停止')}</span>}</p>
          <p>{t(availabilityReason)}</p>
          {waitingTooLong && <p>{t('5秒以上届いていません。下の「状態をもう一度受け取る」を試してください。')}</p>}
        </div>
        <button className="lights-off quiet-button" disabled={!connected} aria-describedby="lights-off-help" onClick={() => void send('OFF')}>◯ {t('ライトを消す')}</button>
        <p id="lights-off-help" className="controller-note">{t('対応プログラムでは、0.2秒かけてふわっと消灯します。以前のプログラムは更新が必要です。')}</p>
        <div className="playback-controls" aria-describedby="playback-help">
          <p className="playback-status"><span>{t('機器の再生状態')}</span><strong>{stale ? t('最後に届いた状態') : playbackName}</strong></p>
          <div className="playback-buttons">
            <button className="run-button" disabled={!canPlay} onClick={() => { if (canPlay) void send('PLAY') }}>▶ {t('再生')}</button>
            <button className="quiet-button" disabled={!canPause} onClick={() => { if (canPause) void send('PAUSE') }}>■ {t('停止')}</button>
          </div>
          <p id="playback-help" className="controller-note">{t(artwork ? '停止すると、その色のまま動きが止まります。もう一度「再生」で続けられます。' : legacy ? 'この旧仕様では再生・停止を使えません。下の準備手順で新仕様のプログラムを確認してください。' : '再生・停止は、新仕様（NanoLED v2）の状態を受信すると使えます。今は操作できません。')}</p>
        </div>
        <h3 className="control-title">{t('モードを選ぶ')}</h3>
        <div className="mode-buttons">
          {artwork ? artwork.controls.modes.map(item => <button key={item.id} className={`mode-button artwork-mode${canControl && mode === item.id ? ' selected' : ''}`} aria-pressed={canControl && mode === item.id} disabled={!canControl} onClick={() => void send(`MODE ${item.id}`)}>
            <span className="mode-icon" aria-hidden="true">{effectIcons[appearance('mode', item.id, item.label).icon]}</span><strong>{appearance('mode', item.id, item.label).label}</strong>
          </button>) : legacy ? modes.map(item => <button key={item.command} className={`mode-button${canControl && mode === item.command ? ' selected' : ''}`} aria-pressed={canControl && mode === item.command} disabled={!canControl} onClick={() => void send(item.command)}>
            <span className="mode-icon" style={{ color: item.color }} aria-hidden="true">{item.icon}</span><strong>{t(item.name)}</strong><small>{t(item.description)}</small>
          </button>) : <button className="mode-button control-placeholder" disabled><span className="mode-icon" aria-hidden="true">✦</span><strong>{t('モードを選ぶ')}</strong><small>{t('接続後に機器から届きます')}</small></button>}
        </div>
        <section className="action-controls" aria-labelledby="action-title">
          <h3 id="action-title" className="control-title">{t('一度だけ演出する')}</h3>
          {artwork ? artwork.controls.actions.length ? <><div className="action-buttons">{artwork.controls.actions.map(item => <button key={item.id} className="action-button" disabled={!canControl || state.sending || artwork.action !== null} onClick={() => void send(`ACTION ${item.id}`)}><span aria-hidden="true">{effectIcons[appearance('action', item.id, item.label).icon]}</span> {appearance('action', item.id, item.label).label}</button>)}</div><p className="controller-note">{t('終わると元のモードと再生状態に戻ります。途中でモード変更・停止・消灯もできます。')}</p></> : <p className="controller-note">{t('この作品には、一度だけの演出はありません。')}</p> : <><button className="action-button control-placeholder" disabled>✧ {t('アクションを実行')}</button><p className="controller-note">{t(legacy ? '作品専用アクションは新仕様（NanoLED v2）で使えます。' : '作品専用のボタン名は、接続後に機器から受け取ります。')}</p></>}
          {actionName && <p className="action-status" role="status">{t(stale ? '最後に届いた演出: {name}' : '機器からの報告: 「{name}」を実行中', { name: actionName })}</p>}
        </section>
        {sentNotice && connected && sentNotice.connectedAt === state.connectedAt && now - sentNotice.at < 5000 && <p className="controller-note command-notice" role="status">{t('操作を送信しました。実行完了の確認ではありません。機器から届く状態と実際の光を確認してください。')}</p>}
        <div className="slider-heading"><p className="eyebrow">{t('2. 好みに合わせる')}</p><h3>{t(showSpeed ? '明るさとスピード' : '明るさ')}</h3></div>
        <ControlSlider key={`brightness-${canControl}`} command="BRIGHTNESS" label={t('明るさ')} value={state.status?.brightness ?? null} disabled={!canControl} send={send} />
        {showSpeed && <ControlSlider key={`speed-${canControl}`} command="SPEED" label={t('スピード')} value={state.status?.speed ?? null} disabled={!canControl} send={send} />}
        <p className="controller-note">{t(showSpeed ? 'スライダーは指を離すと送信します。明るさ100%でも、プログラムの安全な上限を超えません。スピードは動きのある光り方に使います。' : '指を離すと明るさを送信します。100%はプログラムで決めた安全上限です。消灯中に動かしても点灯しません。')}</p>
        {!artwork && <section className="remote-setup" aria-labelledby="remote-setup-title">
          <h3 id="remote-setup-title">{t('対応プログラムの準備')}</h3>
          <ol>
            <li>{t('「AIの準備」で機器・UIFlow2版・LEDの設定を確認します。')}</li>
            <li>{t('再生・停止・作品専用ボタンには、NanoLED v2対応の main.py が必要です。通常のLEDプログラムや旧仕様だけでは使えません。')}</li>
            <li>{t('対応コードを用意したら「プログラム」画面に貼り、「実行」。この画面へ戻り、Bluetoothでつないで状態を受け取ります。')}</li>
          </ol>
          <p className="controller-note">{t('対応コードがまだない場合は、作成者に使用機器・UIFlow2版・LED構成を伝えて準備を依頼してください。このアプリには実機確認済みのBLE基準コードは含まれていません。')}</p>
          <p className="controller-note">{t('確認済みの基準コードは「AIの準備」の詳細設定で登録できます。動作確認をしていないコードを確認済みにしないでください。接続だけではプログラムは更新されません。')}</p>
        </section>}
        <div className="remote-setup-links"><button className="quiet-button" onClick={onOpenPreparation}>{t('AIの準備へ')}</button><button className="text-button" onClick={onOpenProgram}>{t('プログラム画面')}</button></div>
      </section>

      <section className={`panel led-panel${!connected || stale ? ' outdated' : ''}`} aria-labelledby="led-title">
        <div className="section-heading"><div><p className="eyebrow">{t('3. 機器から届いた光を見る')}</p><h2 id="led-title">{t('いまのLED')}</h2></div><span className={`small-badge ${canControl ? 'live' : ''}`}>{t(!connected ? '未接続' : stale ? '更新が止まっています' : state.status ? '受信中' : '受信待ち')}</span></div>
        {!state.status ? <div className="led-placeholder"><span aria-hidden="true">✦</span><h3>{t(connected ? 'LEDの状態を待っています' : 'つながると、ここに光が届きます')}</h3><p>{t(connected ? 'しばらく待っても表示されない場合は、下の「うまくつながらないとき」を確認してください。' : '機器が送ったLEDの色を、ひとつずつ表示します。')}</p></div> : <>
          <div className="led-summary"><strong>{!connected || stale ? t('最後に届いた状態') : modeName}</strong><span>{litCount === 0 ? t('すべて消灯') : t('{count}個のうち{lit}個が点灯', { count: pixels.length, lit: litCount })}</span></div>
          <div className="led-preview" aria-label={t('{count}個のLED。{lit}個が点灯。{mode}', { count: pixels.length, lit: litCount, mode: modeName ?? '' })}>
            {pixels.map((color, index) => <span key={index} className={`led-dot${color === '000000' ? ' off' : ''}`} style={{ backgroundColor: `#${color}`, boxShadow: color === '000000' ? 'none' : `0 0 12px #${color}80` }} title={`LED ${index + 1}: #${color.toUpperCase()}`} />)}
          </div>
          <dl className="led-values"><div><dt>{t('光り方')}</dt><dd>{modeName}</dd></div><div><dt>{t('明るさの設定')}</dt><dd>{state.status.brightness}%</dd></div>{showSpeed && <div><dt>{t('スピードの設定')}</dt><dd>{state.status.speed}%</dd></div>}{artwork && <div><dt>{t('機器の再生状態')}</dt><dd>{playbackName}</dd></div>}</dl>
          <p className="received-time">{t('最終受信')} {state.receivedAt === null ? '—' : new Date(state.receivedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : locale === 'en' ? 'en-US' : 'ja-JP')}</p>
        </>}
        {stale && <p className="notice warn" role="status">{t('5秒以上、新しい状態が届いていません。機器の電源とプログラムを確認してください。表示は最後に届いたものです。')}</p>}
        {waitingTooLong && <p className="notice warn" role="status">{t('接続できましたが、5秒以上LEDの状態が届いていません。「状態をもう一度受け取る」を試し、変わらなければ対応プログラムを実行してつなぎ直してください。')}</p>}
        <button className="quiet-button refresh-status" disabled={!connected || state.sending} onClick={() => void send('STATUS')}>↻ {t('状態をもう一度受け取る')}</button>
        <p className="controller-note">{t('表示は、機器が報告したLEDへの出力色です。実際の光をセンサーで測ったものではありません。動く光は間をあけて表示します。')}</p>
      </section>
    </div>

    {artwork && onRemoteButtonsChange && <details className="advanced-card remote-appearance"><summary>{t('作品のボタン名とアイコンを変える')}</summary><div className="advanced-body">
      <p>{t('表示名だけをこの作品に保存します。機器のプログラムや通信コマンドは変えません。接続先が報告した操作だけが使えます。')}</p>
      {(['mode', 'action'] as const).flatMap(kind => artwork.controls[kind === 'mode' ? 'modes' : 'actions'].map(item => <RemoteButtonEditor key={`${state.connectedAt}-${projectName}-${kind}-${item.id}-${JSON.stringify(remoteButtons)}`} value={appearance(kind, item.id, item.label)} onSave={value => onRemoteButtonsChange([...remoteButtons.filter(button => button.kind !== kind || button.id !== item.id), value])} />))}
    </div></details>}

    <details className="advanced-card bluetooth-help"><summary><span aria-hidden="true">?</span><div><strong>{t('うまくつながらないとき')}</strong><small>{t('初回の準備・対応プログラムについて')}</small></div></summary><div className="advanced-body">
      <ol><li>{t('プログラム画面で、リモコン対応のプログラムを「実行」してください。普通のLEDプログラムだけでは接続できません。')}</li><li>{t('パソコンやスマートフォンのBluetoothをオンにして、使う機器の「NanoLED-」で始まる名前を選んでください。')}</li><li>{t('ほかのBluetoothアプリでつないでいる場合は、そちらの接続を切ってから試してください。')}</li><li>{t('状態が届かないときは、再受信を試してください。それでも変わらなければ接続を切り、プログラムが動いていることを確認してつなぎ直してください。')}</li></ol>
      <p>{t('USB側で「実行」「停止」や再起動をすると、Bluetoothが切れることがあります。プログラムが動き始めたら、もう一度つないでください。Bluetoothの接続を切るだけではライトは消えません。')}</p>
    </div></details>
    {legacy && <details className="advanced-card bluetooth-custom"><summary><span aria-hidden="true">＋</span><div><strong>{t('自分で追加した光り方を呼び出す')}</strong><small>{t('プログラムにコマンドを追加した人向け')}</small></div></summary><div className="advanced-body"><form onSubmit={event => { event.preventDefault(); if (canControl && customValid) void send(custom.trim().toUpperCase()) }}><label htmlFor="ble-custom-command">{t('合言葉（例: STAR）')}</label><div className="custom-command"><input id="ble-custom-command" value={custom} maxLength={16} placeholder="STAR" autoCapitalize="characters" spellCheck={false} onChange={event => setCustom(event.target.value)} /><button disabled={!canControl || !customValid}>{t('送る')}</button></div><p className="controller-note">{t('英字から始まる半角英数字・_ の16文字まで。プログラムにない合言葉は動作しません。')}</p></form></div></details>}
    <footer>{t('この画面はプログラムを書き換えません。Bluetoothで、自分が選んだM5NanoC6／AtomS3Liteだけに操作を送ります。')}</footer>
  </div>
}
