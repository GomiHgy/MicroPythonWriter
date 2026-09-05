import { useEffect, useState } from 'react'
import { CodeEditor } from './components/CodeEditor'
import { Terminal } from './components/Terminal'
import { hasSensitiveAssignments } from './services/prompt/RepairPromptBuilder'
import { useProgrammer } from './hooks/useProgrammer'
import './App.css'

const statusCopy: Record<string, { icon: string; eyebrow: string; title: string; description: string; tone: 'ready' | 'running' | 'waiting' | 'warning' | 'error' }> = {
  unsupported: { icon: '!', eyebrow: '使えない状態', title: 'このブラウザでは使えません', description: 'パソコン版ChromeまたはEdgeで開いてください。', tone: 'error' },
  disconnected: { icon: '1', eyebrow: 'はじめに', title: 'NanoC6をUSBでつなごう', description: '下の「USBをつなぐ」を押して、NanoC6を選んでください。', tone: 'waiting' },
  'connection-lost': { icon: '!', eyebrow: '接続が切れました', title: 'NanoC6との通信が止まりました', description: 'ケーブルと電源を確認して、もう一度つなぎましょう。', tone: 'warning' },
  'raw-repl-ready': { icon: '✓', eyebrow: '準備OK', title: 'プログラムを試せます', description: '編集したら「実行」を押すだけです。', tone: 'ready' },
  stopped: { icon: '✓', eyebrow: '停止しました', title: '次のプログラムを試せます', description: '編集してから「実行」を押してください。', tone: 'ready' },
  running: { icon: '▶', eyebrow: '実行中', title: 'プログラムが動いています', description: '止めるときは「停止」。もう一度実行すると、今の動作を止めてから始めます。', tone: 'running' },
  'running-no-marker': { icon: '▶', eyebrow: '実行中', title: 'プログラムが動いています', description: '起動メッセージは見つかりませんでしたが、実行中として扱っています。', tone: 'running' },
  error: { icon: '!', eyebrow: '確認が必要', title: 'エラーが見つかりました', description: '画面右の「困ったとき」を見て、表示された行を確認してください。', tone: 'error' },
}

const defaultStatus = { icon: '…', eyebrow: 'NanoC6を準備中', title: '少し待ってください', description: 'ケーブルはそのままで、処理が終わるまで待ってください。', tone: 'waiting' as const }

export default function App() {
  const app = useProgrammer()
  const [dark, setDark] = useState(() => localStorage.getItem('mpw-theme') !== 'light')
  const [wrap, setWrap] = useState(() => localStorage.getItem('mpw-wrap') !== 'false')
  const [autoScroll, setAutoScroll] = useState(() => localStorage.getItem('mpw-autoscroll') !== 'false')
  const [timestamps, setTimestamps] = useState(false)
  const [copyNotice, setCopyNotice] = useState<{ text: string; failed: boolean }>()
  const ready = app.state === 'raw-repl-ready' || app.state === 'stopped'
  const running = app.state === 'running' || app.state === 'running-no-marker' || app.state === 'starting'
  const canModifyProgram = ready || running
  const busy = !['raw-repl-ready', 'stopped', 'disconnected', 'connection-lost', 'error', 'unsupported', 'running', 'running-no-marker'].includes(app.state)
  const connected = !['disconnected', 'connection-lost', 'unsupported'].includes(app.state)
  const status = statusCopy[app.state] ?? defaultStatus
  const bootSummary = app.info.bootOption === 0 ? '電源を入れたら自動で実行' : app.info.bootOption === 1 ? '電源を入れても自動では実行しない' : 'まだ確認できていません'
  const runDescription = running ? '今動いているプログラムを止めて、編集内容を実行します。' : '編集内容をNanoC6へ保存して、すぐに試します。'

  useEffect(() => {
    localStorage.setItem('mpw-theme', dark ? 'dark' : 'light')
    localStorage.setItem('mpw-wrap', String(wrap))
    localStorage.setItem('mpw-autoscroll', String(autoScroll))
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark, wrap, autoScroll])

  useEffect(() => {
    if (!copyNotice) return
    const timer = window.setTimeout(() => setCopyNotice(undefined), 4000)
    return () => window.clearTimeout(timer)
  }, [copyNotice])

  const copyPrompt = async () => {
    if (!app.error) return
    if (hasSensitiveAssignments(app.source) && !confirm('プログラムにpassword、token、SSIDなどの情報らしき文字があります。内容を確認してコピーしますか？')) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('コピー機能はHTTPSまたはlocalhostでのみ使えます。')
      await navigator.clipboard.writeText(app.error.repairPrompt)
      setCopyNotice({ text: '✓ AI修正依頼プロンプトをコピーしました。', failed: false })
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'クリップボードへの書込みが許可されませんでした。'
      setCopyNotice({ text: `コピーに失敗しました: ${message}`, failed: true })
    }
  }

  const stampLog = () => timestamps ? app.log.split(/(?<=\n)/).map(line => `[${new Date().toLocaleTimeString()}] ${line}`).join('') : app.log

  return <main className="app">
    <header className="hero">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⚡</span><div><p className="eyebrow">M5Stack NanoC6</p><h1>プログラム かんたん操作</h1><p>USBでつないで、書いたプログラムをすぐ試せます。</p></div></div>
      <button className="theme-button" onClick={() => setDark(value => !value)} aria-label={dark ? 'ライト表示に切り替え' : 'ダーク表示に切り替え'}>{dark ? '☀ 明るくする' : '🌙 暗くする'}</button>
    </header>

    {!app.supported && <div className="notice danger" role="alert">このブラウザではUSB接続機能を使えません。パソコン版ChromeまたはEdgeで開いてください。</div>}

    <section className={`device-card ${status.tone}`} aria-live="polite">
      <div className="status-badge" aria-hidden="true">{status.icon}</div>
      <div className="device-copy"><p className="eyebrow">{status.eyebrow}</p><h2>{status.title}</h2><p>{status.description}</p></div>
      <div className="device-actions">
        <button className="connect-button" disabled={!app.supported || busy || (app.state !== 'disconnected' && app.state !== 'connection-lost')} onClick={app.connect}>🔌 USBをつなぐ</button>
        {connected && <button className="quiet-button" onClick={app.disconnect}>接続を切る</button>}
      </div>
      <details className="device-details"><summary>機器と通信のくわしい情報</summary><div className="device-details-grid"><dl><dt>つながっている機器</dt><dd>{app.info.deviceName}</dd><dt>電源を入れた時の動き</dt><dd>{bootSummary}</dd><dt>MicroPython</dt><dd>{app.info.microPythonVersion}</dd></dl><label className="baud-rate">通信速度 <input type="number" value={app.baudRate} min="1200" onChange={event => app.setBaudRate(Number(event.target.value))} /> bps</label></div></details>
    </section>

    {app.state === 'connection-lost' && <section className="disconnect-screen" role="alert"><h2>USB接続が切断されました</h2><p>ケーブルとNanoC6の電源を確認してから、もう一度つないでください。</p><div><button onClick={app.reconnect}>↻ もう一度つなぐ</button><button className="quiet-button" onClick={app.connect}>USBを選び直す</button></div><small>うまくいかないときは、数秒待ってから「USBを選び直す」を押してください。</small></section>}

    <section className="steps" aria-label="使い方">
      <div className={`step ${app.state === 'disconnected' || app.state === 'connection-lost' ? 'active' : 'done'}`}><span>1</span><div><strong>つなぐ</strong><small>NanoC6をUSBでつなぐ</small></div></div>
      <div className={`step ${ready || running ? 'active' : ''}`}><span>2</span><div><strong>書く</strong><small>下のプログラムを編集する</small></div></div>
      <div className={`step ${running ? 'active' : ''}`}><span>3</span><div><strong>試す</strong><small>「実行」で動きを確認する</small></div></div>
    </section>

    {app.info.deviceName !== '未接続' && !app.info.nanoC6Confirmed && <div className="notice warn">NanoC6としては確認できませんでした。一般的なMicroPython機器として操作します。</div>}

    {connected && <section className="action-card"><div className="section-heading"><div><p className="eyebrow">プログラムを試す</p><h2>まずは「実行」を押そう</h2><p>実行すると、編集内容をNanoC6へ保存してから動かします。</p></div>{running && <button className="stop-button" onClick={app.stop}>■ 停止</button>}</div><div className="main-actions"><button className="run-button" disabled={!canModifyProgram} onClick={app.run}><span>▶ 実行</span><small>{runDescription}</small></button><button className="update-button" disabled={!canModifyProgram} onClick={app.write}><span>プログラム更新</span><small>保存だけ。今は動かしません。</small></button><button className="load-button" disabled={!ready} onClick={app.load}>保存済みのプログラムを読む</button></div><p className="action-tip">迷ったら <strong>実行</strong>。電源を切っても残すだけなら <strong>プログラム更新</strong> を使ってください。</p></section>}

    {connected && <details className="advanced-card"><summary><span>⚙</span><div><strong>電源を入れた時の動きを変える</strong><small>NanoC6本体に保存される設定です</small></div></summary><div className="advanced-body"><p>今の設定: <strong>{bootSummary}</strong></p><div className="boot-actions"><button disabled={!ready} onClick={() => app.setBoot(0)}>電源を入れたら自動で実行する</button><button className="quiet-button" disabled={!ready} onClick={() => app.setBoot(1)}>電源を入れても自動実行しない</button></div><p className="advanced-note">設定を変えるとNanoC6は再起動し、USB接続は一度切れます。再起動後は、もう一度「USBをつなぐ」を押してください。</p><div className="secondary-actions"><button className="quiet-button" disabled={busy || app.state === 'disconnected' || app.state === 'connection-lost'} onClick={app.normalMode}>通常動作に戻す</button><button className="quiet-button" disabled={!ready} onClick={app.reset}>↻ NanoC6を再起動</button></div></div></details>}

    <section className="workspace"><div className="panel program-panel"><div className="panel-head"><div><p className="eyebrow">プログラム</p><h2>LEDやボタンの動きを書く場所</h2><p>ここを書き換えて、上の「実行」で試します。</p></div><label className="wrap-toggle"><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} /> 長い行を折り返す</label></div><CodeEditor value={app.source} onChange={app.setSource} dark={dark} wrap={wrap} errorLine={app.error?.line} onSave={app.write} onRun={app.run} /><p className="shortcut-note">ショートカット: <kbd>Ctrl</kbd> + <kbd>S</kbd> でプログラム更新、<kbd>Ctrl</kbd> + <kbd>Enter</kbd> で実行</p></div><aside className="right"><div className="panel terminal-panel"><div className="panel-head"><div><p className="eyebrow">見守りログ</p><h2>うまくいかない時に見る記録</h2></div><span><label><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} /> 自動スクロール</label><label><input type="checkbox" checked={timestamps} onChange={event => setTimestamps(event.target.checked)} /> 時刻</label><button className="quiet-button" onClick={() => app.setLog('')}>消去</button></span></div><Terminal log={stampLog()} dark={dark} autoScroll={autoScroll} /></div>{app.error && <section className="panel error" aria-live="assertive"><p className="eyebrow">困ったとき</p><h2>⚠ {app.error.exceptionType}</h2><p>{app.error.message}</p><dl><dt>起きた場所</dt><dd>{app.error.stage}</dd><dt>確認する行</dt><dd>{app.error.line ?? '見つけられませんでした'} {app.error.codeLine && `: ${app.error.codeLine}`}</dd></dl><pre>{app.error.traceback}</pre><button onClick={copyPrompt}>AIに相談する文章をコピー</button>{copyNotice && <p className={`copy-notice${copyNotice.failed ? ' failed' : ''}`} role="status">{copyNotice.text}</p>}</section>}</aside></section>

    <footer>このページはコードとログを外部へ送信しません。実機の動きを確認できた時だけ、「電源を入れたら自動で実行する」を使ってください。</footer>
  </main>
}
