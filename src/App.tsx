import { useEffect, useRef, useState } from 'react'
import { CodeEditor } from './components/CodeEditor'
import { Terminal } from './components/Terminal'
import { BluetoothPanel } from './components/BluetoothPanel'
import { AiPreparationPanel } from './components/AiPreparationPanel'
import { MakerPanel } from './components/MakerPanel'
import { loadProject, saveProject, saveProjectDraft, validateProject, serializeProject, parseProject, markWorking, restoreWorking } from './services/projects/ProjectStorage'
import type { ArtworkProject, ProjectSnapshot, RemoteButton } from './services/projects/types'
import { buildStarterProgram, starterAvailability } from './services/projects/StarterProgram'
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
const tabs = [{ id: 'maker', label: '作品づくり', icon: '💡' }, { id: 'preparation', label: 'AIの準備', icon: '✦' }, { id: 'program', label: 'プログラム', icon: '✎' }, { id: 'controller', label: 'コントローラ', icon: '🎛' }] as const
const readPreference = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }

export default function App() {
  const { locale, t, setLocale } = useLocale()
  const [loadedProject] = useState(loadProject)
  const [projectData, setProjectData] = useState(loadedProject.project)
  const [projectSettingsActive, setProjectSettingsActive] = useState(() => readPreference('mpw-project-settings-active') === 'true')
  const [projectNotice, setProjectNotice] = useState(loadedProject.notice)
  const [loadNeedsReview, setLoadNeedsReview] = useState(() => loadedProject.notice !== '')
  const [lastRunDraft, setLastRunDraft] = useState<ProjectSnapshot | null>(null)
  const [standaloneDraft, setStandaloneDraft] = useState<ProjectSnapshot | null>(null)
  const [canUndoReplacement, setCanUndoReplacement] = useState(() => readPreference('mpw-artwork-before-replace-v1') !== null)
  const preparation = useWorkshopPreparation()
  // 有効な作品を復元した後は、別キーの保存漏れでも古いAI設定を混ぜない。
  const allowLegacyContext = !projectSettingsActive && !loadedProject.sourceAuthoritative
  const matchingPreparation = allowLegacyContext || (preparation.context && Object.entries(projectData.draft.settings).every(([key, value]) => preparation.context!.profile[key as keyof typeof preparation.context.profile] === value))
  const app = useProgrammer(matchingPreparation ? preparation.context : null, loadedProject.sourceAuthoritative ? loadedProject.project.draft.source : loadedProject.project.draft.source || undefined, loadedProject.sourceAuthoritative)
  const project: ArtworkProject = { ...projectData, draft: { ...projectData.draft, source: app.source } }
  const latestProject = useRef(project)
  const importGeneration = useRef(0)
  useEffect(() => { latestProject.current = project })
  useEffect(() => {
    if (loadNeedsReview) return
    const failure = saveProjectDraft({ ...projectData, draft: { ...projectData.draft, source: app.source } })
    if (failure) {
      const timer = window.setTimeout(() => setProjectNotice(failure), 0)
      return () => window.clearTimeout(timer)
    }
  }, [projectData, app.source, loadNeedsReview])
  useEffect(() => { try { localStorage.setItem('mpw-project-settings-active', String(projectSettingsActive)) } catch { /* 文脈を永続化できなくても通信は行わない */ } }, [projectSettingsActive])
  const [activeTab, setActiveTab] = useState<typeof tabs[number]['id']>(() => tabs.find(tab => tab.id === readPreference('mpw-active-tab'))?.id ?? (readPreference('mpw-source') === null ? 'maker' : 'program'))
  useEffect(() => { try { localStorage.setItem('mpw-active-tab', activeTab) } catch { /* タブは保存不可でも切り替えられる */ } }, [activeTab])
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
  const availability = starterAvailability(project.draft.settings, project.draft.recipe)
  let generatedSource = ''
  try { generatedSource = buildStarterProgram(project.draft.settings, project.draft.recipe) } catch { /* 未入力・不正な設定では生成しない */ }
  const sourceMatches = Boolean(generatedSource) && generatedSource === app.source
  const currentMatchesRun = lastRunDraft !== null && JSON.stringify(lastRunDraft) === JSON.stringify(project.draft)
  const boardMatches = !app.info.boardId || app.info.boardId === project.draft.settings.boardId
  const canMarkWorking = running && app.runningSource === app.source && currentMatchesRun && boardMatches
  const canFinish = ready && boardMatches && app.writtenSource === app.source && !!project.working && JSON.stringify(project.working.snapshot) === JSON.stringify(project.draft) && (app.info.bootOptionSupported || app.info.nvsFallbackSupported)
  const canConfirmStandalone = app.bootConfigured?.mode === 0 && app.bootConfigured.source === app.source && standaloneDraft !== null && JSON.stringify(standaloneDraft) === JSON.stringify(project.draft)
  const openTab = (tab: typeof tabs[number]['id']) => { setActiveTab(tab); document.getElementById(`tab-${tab}`)?.focus() }
  const reportProjectError = (error: unknown) => setProjectNotice(error instanceof Error ? error.message : '作品を処理できませんでした。元の内容は変更していません。')
  const changeProject = (next: ArtworkProject) => {
    try { setProjectData(validateProject({ ...next, draft: { ...next.draft, source: app.source } })); setProjectSettingsActive(true); setProjectNotice('編集中です。「作品を保存」でこのブラウザに保存できます。') } catch (error) { reportProjectError(error) }
  }
  const persistProject = (next = project) => {
    if (loadNeedsReview) {
      if (!confirm(t('読み込めなかった保存済み作品があります。元データを退避して、今の作品で保存し直しますか？'))) return false
      try {
        const original = localStorage.getItem('mpw-artwork-project-v1')
        if (original !== null) localStorage.setItem('mpw-artwork-unreadable-backup-v1', original)
        const originalDraft = localStorage.getItem('mpw-artwork-draft-v1')
        if (originalDraft !== null) localStorage.setItem('mpw-artwork-draft-unreadable-backup-v1', originalDraft)
      } catch { setProjectNotice('元データを退避できないため保存を中止しました。作品ファイルへ書き出してください。'); return false }
    }
    const stamped = { ...next, updatedAt: new Date().toISOString() }
    const failure = saveProject(stamped)
    setProjectNotice(failure || '作品をこのブラウザに保存しました。大切な作品はファイルにも書き出してください。')
    if (!failure) { setProjectData(stamped); setLoadNeedsReview(false) }
    return !failure
  }
  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = name; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const exportProject = () => {
    try {
      const content = serializeProject(project)
      if (hasSensitiveAssignments(content) && !confirm(t('作品ファイルにはコードと設定が含まれます。秘密情報がないか確認して書き出しますか？'))) return
      download(`${project.name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 64) || 'artwork'}.mpw.json`, content, 'application/json')
      setProjectNotice('作品ファイルを書き出しました。ファイルにはコードと設定が含まれます。')
    } catch (error) { reportProjectError(error) }
  }
  const replaceProject = (next: ArtworkProject) => {
    // 上書き前の回復点を必ず確保する。保存不可なら読み込み・復元を中止する。
    try {
      const checked = validateProject(next)
      if (loadNeedsReview) {
        const original = localStorage.getItem('mpw-artwork-project-v1')
        if (original !== null) localStorage.setItem('mpw-artwork-unreadable-backup-v1', original)
        const originalDraft = localStorage.getItem('mpw-artwork-draft-v1')
        if (originalDraft !== null) localStorage.setItem('mpw-artwork-draft-unreadable-backup-v1', originalDraft)
      }
      localStorage.setItem('mpw-artwork-before-replace-v1', serializeProject(latestProject.current))
      const failure = saveProjectDraft(checked)
      if (failure) throw new Error(failure)
      importGeneration.current++
      setCanUndoReplacement(true)
      setLoadNeedsReview(false)
      setProjectData(checked); app.setSource(checked.draft.source); setLastRunDraft(null)
      setProjectSettingsActive(true)
      setProjectNotice('編集画面に読み込みました。機器には送っていません。「作品を保存」で確定できます。')
      return true
    } catch (error) { reportProjectError(error); return false }
  }
  const importProject = async (file: File) => {
    const generation = ++importGeneration.current
    try {
      if (file.size > 1_000_000 || !/\.json$/i.test(file.name)) throw new Error('1MB以内の作品JSONファイルを選んでください。')
      const next = parseProject(await file.text())
      if (generation !== importGeneration.current) return
      if (!confirm(t('作品を読み込み、編集中の内容を置き換えます。現在の内容は一時退避します。機器への書き込みは行いません。'))) return
      if (replaceProject(next)) setProjectNotice('作品を読み込みました。持ち込まれた動作OK記録は引き継がず、この機器での確認を待ちます。機器には送っていません。')
    } catch (error) { if (generation === importGeneration.current) reportProjectError(error) }
  }
  const restoreProject = () => {
    if (!project.working || !confirm(t('動作OK版へ編集内容と機器設定を戻します。現在の編集は一時退避します。機器には自動送信しません。'))) return
    try { replaceProject(restoreWorking(project)) } catch (error) { reportProjectError(error) }
  }
  const undoReplacement = () => {
    try {
      const raw = readPreference('mpw-artwork-before-replace-v1')
      if (!raw) return
      const previous = validateProject(JSON.parse(raw))
      if (!confirm(t('直前の読み込み・復元前へ戻します。機器には送信しません。'))) return
      replaceProject(previous)
    } catch (error) { reportProjectError(error) }
  }
  const runProject = () => {
    if (!canModifyProgram) return
    setLastRunDraft(structuredClone(project.draft))
    return app.run()
  }
  const markProjectWorking = () => {
    if (!canMarkWorking || !confirm(t('今のコード・機器設定で、実際のLEDとボタンの動きを確認しましたか？無線を使う場合はリモコンも確認してください。実行開始だけでは動作OKにしません。'))) return
    try { persistProject(markWorking(project)) } catch (error) { reportProjectError(error) }
  }
  const prepareStarter = () => {
    if (!availability.verified || !generatedSource) { setProjectNotice(availability.reason); return }
    if (app.source.trim() && !sourceMatches && !confirm(t('入門プログラムを編集画面に準備します。現在のコードは一時退避します。機器にはまだ送りません。'))) return
    replaceProject({ ...project, draft: { ...project.draft, source: generatedSource } })
  }
  const downloadCandidate = () => {
    if (!generatedSource) { setProjectNotice(availability.reason); return }
    try {
      download('main-unverified.py', generatedSource, 'text/x-python')
      setProjectNotice('提供側の実機検証用コードを書き出しました。動作保証・検証済みの登録・機器への送信は行っていません。')
    } catch (error) { reportProjectError(error) }
  }
  const finishProject = () => {
    if (!canFinish) return
    setStandaloneDraft(structuredClone(project.draft))
    return app.setBoot(0)
  }
  const saveRemoteButtons = (remoteButtons: RemoteButton[]) => {
    try { persistProject(validateProject({ ...project, draft: { ...project.draft, remoteButtons } })) } catch (error) { reportProjectError(error) }
  }

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
      <div className="brand"><img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} width={48} height={48} alt="" aria-hidden="true" /><div><p className="eyebrow">M5NanoC6 / AtomS3Lite</p><h1>{t("AIとフルカラーLED電飾をはじめよう")}</h1><p>{t(activeTab === 'maker' ? '機器を選んで、光る作品をひとつずつ作ろう。' : activeTab === 'program' ? 'USBでつないで、書いたプログラムをすぐ試せます。' : activeTab === 'preparation' ? '好きなAIと、光り方のアイデアを相談しよう。' : 'Bluetoothでつないで、光り方を手元で変えられます。')}</p></div></div>
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

    <div id="panel-maker" role="tabpanel" aria-labelledby="tab-maker" hidden={activeTab !== 'maker'}>
      <MakerPanel project={project} onChange={changeProject} onSave={() => persistProject()} onExport={exportProject} onImport={importProject}
        onMarkWorking={markProjectWorking} onRestore={restoreProject} onUndoReplacement={undoReplacement} canUndoReplacement={canUndoReplacement}
        onPrepare={prepareStarter} onOpenProgram={() => openTab('program')} onOpenAI={() => {
          if (preparation.hasPendingChanges && !confirm(t('作品の機器設定をAIの準備に渡します。AI準備の未適用設定を置き換えますか？'))) return
          preparation.adoptProjectSettings(project.draft.settings, project.draft.recipe.wireless)
          openTab('preparation')
        }} onOpenController={() => openTab('controller')} onConnect={app.connect} onRun={() => { if (availability.verified && sourceMatches && boardMatches) void runProject() }} onStop={app.stop} onFinish={finishProject} onDownloadCandidate={downloadCandidate}
        state={app.state} error={app.error?.message ?? null} notice={projectNotice} verifiedStarter={availability.verified} starterReason={availability.reason}
        sourceMatches={sourceMatches} canMarkWorking={canMarkWorking} canFinish={canFinish} canConfirmStandalone={canConfirmStandalone} bootOption={app.info.bootOption} bootSupported={app.info.bootOptionSupported || app.info.nvsFallbackSupported} />
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

    {connected && <section className="action-card"><div className="section-heading"><div><p className="eyebrow">{t("プログラムを試す")}</p><h2>{t("まずは「実行」を押そう")}</h2><p>{t("実行すると、編集内容を機器へ保存してから動かします。")}</p></div>{running && <button className="stop-button" onClick={app.stop}>{t("■ 停止")}</button>}</div><div className="main-actions"><button className="run-button" disabled={!canModifyProgram} onClick={runProject}><span>{t("▶ 実行")}</span><small>{t(runDescription)}</small></button><button className="update-button" disabled={!canModifyProgram} onClick={app.write}><span>{t("プログラム更新")}</span><small>{t("保存だけ。今は動かしません。")}</small></button><button className="load-button" disabled={!ready} onClick={app.load}>{t("保存済みのプログラムを読む")}</button></div><p className="action-tip">{t("迷ったら「実行」。保存だけなら「プログラム更新」を使ってください。")}</p></section>}

    {connected && <details className="advanced-card"><summary><span>⚙</span><div><strong>{t("電源を入れた時の動きを変える")}</strong><small>{t("機器本体に保存される設定です")}</small></div></summary><div className="advanced-body"><p>{t("今の設定:")}<strong>{t(bootSummary)}</strong></p><div className="boot-actions"><button disabled={!ready} onClick={() => app.setBoot(0)}>{t("電源を入れたら自動で実行する")}</button><button className="quiet-button" disabled={!ready} onClick={() => app.setBoot(1)}>{t("電源を入れても自動実行しない")}</button></div><p className="advanced-note">{t("設定を変えると機器は再起動し、USB接続は一度切れます。再起動後は、もう一度「USBをつなぐ」を押してください。")}</p><div className="secondary-actions"><button className="quiet-button" disabled={busy || app.state === 'disconnected' || app.state === 'connection-lost'} onClick={app.normalMode}>{t("通常動作に戻す")}</button><button className="quiet-button" disabled={!ready} onClick={app.reset}>{t("↻ 機器を再起動")}</button></div></div></details>}

    <section className="workspace"><div className="panel program-panel"><div className="panel-head"><div><p className="eyebrow">{t("プログラム")}</p><h2>{t("LEDやボタンの動きを書く場所")}</h2><p>{t("ここを書き換えて、上の「実行」で試します。")}</p></div><label className="wrap-toggle"><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} />{t("長い行を折り返す")}</label></div><CodeEditor label={t("Pythonコードエディタ")} value={app.source} onChange={app.setSource} dark={dark} wrap={wrap} errorLine={app.error?.sourceKnown !== false && (app.error?.sourceSnapshot === undefined || app.error.sourceSnapshot === app.source) ? app.error?.line : undefined} onSave={app.write} onRun={runProject} /><p className="shortcut-note">{t("ショートカット: Ctrl+Sでプログラム更新、Ctrl+Enterで実行")}</p></div><aside className="right"><div className="panel terminal-panel"><div className="panel-head"><div><p className="eyebrow">{t("見守りログ")}</p><h2>{t("うまくいかない時に見る記録")}</h2></div><span><label><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} />{t("自動スクロール")}</label><label><input type="checkbox" checked={timestamps} onChange={event => setTimestamps(event.target.checked)} />{t("時刻")}</label><button className="quiet-button" onClick={() => app.setLog('')}>{t("消去")}</button></span></div><Terminal label={t("シリアルターミナル")} log={stampLog()} dark={dark} autoScroll={autoScroll} /></div>{app.error && <section className="panel error" aria-live="assertive"><p className="eyebrow">{t("困ったとき")}</p><h2>⚠ {app.error.exceptionType}</h2><p>{t(app.error.message)}</p><dl><dt>{t("起きた場所")}</dt><dd>{t(app.error.stage)}</dd><dt>{t("確認する行")}</dt><dd>{app.error.line ?? t('見つけられませんでした')} {app.error.codeLine && `: ${app.error.codeLine}`}</dd></dl><pre>{app.error.traceback}</pre>{app.error.sourceKnown === false && <p>{t("機器上の実行コードは未取得です。編集中のコードと同じとは確認できていません。")}</p>}{app.error.sourceKnown !== false && app.error.sourceSnapshot !== undefined && app.error.sourceSnapshot !== app.source && <p>{t("編集内容はエラー発生時から変わっています。AIへの修正依頼には、エラーが起きた時のコードを入れます。")}</p>}<button onClick={copyPrompt}>{t("AIに相談する文章をコピー")}</button>{copyNotice && <p className={`copy-notice${copyNotice.failed ? ' failed' : ''}`} role="status">{t(copyNotice.text, { message: t(copyNotice.detail ?? '') })}</p>}</section>}</aside></section>

    <footer>{t("このページはコードとログを外部へ送信しません。実機の動きを確認できた時だけ、「電源を入れたら自動で実行する」を使ってください。")}</footer>
    </div>
    <div id="panel-controller" role="tabpanel" aria-labelledby="tab-controller" hidden={activeTab !== 'controller'}>
      <BluetoothPanel onOpenProgram={() => { setActiveTab('program'); document.getElementById('tab-program')?.focus() }} onOpenPreparation={() => { setActiveTab('preparation'); document.getElementById('tab-preparation')?.focus() }} remoteButtons={project.draft.remoteButtons} projectName={project.name} onRemoteButtonsChange={saveRemoteButtons} />
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
