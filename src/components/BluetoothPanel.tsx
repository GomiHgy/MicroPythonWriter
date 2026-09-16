import { useEffect, useState, useSyncExternalStore } from 'react'
import { BluetoothController } from '../services/bluetooth/BluetoothController'
import './BluetoothPanel.css'

const modes = [
  { command: 'PINK', name: 'ピンク', description: 'やさしい一色の光', icon: '●', color: '#ff68b0' },
  { command: 'BLUE', name: 'ブルー', description: 'すっきり青い光', icon: '●', color: '#62aaff' },
  { command: 'MAGIC', name: 'マジック', description: '光が流れる', icon: '✦', color: '#c49aff' },
  { command: 'RAINBOW', name: 'にじいろ', description: '色がゆっくり変わる', icon: '🌈', color: '#ffca68' },
]

function ControlSlider({ command, label, value, disabled, send }: { command: 'BRIGHTNESS' | 'SPEED'; label: string; value: number | null; disabled: boolean; send: (command: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState<number | null>(null)
  const chosen = editing ?? value ?? (command === 'BRIGHTNESS' ? 100 : 0)
  const commit = () => {
    if (editing === null) return
    if (!disabled) void send(`${command} ${editing}`)
    setEditing(null)
  }
  return <div className="control-slider">
    <label htmlFor={`ble-${command}`}><strong>{label}</strong><span>{value === null && editing === null ? '未受信' : <>{editing === null ? '機器の設定' : '選択中'} <b>{chosen}%</b></>}</span></label>
    <input id={`ble-${command}`} type="range" min="0" max="100" step="1" value={chosen} disabled={disabled}
      onChange={event => setEditing(Number(event.target.value))}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={() => setEditing(null)}
      aria-valuetext={value === null && editing === null ? '未受信' : `${chosen}パーセント`} />
    <div className="slider-scale"><span>{command === 'BRIGHTNESS' ? '暗く' : 'ゆっくり'}</span><span>{command === 'BRIGHTNESS' ? '明るく' : 'はやく'}</span></div>
  </div>
}

export function BluetoothPanel({ onOpenProgram }: { onOpenProgram: () => void }) {
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
  const modeName = mode === 'OFF' ? '消灯' : modes.find(item => item.command === mode)?.name ?? mode
  const title = connected ? `${state.deviceName ?? 'NanoC6'} とつながっています` : connecting ? 'NanoC6につないでいます…' : '光を、手元でコントロール'
  const description = connected ? 'ボタンやスライダーで光り方を変えてみよう。' : connecting ? '機器を選んだら、このまま少し待ってください。' : 'NanoC6の電源を入れて、「Bluetoothでつなぐ」を押してください。'
  const customValid = /^[A-Z][A-Z0-9_]{0,15}$/.test(custom.trim().toUpperCase()) && !['BRIGHTNESS', 'SPEED'].includes(custom.trim().toUpperCase())
  const send = (command: string) => controller.send(command)

  return <div className="bluetooth-panel">
    <section className={`device-card ${connected ? 'ready' : 'waiting'}`}>
      <div className="status-badge" aria-hidden="true">{connected ? '✓' : connecting ? '…' : '⌁'}</div>
      <div className="device-copy"><p className="eyebrow">コードを書かずに、光をあそぼう</p><h2>{title}</h2><p>{description}</p></div>
      <div className="device-actions">
        <button className="connect-button" disabled={state.phase === 'unsupported' || connecting || connected} onClick={() => void controller.connect()}>Bluetoothでつなぐ</button>
        {(connected || connecting) && <button className="quiet-button" onClick={() => controller.disconnect()}>{connecting ? 'キャンセル' : '接続を切る'}</button>}
      </div>
    </section>

    {state.phase === 'unsupported' && <div className="notice warn" role="alert">この環境ではBluetooth接続を使えません。パソコン版Chrome・Edge、またはAndroid版Chromeで、HTTPSのページ（開発時はlocalhost）を開いてください。iPhone・iPadの標準ブラウザでは使えません。</div>}
    {state.error && state.phase !== 'unsupported' && <div className="notice warn" role="alert">{state.error}</div>}
    <p className="bluetooth-guide">はじめてなら、先に対応プログラムを <button className="text-button" onClick={onOpenProgram}>プログラム画面</button> で「実行」しよう。タブを変えてもプログラムは止まりません。</p>

    <div className="controller-grid">
      <section className="panel remote-panel" aria-labelledby="remote-title">
        <div className="section-heading"><div><p className="eyebrow">1. 光り方をえらぶ</p><h2 id="remote-title">リモコン</h2></div><span className="small-badge">{state.sending ? '送信中…' : canControl ? '操作できます' : '接続・受信してから操作'}</span></div>
        <div className="mode-buttons">
          {modes.map(item => <button key={item.command} className={`mode-button${canControl && mode === item.command ? ' selected' : ''}`} aria-pressed={canControl && mode === item.command} disabled={!canControl} onClick={() => void send(item.command)}>
            <span className="mode-icon" style={{ color: item.color }} aria-hidden="true">{item.icon}</span><strong>{item.name}</strong><small>{item.description}</small>
          </button>)}
        </div>
        <button className="lights-off quiet-button" disabled={!connected} onClick={() => void send('OFF')}>◯ ライトを消す</button>
        <div className="slider-heading"><p className="eyebrow">2. 好みに合わせる</p><h3>明るさとスピード</h3></div>
        <ControlSlider key={`brightness-${canControl}`} command="BRIGHTNESS" label="明るさ" value={state.status?.brightness ?? null} disabled={!canControl} send={send} />
        <ControlSlider key={`speed-${canControl}`} command="SPEED" label="スピード" value={state.status?.speed ?? null} disabled={!canControl} send={send} />
        <p className="controller-note">スライダーは指を離すと送信します。明るさ100%でも、プログラムの安全な上限を超えません。スピードは動きのある光り方に使います。</p>
      </section>

      <section className={`panel led-panel${!connected || stale ? ' outdated' : ''}`} aria-labelledby="led-title">
        <div className="section-heading"><div><p className="eyebrow">3. 機器から届いた光を見る</p><h2 id="led-title">いまのLED</h2></div><span className={`small-badge ${canControl ? 'live' : ''}`}>{!connected ? '未接続' : stale ? '更新が止まっています' : state.status ? '受信中' : '受信待ち'}</span></div>
        {!state.status ? <div className="led-placeholder"><span aria-hidden="true">✦</span><h3>{connected ? 'LEDの状態を待っています' : 'つながると、ここに光が届きます'}</h3><p>{connected ? 'しばらく待っても表示されない場合は、下の「うまくつながらないとき」を確認してください。' : '機器が送ったLEDの色を、ひとつずつ表示します。'}</p></div> : <>
          <div className="led-summary"><strong>{!connected || stale ? '最後に届いた状態' : modeName}</strong><span>{litCount === 0 ? 'すべて消灯' : `${pixels.length}個のうち${litCount}個が点灯`}</span></div>
          <div className="led-preview" aria-label={`${pixels.length}個のLED。${litCount}個が点灯。${modeName ?? ''}`}>
            {pixels.map((color, index) => <span key={index} className={`led-dot${color === '000000' ? ' off' : ''}`} style={{ backgroundColor: `#${color}`, boxShadow: color === '000000' ? 'none' : `0 0 12px #${color}80` }} title={`LED ${index + 1}: #${color.toUpperCase()}`} />)}
          </div>
          <dl className="led-values"><div><dt>光り方</dt><dd>{modeName}</dd></div><div><dt>明るさの設定</dt><dd>{state.status.brightness}%</dd></div><div><dt>スピードの設定</dt><dd>{state.status.speed}%</dd></div></dl>
          <p className="received-time">最終受信 {state.receivedAt === null ? '—' : new Date(state.receivedAt).toLocaleTimeString()}</p>
        </>}
        {stale && <p className="notice warn" role="status">5秒以上、新しい状態が届いていません。機器の電源とプログラムを確認してください。表示は最後に届いたものです。</p>}
        <button className="quiet-button refresh-status" disabled={!connected || state.sending} onClick={() => void send('STATUS')}>↻ 状態をもう一度受け取る</button>
        <p className="controller-note">表示は、機器が報告したLEDへの出力色です。実際の光をセンサーで測ったものではありません。動く光は間をあけて表示します。</p>
      </section>
    </div>

    <details className="advanced-card bluetooth-help"><summary><span aria-hidden="true">?</span><div><strong>うまくつながらないとき</strong><small>初回の準備・対応プログラムについて</small></div></summary><div className="advanced-body">
      <ol><li>NanoC6で、NanoLED v1に対応したBLEプログラムを実行してください。通常のLEDプログラムだけでは接続できません。</li><li>パソコンやスマートフォンのBluetoothをオンにして、自分の「NanoLED-番号」を選んでください。</li><li>ほかのBluetoothアプリでつないでいる場合は、そちらの接続を切ってから試してください。</li><li>「受信待ち」が続く場合は、講師に <code>prompt.md</code> の「Webコントローラ対応」の通信仕様と基準コードを確認してもらってください。</li></ol>
      <p>USB側で「実行」「停止」や再起動をすると、Bluetoothが切れることがあります。プログラムが動き始めたら、もう一度つないでください。Bluetoothの接続を切るだけではライトは消えません。</p>
    </div></details>
    <details className="advanced-card bluetooth-custom"><summary><span aria-hidden="true">＋</span><div><strong>自分で追加した光り方を呼び出す</strong><small>プログラムにコマンドを追加した人向け</small></div></summary><div className="advanced-body"><form onSubmit={event => { event.preventDefault(); if (canControl && customValid) void send(custom.trim().toUpperCase()) }}><label htmlFor="ble-custom-command">合言葉（例: STAR）</label><div className="custom-command"><input id="ble-custom-command" value={custom} maxLength={16} placeholder="STAR" autoCapitalize="characters" spellCheck={false} onChange={event => setCustom(event.target.value)} /><button disabled={!canControl || !customValid}>送る</button></div><p className="controller-note">英字から始まる半角英数字・_ の16文字まで。プログラムにない合言葉は動作しません。</p></form></div></details>
    <footer>この画面はプログラムを書き換えません。Bluetoothで、自分が選んだNanoC6だけに操作を送ります。</footer>
  </div>
}
