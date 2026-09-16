import { useEffect, useState, useSyncExternalStore } from 'react'
import { BluetoothController } from '../services/bluetooth/BluetoothController'
import { useLocale } from '../i18n'
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

export function BluetoothPanel({ onOpenProgram }: { onOpenProgram: () => void }) {
  const { locale, t } = useLocale()
  const [controller] = useState(() => new BluetoothController())
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [now, setNow] = useState(() => Date.now())
  const [custom, setCustom] = useState('')
  useEffect(() => () => controller.disconnect(), [controller])
  useEffect(() => {
    if (state.phase !== 'connected') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state.phase])

  const connected = state.phase === 'connected'
  const connecting = state.phase === 'connecting'
  const stale = connected && state.receivedAt !== null && now - state.receivedAt > 5000
  const canControl = connected && state.status !== null && !stale
  const pixels = state.status?.pixels.match(/.{6}/g) ?? []
  const litCount = pixels.filter(pixel => pixel !== '000000').length
  const mode = state.status?.mode
  const knownMode = mode === 'OFF' ? '消灯' : modes.find(item => item.command === mode)?.name
  const modeName = knownMode ? t(knownMode) : mode
  const title = connected ? t('{name} とつながっています', { name: state.deviceName ?? 'M5NanoC6 / AtomS3Lite' }) : t(connecting ? '機器につないでいます…' : '光を、手元でコントロール')
  const description = t(connected ? 'ボタンやスライダーで光り方を変えてみよう。' : connecting ? '機器を選んだら、このまま少し待ってください。' : 'M5NanoC6／AtomS3Liteの電源を入れて、「Bluetoothでつなぐ」を押してください。')
  const customValid = /^[A-Z][A-Z0-9_]{0,15}$/.test(custom.trim().toUpperCase()) && !['BRIGHTNESS', 'SPEED'].includes(custom.trim().toUpperCase())
  const send = (command: string) => controller.send(command)

  return <div className="bluetooth-panel">
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
    <p className="bluetooth-guide">{t('はじめてなら、プログラム画面で対応プログラムを「実行」しよう。タブを変えてもプログラムは止まりません。')} <button className="text-button" onClick={onOpenProgram}>{t('プログラム画面')}</button></p>

    <div className="controller-grid">
      <section className="panel remote-panel" aria-labelledby="remote-title">
        <div className="section-heading"><div><p className="eyebrow">{t('1. 光り方をえらぶ')}</p><h2 id="remote-title">{t('リモコン')}</h2></div><span className="small-badge">{t(state.sending ? '送信中…' : canControl ? '操作できます' : '接続・受信してから操作')}</span></div>
        <div className="mode-buttons">
          {modes.map(item => <button key={item.command} className={`mode-button${canControl && mode === item.command ? ' selected' : ''}`} aria-pressed={canControl && mode === item.command} disabled={!canControl} onClick={() => void send(item.command)}>
            <span className="mode-icon" style={{ color: item.color }} aria-hidden="true">{item.icon}</span><strong>{t(item.name)}</strong><small>{t(item.description)}</small>
          </button>)}
        </div>
        <button className="lights-off quiet-button" disabled={!connected} onClick={() => void send('OFF')}>◯ {t('ライトを消す')}</button>
        <div className="slider-heading"><p className="eyebrow">{t('2. 好みに合わせる')}</p><h3>{t('明るさとスピード')}</h3></div>
        <ControlSlider key={`brightness-${canControl}`} command="BRIGHTNESS" label={t('明るさ')} value={state.status?.brightness ?? null} disabled={!canControl} send={send} />
        <ControlSlider key={`speed-${canControl}`} command="SPEED" label={t('スピード')} value={state.status?.speed ?? null} disabled={!canControl} send={send} />
        <p className="controller-note">{t('スライダーは指を離すと送信します。明るさ100%でも、プログラムの安全な上限を超えません。スピードは動きのある光り方に使います。')}</p>
      </section>

      <section className={`panel led-panel${!connected || stale ? ' outdated' : ''}`} aria-labelledby="led-title">
        <div className="section-heading"><div><p className="eyebrow">{t('3. 機器から届いた光を見る')}</p><h2 id="led-title">{t('いまのLED')}</h2></div><span className={`small-badge ${canControl ? 'live' : ''}`}>{t(!connected ? '未接続' : stale ? '更新が止まっています' : state.status ? '受信中' : '受信待ち')}</span></div>
        {!state.status ? <div className="led-placeholder"><span aria-hidden="true">✦</span><h3>{t(connected ? 'LEDの状態を待っています' : 'つながると、ここに光が届きます')}</h3><p>{t(connected ? 'しばらく待っても表示されない場合は、下の「うまくつながらないとき」を確認してください。' : '機器が送ったLEDの色を、ひとつずつ表示します。')}</p></div> : <>
          <div className="led-summary"><strong>{!connected || stale ? t('最後に届いた状態') : modeName}</strong><span>{litCount === 0 ? t('すべて消灯') : t('{count}個のうち{lit}個が点灯', { count: pixels.length, lit: litCount })}</span></div>
          <div className="led-preview" aria-label={t('{count}個のLED。{lit}個が点灯。{mode}', { count: pixels.length, lit: litCount, mode: modeName ?? '' })}>
            {pixels.map((color, index) => <span key={index} className={`led-dot${color === '000000' ? ' off' : ''}`} style={{ backgroundColor: `#${color}`, boxShadow: color === '000000' ? 'none' : `0 0 12px #${color}80` }} title={`LED ${index + 1}: #${color.toUpperCase()}`} />)}
          </div>
          <dl className="led-values"><div><dt>{t('光り方')}</dt><dd>{modeName}</dd></div><div><dt>{t('明るさの設定')}</dt><dd>{state.status.brightness}%</dd></div><div><dt>{t('スピードの設定')}</dt><dd>{state.status.speed}%</dd></div></dl>
          <p className="received-time">{t('最終受信')} {state.receivedAt === null ? '—' : new Date(state.receivedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : locale === 'en' ? 'en-US' : 'ja-JP')}</p>
        </>}
        {stale && <p className="notice warn" role="status">{t('5秒以上、新しい状態が届いていません。機器の電源とプログラムを確認してください。表示は最後に届いたものです。')}</p>}
        <button className="quiet-button refresh-status" disabled={!connected || state.sending} onClick={() => void send('STATUS')}>↻ {t('状態をもう一度受け取る')}</button>
        <p className="controller-note">{t('表示は、機器が報告したLEDへの出力色です。実際の光をセンサーで測ったものではありません。動く光は間をあけて表示します。')}</p>
      </section>
    </div>

    <details className="advanced-card bluetooth-help"><summary><span aria-hidden="true">?</span><div><strong>{t('うまくつながらないとき')}</strong><small>{t('初回の準備・対応プログラムについて')}</small></div></summary><div className="advanced-body">
      <ol><li>{t('M5NanoC6／AtomS3Liteで、NanoLED v1に対応したBLEプログラムを実行してください。通常のLEDプログラムだけでは接続できません。')}</li><li>{t('パソコンやスマートフォンのBluetoothをオンにして、使う機器の「NanoLED-」で始まる名前を選んでください。')}</li><li>{t('ほかのBluetoothアプリでつないでいる場合は、そちらの接続を切ってから試してください。')}</li><li>{t('「受信待ち」が続く場合は、prompt.mdの「Webコントローラ対応」の通信仕様と基準コードを確認してください。')}</li></ol>
      <p>{t('USB側で「実行」「停止」や再起動をすると、Bluetoothが切れることがあります。プログラムが動き始めたら、もう一度つないでください。Bluetoothの接続を切るだけではライトは消えません。')}</p>
    </div></details>
    <details className="advanced-card bluetooth-custom"><summary><span aria-hidden="true">＋</span><div><strong>{t('自分で追加した光り方を呼び出す')}</strong><small>{t('プログラムにコマンドを追加した人向け')}</small></div></summary><div className="advanced-body"><form onSubmit={event => { event.preventDefault(); if (canControl && customValid) void send(custom.trim().toUpperCase()) }}><label htmlFor="ble-custom-command">{t('合言葉（例: STAR）')}</label><div className="custom-command"><input id="ble-custom-command" value={custom} maxLength={16} placeholder="STAR" autoCapitalize="characters" spellCheck={false} onChange={event => setCustom(event.target.value)} /><button disabled={!canControl || !customValid}>{t('送る')}</button></div><p className="controller-note">{t('英字から始まる半角英数字・_ の16文字まで。プログラムにない合言葉は動作しません。')}</p></form></div></details>
    <footer>{t('この画面はプログラムを書き換えません。Bluetoothで、自分が選んだM5NanoC6／AtomS3Liteだけに操作を送ります。')}</footer>
  </div>
}
