import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n'
import { getBoardDefinition } from '../config/boards'
import type { WorkshopPreparation } from '../hooks/useWorkshopPreparation'
import { copyPreparationPrompt, downloadPreparationPrompt } from '../services/prompt/PromptExport'
import { LED_MODELS, MAX_BASELINE_CODE_LENGTH, type WorkshopProfile } from '../services/workshop/WorkshopProfile'
import './AiPreparationPanel.css'

type Props = { preparation: WorkshopPreparation; onOpenProgram: () => void }
const numberOrNull = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)

export function AiPreparationPanel({ preparation, onOpenProgram }: Props) {
  const { t, locale } = useLocale()
  const { selectedProfile: profile, context, prompt } = preparation
  const board = profile ? getBoardDefinition(profile.boardId) : null
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
    if (!exportAllowed || !profile) return
    const result = downloadPreparationPrompt(prompt, profile.boardId, profile.revision)
    setExportNotice({ prompt, message: result.message, failed: !result.ok })
    if (!result.ok) { setPreviewOpen(true); setManualCopy(!result.cancelled) }
  }

  return <div className="ai-preparation">
    <section className="panel ai-start">
      <div className="section-heading"><div><p className="eyebrow">{t('はじめてでも大丈夫')}</p><h2>{t('好きなAIと、光り方を考えよう')}</h2><p>{t('機器を選び、使うLEDとファームウェアを設定しよう。準備文をAIへ貼り付ければ、相談を始められます。')}</p></div><span className="ai-sparkle" aria-hidden="true">✦</span></div>
      <label className="ai-kit-label" htmlFor="ai-kit">{t('使う機器')}</label>
      <select id="ai-kit" value={preparation.selectedId ?? ''} disabled={copying} onChange={event => { preparation.selectProfile(event.target.value || null); setExportNotice({ prompt: '', message: '', failed: false }); setManualCopy(false) }}>
        <option value="">{t('選んでください（準備なしでプログラムも使えます）')}</option>
        {preparation.profiles.map(preset => <option key={preset.id} value={preset.id}>{t(preset.profile.displayName)}</option>)}
      </select>
      {profile && <div className="ai-kit-summary"><p><strong>{t(profile.displayName)}</strong></p><div className="ai-feature-list"><span>LED</span>{profile.features.button && <span>{t('本体ボタン')}</span>}{context?.bleEnabled && <span>Bluetooth</span>}{context?.controllerEnabled && <span>{t('Webコントローラ')}</span>}</div></div>}
      {board && <section className="notice ai-firmware-setup" aria-labelledby="ai-firmware-heading">
        <h3 id="ai-firmware-heading">{t('はじめて使うとき：UIFlow2を書き込む')}</h3>
        <p>{t('すでにUIFlow2を書き込んでいる人は、この手順を飛ばせます。')}</p>
        <p className="ai-help">{t('書き込みで機器内のプログラムが消える場合があります。必要なコードは先にPCへ保存してください。')}</p>
        <ol>
          <li>{t('このアプリやほかのアプリでUSB接続中なら、いったん切断してください。')}</li>
          <li>{t('下のM5Burnerを開き、「UIFlow2.0」を選んで機器へ書き込みます。')}</li>
          <li>{t('書き込み後はM5BurnerのUSB接続を切り、この画面へ戻って、書き込んだ版を下に入力してください。')}</li>
        </ol>
        <div className="ai-links"><a href={board.firmwareBurnerUrl} target="_blank" rel="noopener noreferrer">{t('{board}の書き込みページを開く ↗', { board: board.name })}</a></div>
      </section>}
      {profile && <fieldset className="ai-led-settings" disabled={copying || preparation.isImporting}><legend>{t('LEDの設定')}</legend>
        <div className="ai-settings-grid">
          <label>{t('対象UIFlow2ファームウェア版')}<input value={profile.firmwareVersion ?? ''} maxLength={200} placeholder={t('実機で確認した版')} onChange={event => preparation.editLedSettings({ firmwareVersion: event.target.value || null })} /></label>
          <label>{t('LED型番')}<select value={profile.ledModel ?? ''} onChange={event => preparation.editLedSettings({ ledModel: LED_MODELS.find(model => model === event.target.value) ?? null })}><option value="">{t('LEDの型番を選んでください')}</option>{LED_MODELS.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
          <label>{t('LED数')}<input type="number" min="1" step="1" value={profile.ledCount ?? ''} onChange={event => preparation.editLedSettings({ ledCount: numberOrNull(event.target.value) })} /></label>
          <label>{t('最大輝度（%）')}<input type="number" min="0.01" max="100" step="any" value={profile.maxBrightnessPercent ?? ''} onChange={event => preparation.editLedSettings({ maxBrightnessPercent: numberOrNull(event.target.value) })} /></label>
          <label>{t('外部LEDピン（GPIO）')}<input type="number" min="0" max="48" step="1" value={profile.ledPin ?? ''} onChange={event => preparation.editLedSettings({ ledPin: numberOrNull(event.target.value) })} /></label>
        </div><p className="ai-help">{t('初期値は10個・20%・GPIO2。有効な入力は機種別にこのブラウザへ自動保存します。')}</p>
        <p className="ai-help">{t('ファームウェア版は実機で確認したUIFlow2の版を入力してください。USBで取得するMicroPython版とは別です。LED型番は製品の表記で確認し、RGBWではなくRGB（3色）のLEDを使ってください。')}</p>
        <p className="ai-help">{t('外部LEDピンは実際の配線に合わせてください。内蔵LED・ボタン・USB用のピンと競合させず、電源と出力可能なGPIOを確認してください。')}</p>
      </fieldset>}
      {context?.errors.length ? <div className="notice warn"><strong>{t('設定を確認してください')}</strong><p>{t('下の項目を入力・確認すると、AIに渡す準備文を作れます。')}</p><details><summary>{t('確認する項目（{count}件）', { count: context.errors.length })}</summary><ul>{context.errors.map(error => <li key={error}>{t(error)}</li>)}</ul></details></div> : null}
      {profile && (profile.features.ble || profile.features.controller) && !context?.bleEnabled && <p className="ai-help">{t('Bluetoothを使う場合は、基準コードの実機確認が必要です。')} {context?.bleReasons.map(reason => t(reason)).join(' ')} {t('LEDと本体ボタンの準備は続けられます。')}</p>}
      {profile && context?.bleEnabled && profile.features.controller && !context.controllerEnabled && <p className="ai-help">{t('Webコントローラを使う場合は、NanoLED v1またはv2対応の実機確認が必要です。')} {context.bleReasons.map(reason => t(reason)).join(' ')}</p>}
      <ol className="ai-simple-steps"><li><strong>{t('準備文をコピー')}</strong><span>{t('入力した設定は自動で入ります')}</span></li><li><strong>{t('好きなAIへ貼って送信')}</strong><span>{t('新しい会話で、質問に答えよう')}</span></li><li><strong>{t('コードを貼って「実行」')}</strong><span>{t('できた main.py をプログラム画面へ')}</span></li></ol>
      {preparation.hasPendingChanges && <p className="notice warn">{t('詳細設定に未適用の変更があります。先に「設定を適用」を押してください。適用するまでコピー・ファイル保存はできません。')}</p>}
      {preparation.isImporting && <p role="status" className="notice">{t('基準コードを読み込み中です。完了するまでコピー・ファイル保存を待ってください。')}</p>}
      <button className="run-button ai-copy-button" disabled={!exportAllowed || copying} onClick={() => { void copyPrompt() }}>{t(copying ? 'コピーしています…' : 'AIに渡す準備文をコピー')}</button>
      {exportNotice.prompt === prompt && exportNotice.message && <p role="status" className={`copy-notice${exportNotice.failed ? ' failed' : ''}`}>{t(exportNotice.message)}</p>}
      <div className="ai-links" aria-label={t('好きなAIを開く')}><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">{t('{name}を開く ↗', { name: 'ChatGPT' })}</a><a href="https://claude.ai/" target="_blank" rel="noopener noreferrer">{t('{name}を開く ↗', { name: 'Claude' })}</a><a href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer">{t('{name}を開く ↗', { name: 'Gemini' })}</a><a href="https://chat.deepseek.com/" target="_blank" rel="noopener noreferrer">{t('{name}を開く ↗', { name: 'DeepSeek' })}</a></div>
      <p className="ai-help">{t('新しい会話に貼り付けて送信し、AIの質問に答えよう。ほかのAIにも同じ準備文を貼り付けて使えます。利用条件やアカウントは各サービスで確認してください。')}</p>
      <div className="ai-secondary-actions"><button className="quiet-button" disabled={!exportAllowed} onClick={savePrompt}>{t('準備文をファイルで保存')}</button><button className="quiet-button" onClick={onOpenProgram}>{t('コードができたら「プログラム」へ →')}</button></div>
      <details className="ai-preview" open={previewOpen} onToggle={event => setPreviewOpen(event.currentTarget.open)}><summary>{t('準備文の内容を見る')}</summary>{exportAllowed ? <><p className="ai-help">{t('{count}文字。コピー・ファイル保存も、この内容をそのまま使います。', { count: prompt.length.toLocaleString(locale) })}</p><textarea ref={preview} aria-label={t('AIに渡す準備文')} value={prompt} readOnly spellCheck={false} /><button className="quiet-button" onClick={() => { preview.current?.focus(); preview.current?.select() }}>{t('全文を選択（手動コピー用）')}</button><p className="ai-help">{t('選択したら Ctrl+C（Macは ⌘C）、または端末のコピー操作を使ってください。')}</p></> : <p className="ai-help">{t('機器を選び、必要な設定を入力するとここに準備文が表示されます。')}</p>}</details>
    </section>
    <p className="ai-privacy">{t('準備文はブラウザ内で作ります。Writerが自動で外部送信することはありません。自分でAIへ貼って送ると、その内容はAIサービスへ送られます。基準コードに秘密情報がないか確認してください。検出機能だけですべてを見つけられるわけではありません。')}</p>
    {preparation.notice && <p role="status" className="notice ai-storage-notice">{t(preparation.notice)}</p>}
    <TeacherSettings key={preparation.selectedId ?? 'none'} preparation={preparation} />
  </div>
}

function TeacherSettings({ preparation }: { preparation: WorkshopPreparation }) {
  const { t } = useLocale()
  const { draft } = preparation
  const [persistBaseline, setPersistBaseline] = useState(false)
  const [confirmedBy, setConfirmedBy] = useState('')
  const [testedOnDevice, setTestedOnDevice] = useState(false)
  const [nanoLedV1, setNanoLedV1] = useState(false)
  const [nanoLedV2, setNanoLedV2] = useState(false)
  const [confirmedCode, setConfirmedCode] = useState({ code: draft?.baseline.code, firmware: draft?.firmwareVersion, boardId: draft?.boardId, ledModel: draft?.ledModel, ledCount: draft?.ledCount, ledPin: draft?.ledPin, brightness: draft?.maxBrightnessPercent })
  const verificationMatches = confirmedCode.ledModel === draft?.ledModel && confirmedCode.ledCount === draft?.ledCount && confirmedCode.ledPin === draft?.ledPin && confirmedCode.brightness === draft?.maxBrightnessPercent && confirmedCode.code === draft?.baseline.code && confirmedCode.firmware === draft?.firmwareVersion && confirmedCode.boardId === draft?.boardId
  const board = draft ? getBoardDefinition(draft.boardId) : null
  const setField = <Key extends keyof WorkshopProfile,>(key: Key, value: WorkshopProfile[Key]) => {
    if (key === 'baseline' || key === 'firmwareVersion') { setTestedOnDevice(false); setNanoLedV1(false); setNanoLedV2(false) }
    preparation.editDraft({ [key]: value })
  }

  return <details className="advanced-card ai-teacher"><summary><span aria-hidden="true">⚙</span><div><strong>{t('詳細設定（必要なときだけ）')}</strong><small>{t('Bluetooth・基準コードなどを設定できます。')}</small></div></summary><div className="advanced-body">
    {!draft ? <p>{t('先に「使う機器」で機器を選んでください。')}</p> : <>
      <p>{t('変更はこのブラウザだけに保存されます。編集中のプログラムやログは、この設定には保存しません。')}</p>
      {board && <div className="notice ai-board-pins"><strong>{t('対象機器')}: {board.name}</strong><p>{t('外付けLED: GPIO{led} ／ 本体ボタン: GPIO{button}（押すとLOW）', { led: draft.ledPin ?? t('未設定'), button: board.buttonPin })}</p><p>{t('内蔵RGB LED: GPIO{rgb}', { rgb: board.rgbPin })}{board.rgbPowerPin !== null && ` ／ ${t('内蔵RGB電源: GPIO{pin}', { pin: board.rgbPowerPin })}`}{board.statusLedPin !== null && ` ／ ${t('状態LED: GPIO{pin}', { pin: board.statusLedPin })}`}</p><p>{t('外付けLEDと内蔵LEDのピンは別です。機器を変更する場合は「使う機器」で選び直してください。')}</p></div>}
      <div className="ai-settings-grid">
        <label>{t('設定の表示名')}<input value={draft.displayName} maxLength={200} onChange={event => setField('displayName', event.target.value)} /></label>
      </div>
      <p className="ai-help">{t('最大輝度が範囲内でも電源の安全性は保証されません。LED数と電源に合わせて確認してください。USBから取得したMicroPython版を、対象UIFlow2版として自動設定することはありません。')}</p>
      <fieldset className="ai-features"><legend>{t('使う機能')}</legend>{([['button', '本体ボタン'], ['ble', 'Bluetooth'], ['controller', 'Webコントローラ（NanoLED v1/v2）']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={key === 'ble' ? draft.features.ble || draft.features.controller : draft.features[key]} disabled={key === 'ble' && draft.features.controller} aria-describedby={key === 'ble' && draft.features.controller ? 'ai-controller-ble-help' : undefined} onChange={event => {
        if (key === 'ble' && draft.features.controller) return
        const features = { ...draft.features, [key]: event.target.checked }
        if (features.controller) features.ble = true
        setField('features', features)
      }} />{t(label)}</label>)}
        {draft.features.controller && <p id="ai-controller-ble-help" className="ai-help">{t('WebコントローラはBluetoothで通信するため、使用中はBluetoothがONに固定されます。OFFにするには、先にWebコントローラをOFFにしてください。')}</p>}
      </fieldset>
      <details className="ai-baseline"><summary>{t('基準コードと実機確認')}</summary><p className="ai-help">{t('任意の基準コードです。Bluetoothには対象UIFlow2版の実機で動作を確認したコードが必要です。入力・読込だけでは確認済みになりません。コードは実行されません。')}</p>
        <label className="ai-file-label">{t('.py ファイルから読む')}<input type="file" accept=".py,text/x-python" onChange={event => { const file = event.target.files?.[0]; if (file) { setTestedOnDevice(false); setNanoLedV1(false); setNanoLedV2(false); void preparation.importBaseline(file) } event.target.value = '' }} /></label>
        <label className="ai-baseline-code">{t('基準コード（全文）')}<textarea value={draft.baseline.code} spellCheck={false} onChange={event => { setField('baseline', { code: event.target.value, verification: null }); setTestedOnDevice(false) }} /></label>
        {draft.baseline.code.length > MAX_BASELINE_CODE_LENGTH && <p className="notice warn">{t('基準コードが100,000文字を超えています。内容は省略していません。Bluetoothの準備とブラウザ保存には使えないため、登録内容を確認してください。')}</p>}
        {draft.baseline.verification ? <p className="ai-help">{t('実機確認の登録: {name} ／ {date} ／ 対象版 {firmware}', { name: draft.baseline.verification.confirmedBy, date: draft.baseline.verification.confirmedAt, firmware: draft.baseline.verification.firmwareVersion })}{draft.baseline.verification.nanoLedV1 ? ` ／ ${t('NanoLED v1対応確認あり')}` : ''}{draft.baseline.verification.nanoLedV2 ? ` ／ ${t('NanoLED v2対応確認あり')}` : ''} <button className="quiet-button" onClick={() => setField('baseline', { ...draft.baseline, verification: null })}>{t('確認登録を取り消す')}</button></p> : <p className="ai-help">{t('実機確認は未登録です。基準コードや対象版を変えたら、再確認が必要です。')}</p>}
        <label className="ai-confirm-name">{t('確認した人の名前')}<input value={confirmedBy} maxLength={200} onChange={event => setConfirmedBy(event.target.value)} /></label>
        <label className="ai-check"><input type="checkbox" checked={testedOnDevice && verificationMatches} onChange={event => { if (!verificationMatches || !event.target.checked) { setNanoLedV1(false); setNanoLedV2(false) } setConfirmedCode({ code: draft.baseline.code, firmware: draft.firmwareVersion, boardId: draft.boardId, ledModel: draft.ledModel, ledCount: draft.ledCount, ledPin: draft.ledPin, brightness: draft.maxBrightnessPercent }); setTestedOnDevice(event.target.checked) }} />{t('この基準コードを、指定の対象機器・UIFlow2版の実機で確認した')}</label>
        <label className="ai-check"><input type="checkbox" checked={nanoLedV1 && verificationMatches} onChange={event => setNanoLedV1(event.target.checked)} />{t('NanoLED v1の操作・状態通知・再接続も実機で確認した')}</label>
        <label className="ai-check"><input type="checkbox" checked={nanoLedV2 && verificationMatches} onChange={event => setNanoLedV2(event.target.checked)} />{t('NanoLED v2の再生・停止・モード・アクション・状態通知・再接続を実機で確認した')}</label>
        <p className="ai-help">{t('再生・停止と作品専用ボタンにはv2が必要です。v1の確認をv2へ自動で引き継ぐことはありません。')}</p>
        <button className="quiet-button" disabled={preparation.isImporting || !testedOnDevice || !verificationMatches || !confirmedBy.trim() || !draft.baseline.code.trim() || !draft.firmwareVersion?.trim()} onClick={() => preparation.confirmBaseline(confirmedBy, nanoLedV1, nanoLedV2)}>{t('実機確認を登録')}</button>
        <p className="ai-help">{t('利用者が入力した確認情報です。Writerがコードを検証したり、実機の動作確認を代行した結果ではありません。')}</p>
      </details>
      {preparation.draftErrors.length > 0 && <div className="notice warn"><strong>{t('設定の確認項目')}</strong><ul>{preparation.draftErrors.map(error => <li key={error}>{t(error)}</li>)}</ul></div>}
      <div className="ai-secondary-actions"><button disabled={preparation.isImporting || !!preparation.draftErrors.length} onClick={() => preparation.applyDraft()}>{t('設定を適用')}</button><button className="quiet-button" disabled={preparation.isImporting || !!preparation.draftErrors.length} onClick={() => preparation.saveDraft(persistBaseline)}>{t('このブラウザに設定を保存')}</button></div>
      <label className="ai-check"><input type="checkbox" checked={persistBaseline} onChange={event => setPersistBaseline(event.target.checked)} />{t('保存ボタンを押すとき、基準コードと確認情報も保存する')}</label>
      <p className="ai-help">{t('チェックなしでは基準コードはメモリ上だけで扱い、以前保存した基準コードも次の保存で除きます。共用PCでは保存内容の取り扱いに注意してください。')}</p>
      <button className="quiet-button" onClick={() => { if (confirm(t('この機器のブラウザ保存と画面上の変更を削除し、初期設定に戻しますか？'))) preparation.resetProfile() }}>{t('初期設定に戻す')}</button>
    </>}
  </div></details>
}
