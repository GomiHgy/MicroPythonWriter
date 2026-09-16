import { useEffect, useRef, useState } from 'react'
import type { WorkshopPreparation } from '../hooks/useWorkshopPreparation'
import { copyPreparationPrompt, downloadPreparationPrompt } from '../services/prompt/PromptExport'
import { MAX_BASELINE_CODE_LENGTH, type WorkshopProfile } from '../services/workshop/WorkshopProfile'
import './AiPreparationPanel.css'

type Props = { preparation: WorkshopPreparation; onOpenProgram: () => void }
const numberOrNull = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)

export function AiPreparationPanel({ preparation, onOpenProgram }: Props) {
  const { selectedProfile: profile, context, prompt } = preparation
  const [previewOpen, setPreviewOpen] = useState(false)
  const [manualCopy, setManualCopy] = useState(false)
  const [copying, setCopying] = useState(false)
  const [exportNotice, setExportNotice] = useState({ prompt: '', message: '', failed: false })
  const preview = useRef<HTMLTextAreaElement>(null)
  const exportAllowed = !!prompt && !preparation.hasPendingChanges && !preparation.isImporting

  useEffect(() => { if (previewOpen && manualCopy) { preview.current?.focus(); preview.current?.select() } }, [previewOpen, manualCopy])

  async function copyPrompt() {
    if (!exportAllowed || copying) return
    setCopying(true)
    const result = await copyPreparationPrompt(prompt)
    setCopying(false)
    setExportNotice({ prompt, message: result.message, failed: !result.ok })
    if (!result.ok) { setPreviewOpen(true); setManualCopy(!result.cancelled) }
  }

  function savePrompt() {
    if (!exportAllowed || !profile?.kitId) return
    const result = downloadPreparationPrompt(prompt, profile.kitId, profile.revision)
    setExportNotice({ prompt, message: result.message, failed: !result.ok })
    if (!result.ok) { setPreviewOpen(true); setManualCopy(!result.cancelled) }
  }

  return <div className="ai-preparation">
    <section className="panel ai-start">
      <div className="section-heading"><div><p className="eyebrow">はじめてでも大丈夫</p><h2>好きなAIと、光り方を考えよう</h2><p>キットを選んで準備文をコピー。AIへ1回貼り付ければ、相談を始められます。</p></div><span className="ai-sparkle" aria-hidden="true">✦</span></div>
      <label className="ai-kit-label" htmlFor="ai-kit">使うキット</label>
      <select id="ai-kit" value={preparation.selectedId ?? ''} disabled={copying} onChange={event => { preparation.selectProfile(event.target.value || null); setExportNotice({ prompt: '', message: '', failed: false }); setManualCopy(false) }}>
        <option value="">選んでください（準備なしでプログラムも使えます）</option>
        {preparation.profiles.map(preset => <option key={preset.id} value={preset.id}>{preset.profile.displayName} — キット {preset.profile.kitId ?? '未設定'}</option>)}
      </select>
      {profile && <div className="ai-kit-summary"><p><strong>{profile.displayName}</strong><span>版 {profile.revision} ／ キット {profile.kitId ?? '未設定'}</span></p><div className="ai-feature-list"><span>LED</span>{profile.features.button && <span>本体ボタン</span>}{context?.bleEnabled && <span>Bluetooth</span>}{context?.controllerEnabled && <span>Webコントローラ</span>}</div></div>}
      {context?.errors.length ? <div className="notice warn"><strong>講師の設定が必要です</strong><p>このキットは準備中です。講師に設定を確認してもらってください。</p><details><summary>講師が確認する項目（{context.errors.length}件）</summary><ul>{context.errors.map(error => <li key={error}>{error}</li>)}</ul></details></div> : null}
      {profile && (profile.features.ble || profile.features.controller) && !context?.bleEnabled && <p className="ai-help">Bluetoothは講師の準備が必要です。{context?.bleReasons.join(' ')} LEDと本体ボタンの準備は続けられます。</p>}
      {profile && context?.bleEnabled && profile.features.controller && !context.controllerEnabled && <p className="ai-help">Webコントローラは講師のNanoLED v1対応確認が必要です。{context.bleReasons.join(' ')}</p>}
      <ol className="ai-simple-steps"><li><strong>準備文をコピー</strong><span>キットの設定は自動で入ります</span></li><li><strong>好きなAIへ貼って送信</strong><span>新しい会話で、質問に答えよう</span></li><li><strong>コードを貼って「実行」</strong><span>できた main.py をプログラム画面へ</span></li></ol>
      {preparation.hasPendingChanges && <p className="notice warn">講師用設定に未適用の変更があります。先に「設定を適用」を押してください。適用するまでコピー・ファイル保存はできません。</p>}
      {preparation.isImporting && <p role="status" className="notice">基準コードを読み込み中です。完了するまでコピー・ファイル保存を待ってください。</p>}
      <button className="run-button ai-copy-button" disabled={!exportAllowed || copying} onClick={() => { void copyPrompt() }}>{copying ? 'コピーしています…' : 'AIに渡す準備文をコピー'}</button>
      {exportNotice.prompt === prompt && exportNotice.message && <p role="status" className={`copy-notice${exportNotice.failed ? ' failed' : ''}`}>{exportNotice.message}</p>}
      <div className="ai-links" aria-label="好きなAIを開く"><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPTを開く ↗</a><a href="https://claude.ai/" target="_blank" rel="noopener noreferrer">Claudeを開く ↗</a><a href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer">Geminiを開く ↗</a></div>
      <p className="ai-help">新しい会話に貼り付けて送信し、AIの質問に答えよう。ほかのAIにも同じ準備文を貼り付けて使えます。利用条件やアカウントは各サービスで確認してください。</p>
      <div className="ai-secondary-actions"><button className="quiet-button" disabled={!exportAllowed} onClick={savePrompt}>準備文をファイルで保存</button><button className="quiet-button" onClick={onOpenProgram}>コードができたら「プログラム」へ →</button></div>
      <details className="ai-preview" open={previewOpen} onToggle={event => setPreviewOpen(event.currentTarget.open)}><summary>準備文の内容を見る</summary>{exportAllowed ? <><p className="ai-help">{prompt.length.toLocaleString()}文字。コピー・ファイル保存も、この内容をそのまま使います。</p><textarea ref={preview} aria-label="AIに渡す準備文" value={prompt} readOnly spellCheck={false} /><button className="quiet-button" onClick={() => { preview.current?.focus(); preview.current?.select() }}>全文を選択（手動コピー用）</button><p className="ai-help">選択したら Ctrl+C（Macは ⌘C）、または端末のコピー操作を使ってください。</p></> : <p className="ai-help">キットを選び、必要な設定を適用するとここに準備文が表示されます。</p>}</details>
    </section>
    <p className="ai-privacy">準備文はブラウザ内で作ります。Writerが自動で外部送信することはありません。自分でAIへ貼って送ると、その内容はAIサービスへ送られます。基準コードに秘密情報がないか確認してください。検出機能だけですべてを見つけられるわけではありません。</p>
    {preparation.notice && <p role="status" className="notice ai-storage-notice">{preparation.notice}</p>}
    <TeacherSettings key={preparation.selectedId ?? 'none'} preparation={preparation} />
  </div>
}

function TeacherSettings({ preparation }: { preparation: WorkshopPreparation }) {
  const { draft } = preparation
  const [persistBaseline, setPersistBaseline] = useState(false)
  const [confirmedBy, setConfirmedBy] = useState('')
  const [testedOnDevice, setTestedOnDevice] = useState(false)
  const [nanoLedV1, setNanoLedV1] = useState(false)
  const [confirmedCode, setConfirmedCode] = useState({ code: draft?.baseline.code, firmware: draft?.firmwareVersion })
  const verificationMatches = confirmedCode.code === draft?.baseline.code && confirmedCode.firmware === draft?.firmwareVersion
  const setField = <Key extends keyof WorkshopProfile,>(key: Key, value: WorkshopProfile[Key]) => {
    if (key === 'baseline' || key === 'firmwareVersion') { setTestedOnDevice(false); setNanoLedV1(false) }
    preparation.editDraft({ [key]: value })
  }

  return <details className="advanced-card ai-teacher"><summary><span aria-hidden="true">⚙</span><div><strong>講師用設定</strong><small>配布前に確認する設定。この折りたたみは権限制御ではありません。</small></div></summary><div className="advanced-body">
    {!draft ? <p>先に「使うキット」で配布用のキットを選んでください。</p> : <>
      <p>このブラウザだけの変更です。共有する配布設定はリポジトリの <code>src/config/workshops.ts</code> で管理します。編集中のプログラムやログは保存しません。</p>
      <p className="ai-help">教材ID: <code>{draft.materialId}</code> ／ 版: <code>{draft.revision}</code>（配布設定で指定）</p>
      <div className="ai-settings-grid">
        <label>教材の表示名<input value={draft.displayName} maxLength={200} onChange={event => setField('displayName', event.target.value)} /></label>
        <label>キット番号<input value={draft.kitId ?? ''} maxLength={40} placeholder="講師が割り当てる番号" onChange={event => setField('kitId', event.target.value || null)} /></label>
        <label>対象UIFlow2ファームウェア版<input value={draft.firmwareVersion ?? ''} maxLength={200} placeholder="実機で確認した版" onChange={event => { setField('firmwareVersion', event.target.value || null); setTestedOnDevice(false) }} /></label>
        <label>LED型番<input value={draft.ledModel ?? ''} maxLength={200} placeholder="キットのLED型番" onChange={event => setField('ledModel', event.target.value || null)} /></label>
        <label>LED数<input type="number" min="1" step="1" value={draft.ledCount ?? ''} onChange={event => setField('ledCount', numberOrNull(event.target.value))} /></label>
        <label>LED_BPP（今回の対応はRGB=3）<input type="number" min="1" step="1" value={draft.ledBpp ?? ''} onChange={event => setField('ledBpp', numberOrNull(event.target.value))} /></label>
        <label>最大輝度（%）<input type="number" min="0.01" max="100" step="any" value={draft.maxBrightnessPercent ?? ''} onChange={event => setField('maxBrightnessPercent', numberOrNull(event.target.value))} /></label>
      </div>
      <p className="ai-help">最大輝度が範囲内でも電源の安全性は保証されません。講師がLED数・電源に合わせて確認してください。キット番号の会場全体での重複は講師が確認します。USBから取得したMicroPython版を、対象UIFlow2版として自動設定することはありません。</p>
      <fieldset className="ai-features"><legend>使う機能</legend>{([['button', '本体ボタン'], ['ble', 'Bluetooth'], ['controller', 'Webコントローラ（NanoLED v1）']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.features[key]} onChange={event => setField('features', { ...draft.features, [key]: event.target.checked })} />{label}</label>)}</fieldset>
      <details className="ai-baseline"><summary>基準コードと講師の実機確認</summary><p className="ai-help">任意の基準コードです。Bluetoothには対象UIFlow2版で講師が実機確認したコードが必要です。入力・読込だけでは確認済みになりません。コードは実行されません。</p>
        <label className="ai-file-label">.py ファイルから読む<input type="file" accept=".py,text/x-python" onChange={event => { const file = event.target.files?.[0]; if (file) { setTestedOnDevice(false); setNanoLedV1(false); void preparation.importBaseline(file) } event.target.value = '' }} /></label>
        <label className="ai-baseline-code">基準コード（全文）<textarea value={draft.baseline.code} spellCheck={false} onChange={event => { setField('baseline', { code: event.target.value, verification: null }); setTestedOnDevice(false) }} /></label>
        {draft.baseline.code.length > MAX_BASELINE_CODE_LENGTH && <p className="notice warn">基準コードが100,000文字を超えています。内容は省略していません。Bluetoothの準備とブラウザ保存には使えないため、講師が登録内容を確認してください。</p>}
        {draft.baseline.verification ? <p className="ai-help">講師による登録: {draft.baseline.verification.confirmedBy} ／ {draft.baseline.verification.confirmedAt} ／ 対象版 {draft.baseline.verification.firmwareVersion}{draft.baseline.verification.nanoLedV1 ? ' ／ NanoLED v1対応確認あり' : ''} <button className="quiet-button" onClick={() => setField('baseline', { ...draft.baseline, verification: null })}>確認登録を取り消す</button></p> : <p className="ai-help">実機確認は未登録です。基準コードや対象版を変えたら、再確認が必要です。</p>}
        <label className="ai-confirm-name">確認した講師名<input value={confirmedBy} maxLength={200} onChange={event => setConfirmedBy(event.target.value)} /></label>
        <label className="ai-check"><input type="checkbox" checked={testedOnDevice && verificationMatches} onChange={event => { setConfirmedCode({ code: draft.baseline.code, firmware: draft.firmwareVersion }); setTestedOnDevice(event.target.checked) }} />この基準コードを、指定の対象UIFlow2版の実機で確認した</label>
        <label className="ai-check"><input type="checkbox" checked={nanoLedV1} onChange={event => setNanoLedV1(event.target.checked)} />NanoLED v1の操作・状態通知・再接続も実機で確認した</label>
        <button className="quiet-button" disabled={preparation.isImporting || !testedOnDevice || !verificationMatches || !confirmedBy.trim() || !draft.baseline.code.trim() || !draft.firmwareVersion?.trim()} onClick={() => preparation.confirmBaseline(confirmedBy, nanoLedV1)}>講師の実機確認を登録</button>
        <p className="ai-help">講師が入力した確認情報です。Writerがコードを検証したり、実機の動作確認を代行した結果ではありません。</p>
      </details>
      {preparation.draftErrors.length > 0 && <div className="notice warn"><strong>設定の確認項目</strong><ul>{preparation.draftErrors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      <div className="ai-secondary-actions"><button disabled={preparation.isImporting || !!preparation.draftErrors.length} onClick={() => preparation.applyDraft()}>設定を適用</button><button className="quiet-button" disabled={preparation.isImporting || !!preparation.draftErrors.length} onClick={() => preparation.saveDraft(persistBaseline)}>このブラウザに設定を保存</button></div>
      <label className="ai-check"><input type="checkbox" checked={persistBaseline} onChange={event => setPersistBaseline(event.target.checked)} />保存ボタンを押すとき、基準コードと確認情報も保存する</label>
      <p className="ai-help">チェックなしでは基準コードはメモリ上だけで扱い、以前保存した基準コードも次の保存で除きます。共用PCでは保存内容の取り扱いに注意してください。</p>
      <button className="quiet-button" onClick={() => { if (confirm('このキットのブラウザ保存と画面上の変更を削除し、配布時の設定に戻しますか？')) preparation.resetProfile() }}>配布時の設定に戻す</button>
    </>}
  </div></details>
}
