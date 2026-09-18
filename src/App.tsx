import { useEffect, useState } from 'react'
import { CodeEditor } from './components/CodeEditor'
import { Terminal } from './components/Terminal'
import { BluetoothPanel } from './components/BluetoothPanel'
import { AiPreparationPanel } from './components/AiPreparationPanel'
import { hasSensitiveAssignments } from './services/prompt/RepairPromptBuilder'
import { useProgrammer } from './hooks/useProgrammer'
import { useWorkshopPreparation } from './hooks/useWorkshopPreparation'
import { isLocale, useLocale } from './i18n'
import './App.css'

const statusCopy: Record<string, { icon: string; eyebrow: string; title: string; description: string; tone: 'ready' | 'running' | 'waiting' | 'warning' | 'error' }> = {
  stopping: { icon: '…', eyebrow: '停止を確認中', title: '今のプログラムを止めています', description: '実行・更新を押した場合は、停止後に自動で続けます。ケーブルを抜かずに待ってください。', tone: 'waiting' },
  unsupported: { icon: '!', eyebrow: '使えない状態', title: 'このブラウザでは使えません', description: 'パソコン版ChromeまたはEdgeで開いてください。', tone: 'error' },
  disconnected: { icon: '1', eyebrow: 'はじめに', title: '機器をUSBでつなごう', description: '下の「USBをつなぐ」を押して、M5NanoC6またはAtomS3Liteを選んでください。', tone: 'waiting' },
  'connection-lost': { icon: '!', eyebrow: '接続が切れました', title: '機器との通信が止まりました', description: 'ケーブルと電源を確認して、もう一度つなぎましょう。', tone: 'warning' },
  'raw-repl-ready': { icon: '✓', eyebrow: '準備OK', title: 'プログラムを試せます', description: '編集したら「実行」を押すだけです。', tone: 'ready' },
  stopped: { icon: '✓', eyebrow: '停止しました', title: '次のプログラムを試せます', description: '編集してから「実行」を押してください。', tone: 'ready' },
  running: { icon: '▶', eyebrow: '実行中', title: 'プログラムが動いています', description: '止めるときは「停止」。もう一度実行すると、今の動作を止めてから始めます。', tone: 'running' },
  'running-no-marker': { icon: '▶', eyebrow: '実行中', title: 'プログラムが動いています', description: '起動メッセージは見つかりませんでしたが、実行中として扱っています。', tone: 'running' },
  error: { icon: '!', eyebrow: '確認が必要', title: 'エラーが見つかりました', description: '画面右の「困ったとき」を見て、表示された行を確認してください。', tone: 'error' },
}

const defaultStatus = { icon: '…', eyebrow: '機器を準備中', title: '少し待ってください', description: 'ケーブルはそのままで、処理が終わるまで待ってください。', tone: 'waiting' as const }
const tabs = [{ id: 'preparation', label: 'AIの準備', icon: '✦' }, { id: 'program', label: 'プログラム', icon: '✎' }, { id: 'controller', label: 'コントローラ', icon: '🎛' }] as const
const readPreference = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }

export default function App() {
  const { locale, t, setLocale } = useLocale()
  const preparation = useWorkshopPreparation()
  const app = useProgrammer(preparation.context)
  const [activeTab, setActiveTab] = useState<typeof tabs[number]['id']>('program')
  const [dark, setDark] = useState(() => readPreference('mpw-theme') !== 'light')
  const [wrap, setWrap] = useState(() => readPreference('mpw-wrap') !== 'false')
  const [autoScroll, setAutoScroll] = useState(() => readPreference('mpw-autoscroll') !== 'false')
  const [timestamps, setTimestamps] = useState(false)
  const [copyNotice, setCopyNotice] = useState<{ text: string; failed: boolean; detail?: string }>()
  const ready = app.state === 'raw-repl-ready' || app.state === 'stopped'
  const running = app.state === 'running' || app.state === 'running-no-marker'
  const canModifyProgram = ready || running
  const busy = !['raw-repl-ready', 'stopped', 'disconnected', 'connection-lost', 'error', 'unsupported', 'running', 'running-no-marker'].includes(app.state)
  const connected = !['disconnected', 'connection-lost', 'unsupported'].includes(app.state)
  const status = statusCopy[app.state] ?? defaultStatus
  const bootSummary = app.info.bootOption === 0 ? '電源を入れたら自動で実行' : app.info.bootOption === 1 ? '電源を入れても自動では実行しない' : 'まだ確認できていません'
  const runDescription = running ? '今動いているプログラムを止めて、編集内容を実行します。' : '編集内容を機器へ保存して、すぐに試します。'

  useEffect(() => {
    try {
      localStorage.setItem('mpw-theme', dark ? 'dark' : 'light')
      localStorage.setItem('mpw-wrap', String(wrap))
      localStorage.setItem('mpw-autoscroll', String(autoScroll))
    } catch { /* 保存できない環境でも表示と操作は続ける */ }
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark, wrap, autoScroll])

  useEffect(() => {
    if (!copyNotice) return
    const timer = window.setTimeout(() => setCopyNotice(undefined), 4000)
    return () => window.clearTimeout(timer)
  }, [copyNotice])

  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale; document.title = 'M5NanoC6 / AtomS3Lite — MicroPython Writer' }, [locale])

  const copyPrompt = async () => {
    if (!app.error) return
    if (hasSensitiveAssignments(app.error.repairPrompt) && !confirm(t('修正依頼のコード・設定・ログにpassword、token、SSIDなどの情報らしき文字があります。内容を確認してコピーしますか？検出は補助で、すべての秘密情報を見つけられるわけではありません。'))) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('コピー機能はHTTPSまたはlocalhostでのみ使えます。')
      await navigator.clipboard.writeText(app.error.repairPrompt)
      setCopyNotice({ text: '✓ AI修正依頼プロンプトをコピーしました。', failed: false })
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'クリップボードへの書込みが許可されませんでした。'
      setCopyNotice({ text: 'コピーに失敗しました: {message}', detail: message, failed: true })
    }
  }

  const stampLog = () => timestamps ? app.log.split(/(?<=\n)/).map(line => `[${new Date().toLocaleTimeString()}] ${line}`).join('') : app.log

  return <main className="app">
    <header className="hero">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⚡</span><div><p className="eyebrow">M5NanoC6 / AtomS3Lite</p><h1>{t("AIとフルカラーLED電飾をはじめよう")}</h1><p>{t(activeTab === 'program' ? 'USBでつないで、書いたプログラムをすぐ試せます。' : activeTab === 'preparation' ? '好きなAIと、光り方のアイデアを相談しよう。' : 'Bluetoothでつないで、光り方を手元で変えられます。')}</p></div></div>
      <button className="theme-button" onClick={() => setDark(value => !value)} aria-label={t(dark ? 'ライト表示に切り替え' : 'ダーク表示に切り替え')}>{t(dark ? '☀ 明るくする' : '🌙 暗くする')}</button>
      <label className="language-picker"><span>{t("表示言語")}</span><select aria-label={t("表示言語")} value={locale} onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value) }}><option value="ja">日本語</option><option value="en">English</option><option value="zh">简体中文</option></select></label>
    </header>

    <div className="app-tabs" role="tablist" aria-label={t("使いたい機能")} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = tabs.findIndex(tab => tab.id === activeTab)
      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length].id
      setActiveTab(next)
      document.getElementById(`tab-${next}`)?.focus()
    }}>
      {tabs.map(tab => <button key={tab.id} id={`tab-${tab.id}`} role="tab" aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)}><span aria-hidden="true">{tab.icon}</span> {t(tab.label)}</button>)}
    </div>

    <div id="panel-preparation" role="tabpanel" aria-labelledby="tab-preparation" hidden={activeTab !== 'preparation'}>
      <AiPreparationPanel preparation={preparation} onOpenProgram={() => { setActiveTab('program'); document.getElementById('tab-program')?.focus() }} />
    </div>

    <div id="panel-program" role="tabpanel" aria-labelledby="tab-program" hidden={activeTab !== 'program'}>
    {!app.supported && <div className="notice danger" role="alert">{t("このブラウザではUSB接続機能を使えません。パソコン版ChromeまたはEdgeで開いてください。")}</div>}

    <section className={`device-card ${status.tone}`} aria-live="polite">
      <div className="status-badge" aria-hidden="true">{status.icon}</div>
      <div className="device-copy"><p className="eyebrow">{t(status.eyebrow)}</p><h2>{t(status.title)}</h2><p>{t(status.description)}</p></div>
      <div className="device-actions">
        <button className="connect-button" disabled={!app.supported || busy || (app.state !== 'disconnected' && app.state !== 'connection-lost')} onClick={app.connect}>{t("🔌 USBをつなぐ")}</button>
        {connected && <button className="quiet-button" onClick={app.disconnect}>{t("接続を切る")}</button>}
      </div>
      <details className="device-details"><summary>{t("機器と通信のくわしい情報")}</summary><div className="device-details-grid"><dl><dt>{t("つながっている機器")}</dt><dd>{t(app.info.deviceName)}</dd><dt>{t("電源を入れた時の動き")}</dt><dd>{t(bootSummary)}</dd><dt>MicroPython</dt><dd>{t(app.info.microPythonVersion)}</dd></dl><label className="baud-rate">{t("通信速度")}<input type="number" value={app.baudRate} min="1200" onChange={event => app.setBaudRate(Number(event.target.value))} /> bps</label></div></details>
    </section>

    {app.state === 'connection-lost' && <section className="disconnect-screen" role="alert"><h2>{t("USB接続が切断されました")}</h2><p>{t("ケーブルと機器の電源を確認してから、もう一度つないでください。")}</p><div><button onClick={app.reconnect}>{t("↻ もう一度つなぐ")}</button><button className="quiet-button" onClick={app.connect}>{t("USBを選び直す")}</button></div><small>{t("うまくいかないときは、数秒待ってから「USBを選び直す」を押してください。")}</small></section>}

    <section className="steps" aria-label={t("使い方")}>
      <div className={`step ${app.state === 'disconnected' || app.state === 'connection-lost' ? 'active' : 'done'}`}><span>1</span><div><strong>{t("つなぐ")}</strong><small>{t("機器をUSBでつなぐ")}</small></div></div>
      <div className={`step ${ready || running ? 'active' : ''}`}><span>2</span><div><strong>{t("書く")}</strong><small>{t("下のプログラムを編集する")}</small></div></div>
      <div className={`step ${running ? 'active' : ''}`}><span>3</span><div><strong>{t("試す")}</strong><small>{t("「実行」で動きを確認する")}</small></div></div>
    </section>

    {app.info.deviceName !== '未接続' && !(app.info.boardConfirmed || app.info.nanoC6Confirmed) && <div className="notice warn">{t("M5NanoC6／AtomS3Liteとしては確認できませんでした。一般的なMicroPython機器として操作します。")}</div>}

    {connected && <section className="action-card"><div className="section-heading"><div><p className="eyebrow">{t("プログラムを試す")}</p><h2>{t("まずは「実行」を押そう")}</h2><p>{t("実行すると、編集内容を機器へ保存してから動かします。")}</p></div>{running && <button className="stop-button" onClick={app.stop}>{t("■ 停止")}</button>}</div><div className="main-actions"><button className="run-button" disabled={!canModifyProgram} onClick={app.run}><span>{t("▶ 実行")}</span><small>{t(runDescription)}</small></button><button className="update-button" disabled={!canModifyProgram} onClick={app.write}><span>{t("プログラム更新")}</span><small>{t("保存だけ。今は動かしません。")}</small></button><button className="load-button" disabled={!ready} onClick={app.load}>{t("保存済みのプログラムを読む")}</button></div><p className="action-tip">{t("迷ったら「実行」。保存だけなら「プログラム更新」を使ってください。")}</p></section>}

    {connected && <details className="advanced-card"><summary><span>⚙</span><div><strong>{t("電源を入れた時の動きを変える")}</strong><small>{t("機器本体に保存される設定です")}</small></div></summary><div className="advanced-body"><p>{t("今の設定:")}<strong>{t(bootSummary)}</strong></p><div className="boot-actions"><button disabled={!ready} onClick={() => app.setBoot(0)}>{t("電源を入れたら自動で実行する")}</button><button className="quiet-button" disabled={!ready} onClick={() => app.setBoot(1)}>{t("電源を入れても自動実行しない")}</button></div><p className="advanced-note">{t("設定を変えると機器は再起動し、USB接続は一度切れます。再起動後は、もう一度「USBをつなぐ」を押してください。")}</p><div className="secondary-actions"><button className="quiet-button" disabled={busy || app.state === 'disconnected' || app.state === 'connection-lost'} onClick={app.normalMode}>{t("通常動作に戻す")}</button><button className="quiet-button" disabled={!ready} onClick={app.reset}>{t("↻ 機器を再起動")}</button></div></div></details>}

    <section className="workspace"><div className="panel program-panel"><div className="panel-head"><div><p className="eyebrow">{t("プログラム")}</p><h2>{t("LEDやボタンの動きを書く場所")}</h2><p>{t("ここを書き換えて、上の「実行」で試します。")}</p></div><label className="wrap-toggle"><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} />{t("長い行を折り返す")}</label></div><CodeEditor label={t("Pythonコードエディタ")} value={app.source} onChange={app.setSource} dark={dark} wrap={wrap} errorLine={app.error?.sourceKnown !== false && (app.error?.sourceSnapshot === undefined || app.error.sourceSnapshot === app.source) ? app.error?.line : undefined} onSave={app.write} onRun={app.run} /><p className="shortcut-note">{t("ショートカット: Ctrl+Sでプログラム更新、Ctrl+Enterで実行")}</p></div><aside className="right"><div className="panel terminal-panel"><div className="panel-head"><div><p className="eyebrow">{t("見守りログ")}</p><h2>{t("うまくいかない時に見る記録")}</h2></div><span><label><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} />{t("自動スクロール")}</label><label><input type="checkbox" checked={timestamps} onChange={event => setTimestamps(event.target.checked)} />{t("時刻")}</label><button className="quiet-button" onClick={() => app.setLog('')}>{t("消去")}</button></span></div><Terminal label={t("シリアルターミナル")} log={stampLog()} dark={dark} autoScroll={autoScroll} /></div>{app.error && <section className="panel error" aria-live="assertive"><p className="eyebrow">{t("困ったとき")}</p><h2>⚠ {app.error.exceptionType}</h2><p>{t(app.error.message)}</p><dl><dt>{t("起きた場所")}</dt><dd>{t(app.error.stage)}</dd><dt>{t("確認する行")}</dt><dd>{app.error.line ?? t('見つけられませんでした')} {app.error.codeLine && `: ${app.error.codeLine}`}</dd></dl><pre>{app.error.traceback}</pre>{app.error.sourceKnown === false && <p>{t("機器上の実行コードは未取得です。編集中のコードと同じとは確認できていません。")}</p>}{app.error.sourceKnown !== false && app.error.sourceSnapshot !== undefined && app.error.sourceSnapshot !== app.source && <p>{t("編集内容はエラー発生時から変わっています。AIへの修正依頼には、エラーが起きた時のコードを入れます。")}</p>}<button onClick={copyPrompt}>{t("AIに相談する文章をコピー")}</button>{copyNotice && <p className={`copy-notice${copyNotice.failed ? ' failed' : ''}`} role="status">{t(copyNotice.text, { message: t(copyNotice.detail ?? '') })}</p>}</section>}</aside></section>

    <footer>{t("このページはコードとログを外部へ送信しません。実機の動きを確認できた時だけ、「電源を入れたら自動で実行する」を使ってください。")}</footer>
    </div>
    <div id="panel-controller" role="tabpanel" aria-labelledby="tab-controller" hidden={activeTab !== 'controller'}>
      <BluetoothPanel onOpenProgram={() => { setActiveTab('program'); document.getElementById('tab-program')?.focus() }} />
    </div>
    <footer className="app-version" aria-label={t('アプリのバージョン情報')}>
      <span>MicroPython Writer · {t('バージョン')} <code>{__APP_BUILD__.revision ?? t('取得できませんでした')}</code></span>
      {__APP_BUILD__.dirty === true && <span>{t('未コミットの変更あり')}</span>}
      {__APP_BUILD__.revision !== null && __APP_BUILD__.dirty === null && <span>{t('変更状態は未確認')}</span>}
      {import.meta.env.DEV && <span>{t('開発版')}</span>}
      <span>{t('生成日時')} <time dateTime={__APP_BUILD__.builtAt}>{__APP_BUILD__.builtAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}</time></span>
    </footer>
  </main>
}
