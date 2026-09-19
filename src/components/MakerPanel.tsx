import { useState } from 'react'
import { boardDefinitions, getBoardDefinition, type BoardId } from '../config/boards'
import { useLocale } from '../i18n'
import { LED_MODELS } from '../services/workshop/WorkshopProfile'
import { effectIcons, type ArtworkProject, type ProjectEffect, type ProjectRecipe, type ProjectSettings } from '../services/projects/types'
import type { DeviceState } from '../types'
import './MakerPanel.css'

export interface MakerPanelProps {
  project: ArtworkProject
  onChange: (project: ArtworkProject) => void
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => Promise<void>
  onMarkWorking: () => void
  onRestore: () => void
  onUndoReplacement?: () => void
  canUndoReplacement?: boolean
  onPrepare: () => void
  onOpenProgram: () => void
  onOpenAI: () => void
  onOpenController: () => void
  onConnect: () => void
  onRun: () => void
  onStop: () => void
  onFinish: () => void
  onDownloadCandidate: () => void
  state: DeviceState
  error: string | null
  notice: string
  verifiedStarter: boolean
  canPrepareStarter: boolean
  boardMatches: boolean
  starterReason: string
  sourceMatches: boolean
  canMarkWorking: boolean
  canFinish: boolean
  canConfirmStandalone: boolean
  bootOption?: number
  bootSupported: boolean
}

const stages = ['機器を選ぶ', '配線を確認', '試しに光らせる', '光り方を作る', 'ボタン・無線を試す', '完成して持ち出す'] as const
const kinds: Record<ProjectEffect['kind'], string> = { solid: '一色の光', rainbow: 'にじいろ', chase: '流れる光', twinkle: '星空' }
const icons: Record<ProjectEffect['icon'], string> = { light: 'ライト', star: '星', rainbow: '虹', heart: 'ハート' }
type Progress = { stage: number; settingsKey: string; confirmationKey: string; wired: boolean; seen: boolean; tested: boolean; unplugged: boolean }

export function MakerPanel(props: MakerPanelProps) {
  const { t } = useLocale()
  const { project } = props
  const { settings, recipe, source } = project.draft
  const settingsKey = JSON.stringify(settings)
  const confirmationKey = JSON.stringify([settings, recipe, source])
  const [progress, setProgress] = useState<Progress>(() => ({ stage: 0, settingsKey, confirmationKey, wired: false, seen: false, tested: false, unplugged: false }))
  // Acknowledgments apply to one exact configuration/code, never to a later edit.
  const sameSettings = progress.settingsKey === settingsKey
  const sameCode = progress.confirmationKey === confirmationKey
  // Retire old acknowledgments when inputs change, even if an edit is later undone.
  if (!sameSettings || !sameCode) setProgress({ ...progress, stage: sameSettings ? progress.stage : 0, settingsKey, confirmationKey, wired: sameSettings && progress.wired, seen: false, tested: false, unplugged: false })
  else if (progress.unplugged && !props.canConfirmStandalone) setProgress({ ...progress, unplugged: false })
  const stage = sameSettings ? progress.stage : 0
  const wired = sameSettings && progress.wired
  const seen = sameCode && progress.seen
  const tested = sameCode && progress.tested
  const unplugged = sameCode && props.canConfirmStandalone && progress.unplugged
  const setStep = (patch: Partial<Progress>) => setProgress({ stage, settingsKey, confirmationKey, wired, seen, tested, unplugged, ...patch })
  const board = getBoardDefinition(settings.boardId)
  const disconnected = ['unsupported', 'disconnected', 'connection-lost'].includes(props.state)
  const ready = ['raw-repl-ready', 'running', 'running-no-marker', 'stopped'].includes(props.state)
  const running = ['running', 'running-no-marker'].includes(props.state)
  const canRun = ready && props.canPrepareStarter && props.sourceMatches && wired && props.boardMatches
  const settingsValid = settings.firmwareVersion.trim().length > 0 && Number.isInteger(settings.ledCount) && settings.ledCount >= 1 && settings.ledCount <= 300 && Number.isInteger(settings.ledPin) && settings.ledPin >= 0 && settings.ledPin <= 48 && settings.maxBrightnessPercent >= 1 && settings.maxBrightnessPercent <= 100
  const updateSettings = (patch: Partial<ProjectSettings>) => {
    props.onChange({ ...project, draft: { ...project.draft, settings: { ...settings, ...patch } } })
    setStep({ stage: 0, wired: false, seen: false, tested: false, unplugged: false })
  }
  const updateRecipe = (patch: Partial<ProjectRecipe>) => {
    const next = { ...recipe, ...patch }
    props.onChange({ ...project, draft: { ...project.draft, recipe: next, remoteButtons: [...next.modes.map(mode => ({ kind: 'mode' as const, id: mode.id, label: mode.label, icon: mode.icon })), ...project.draft.remoteButtons.filter(button => button.kind === 'action')] } })
    setStep({ seen: false, tested: false, unplugged: false })
  }
  const updateMode = (id: string, patch: Partial<ProjectEffect>) => updateRecipe({ modes: recipe.modes.map(mode => mode.id === id ? { ...mode, ...patch } : mode) })
  const addMode = () => {
    if (recipe.modes.length >= 8) return
    let index = 1
    while (recipe.modes.some(mode => mode.id === `M${index}`)) index++
    updateRecipe({ modes: [...recipe.modes, { id: `M${index}`, label: t('光り方 {number}', { number: index }), icon: 'star', kind: 'solid', color: '#ffcc00', speed: 50, repeats: 0, endState: 'hold' }] })
  }
  const current = recipe.modes[0]
  const primaryRun = () => {
    if (!props.canPrepareStarter) return
    if (!props.sourceMatches) return props.onPrepare()
    if (disconnected) { if (props.state !== 'unsupported') props.onConnect(); return }
    if (canRun) props.onRun()
  }
  const runLabel = !props.sourceMatches ? '試すコードを準備' : disconnected ? 'USBでつなぐ' : props.verifiedStarter ? '機器で実行する' : '未検証コードを機器で試す'
  const runDisabled = !props.canPrepareStarter || (props.sourceMatches && (disconnected ? props.state === 'unsupported' : !canRun))
  const starterGuidance = <>
    {!props.canPrepareStarter ? <div className="maker-blocker" role="status"><strong>{t('設定を見直してからコードを準備してください')}</strong><p>{t(props.starterReason)}</p></div> : !props.verifiedStarter && <div className="maker-blocker" role="status"><strong>{t('この組み合わせの入門プログラムは実機未確認です')}</strong><p>{t('コードの準備・表示・保存は、USB接続なしでできます。機器で試す前に、未検証であることと配線・設定を確認します。')}</p><p>{t('機器で試して動いた場合も、提供側の実機確認済みプログラムにはなりません。')}</p></div>}
    {!disconnected && !props.boardMatches && <p className="maker-blocker" role="status">{t('接続した機器と、選択した機器が違います。正しい機器につなぎ直すか、最初のステップで機器を選び直し、配線を確認してください。')}</p>}
  </>

  return <section className="maker-panel" aria-labelledby="maker-title">
    <header className="maker-intro"><div><p className="eyebrow">{t('コードより先に、作品のアイデアから')}</p><h2 id="maker-title">{t('作品をつくる')}</h2><p>{t('機器の準備から、持ち出せる作品になるまで。一つずつ進めよう。')}</p></div><span className="small-badge">{project.working ? t('動作OK版を保存済み') : t('編集中・動作未確認')}</span></header>
    <ol className="maker-progress" aria-label={t('作品づくりの手順')}>{stages.map((name, index) => <li key={name} aria-current={stage === index ? 'step' : undefined}><span>{index + 1}</span>{t(name)}</li>)}</ol>
    {props.notice && <p className="notice" role="status">{t(props.notice)}</p>}
    {props.error && <p className="notice warning" role="alert">{t(props.error)}</p>}
    <div className="panel maker-step"><p className="eyebrow">{t('ステップ {number} / 6', { number: stage + 1 })}</p><h3>{t(stages[stage])}</h3>
      {stage === 0 && <>
        <p>{t('使う機器と、外付けLEDの情報を選ぼう。分からない項目は、キットの説明や作成者に確認してね。')}</p>
        <div className="maker-fields">
          <label>{t('使う機器')}<select id="maker-board" value={settings.boardId} onChange={event => updateSettings({ boardId: event.target.value as BoardId })}>{Object.values(boardDefinitions).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{t('UIFlow2ファームウェアの版')}<input id="maker-firmware" value={settings.firmwareVersion} placeholder={t('機器に書き込んだ版を入力')} maxLength={80} onChange={event => updateSettings({ firmwareVersion: event.target.value })} /></label>
          <label>{t('LEDの型番')}<select id="maker-led-model" value={settings.ledModel} onChange={event => updateSettings({ ledModel: event.target.value as ProjectSettings['ledModel'] })}>{LED_MODELS.map(model => <option key={model}>{model}</option>)}</select></label>
          <label>{t('LEDの数')}<input id="maker-led-count" type="number" min="1" max="300" value={settings.ledCount} onChange={event => updateSettings({ ledCount: Number(event.target.value) })} /></label>
          <label>{t('外付けLEDの信号ピン')}<input id="maker-led-pin" type="number" min="0" max="48" value={settings.ledPin} onChange={event => updateSettings({ ledPin: Number(event.target.value) })} /></label>
          <label>{t('最大の明るさ（%）')}<input id="maker-brightness" type="number" min="1" max="100" value={settings.maxBrightnessPercent} onChange={event => updateSettings({ maxBrightnessPercent: Number(event.target.value) })} /></label>
        </div>
        <p className="maker-note">{t('最初はLED 10個・明るさ20%・信号ピン2が目安。大きな明るさや多数のLEDには、適切な電源が必要です。')}</p>
        <details><summary>{t('UIFlow2がまだ入っていない？')}</summary><p>{t('M5Burnerで選択した機器の「UIFlow2.0」を書き込み、その版を上に入力してください。書き込みは機器内のプログラムを消す場合があります。')}</p><a href={board.firmwareBurnerUrl} target="_blank" rel="noreferrer">{t('{board} のファームウェアを準備', { board: board.name })}</a></details>
        <button className="primary maker-next" disabled={!settingsValid} onClick={() => { if (settingsValid) setStep({ stage: 1 }) }}>{t('次へ：配線を確認')}</button>
      </>}
      {stage === 1 && <>
        <p>{t('電源を外した状態で、LEDやキットの説明と照らし合わせてください。')}</p>
        <dl className="maker-wiring"><div><dt>{t('LEDの信号入力（DIN）')}</dt><dd>GPIO {settings.ledPin}</dd></div><div><dt>{t('ボタン（内蔵）')}</dt><dd>GPIO {board.buttonPin}</dd></div><div><dt>{t('内蔵LEDと外付けLEDは別です')}</dt><dd>GPIO {board.rgbPin}{board.rgbPowerPin !== null && ` / EN ${board.rgbPowerPin}`}</dd></div></dl>
        <ul><li>{t('DINとDOUTの向きを確認。電源・GND・信号線を取り違えないでください。')}</li><li>{t('電源の電圧・容量はLEDの説明で確認し、機器とLEDのGNDを共通にします。不明な配線のまま通電しないでください。')}</li></ul>
        <label className="maker-check"><input id="maker-wired" type="checkbox" checked={wired} onChange={event => setStep({ wired: event.target.checked, seen: false, tested: false, unplugged: false })} />{t('電源を外して配線・電源容量・信号ピンを確認した')}</label>
        <button className="primary maker-next" disabled={!wired} onClick={() => { if (wired) setStep({ stage: 2 }) }}>{t('次へ：試しに光らせる')}</button>
      </>}
      {stage === 2 && <>
        <p>{t('まずは機器で光を確認。コードの準備・接続・実行は、それぞれボタンを押したときだけ行います。')}</p>
        {starterGuidance}
        <button className="primary maker-next" disabled={runDisabled} onClick={primaryRun}>{t(runLabel)}</button>
        {running && <p role="status">{t('プログラムは実行中です。実際に光ったかは、機器を見て確認してください。')}</p>}
        <label className="maker-check"><input id="maker-seen" type="checkbox" checked={seen} disabled={!props.canMarkWorking} onChange={event => { if (props.canMarkWorking) setStep({ seen: event.target.checked }) }} />{t('この設定・プログラムで、実際のLEDが意図どおり光った')}</label>
        {seen ? <button onClick={() => setStep({ stage: 3 })}>{t('次へ：光り方を作る')}</button> : <button className="text-button" onClick={() => setStep({ stage: 3 })}>{t('実機確認は後で行い、先に光り方を作る')}</button>}
      </>}
      {stage === 3 && <>
        <p>{t('よく使う光り方を選んで組み合わせよう。ここを変更しても、機器の動作はまだ変わりません。')}</p>
        <div className="maker-presets" role="group" aria-label={t('入門プログラムを選ぶ')}>
          <button onClick={() => updateRecipe({ shortPress: 'next', longPress: 'off', whileHeld: false, wireless: false, modes: [{ id: 'M1', label: t('ピンク'), icon: 'heart', kind: 'solid', color: '#ff4080', speed: 50, repeats: 0, endState: 'hold' }, { id: 'M2', label: t('ブルー'), icon: 'light', kind: 'solid', color: '#0080ff', speed: 50, repeats: 0, endState: 'hold' }] })}>{t('ボタンで色を切り替える')}</button>
          <button onClick={() => updateRecipe({ shortPress: 'none', longPress: 'none', whileHeld: true, wireless: false })}>{t('押している間だけ光る')}</button>
          <button onClick={() => updateRecipe({ shortPress: 'next', longPress: 'off', whileHeld: false, wireless: true })}>{t('スマホで光り方を変える')}</button>
        </div>
        <div className="maker-preview" role="img" aria-label={t('光り方のイメージ。実機の状態ではありません。')}><div aria-hidden="true">{Array.from({ length: Math.min(settings.ledCount, 16) }, (_, index) => <span key={index} style={{ backgroundColor: current?.kind === 'rainbow' ? `hsl(${index * 30} 90% 55%)` : current?.color ?? '#ffcc00' }} />)}</div><p>{t('画面のイメージです。動き・配線・実機での色や明るさを保証するものではありません。')}</p></div>
        {recipe.modes.map((mode, index) => <fieldset className="maker-mode" key={mode.id}><legend>{t('光り方 {number}', { number: index + 1 })}</legend><div className="maker-fields">
          <label>{t('名前')}<input aria-label={t('光り方 {number} の名前', { number: index + 1 })} value={mode.label} maxLength={24} onChange={event => updateMode(mode.id, { label: event.target.value })} /></label>
          <label>{t('アイコン')}<select value={mode.icon} onChange={event => updateMode(mode.id, { icon: event.target.value as ProjectEffect['icon'] })}>{Object.entries(icons).map(([icon, label]) => <option key={icon} value={icon}>{effectIcons[icon as ProjectEffect['icon']]} {t(label)}</option>)}</select></label>
          <label>{t('光り方')}<select value={mode.kind} onChange={event => updateMode(mode.id, { kind: event.target.value as ProjectEffect['kind'] })}>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{t(label)}</option>)}</select></label>
          <label>{t('色')}<input type="color" value={mode.color} onChange={event => updateMode(mode.id, { color: event.target.value })} /></label>
          <label>{t('速さ')}<input type="range" min="0" max="100" value={mode.speed} onChange={event => updateMode(mode.id, { speed: Number(event.target.value) })} /></label>
          <label>{t('繰り返し（0はずっと）')}<input type="number" min="0" max="100" value={mode.repeats} onChange={event => updateMode(mode.id, { repeats: Number(event.target.value) })} /></label>
          <label>{t('終わったら')}<select value={mode.endState} onChange={event => updateMode(mode.id, { endState: event.target.value as ProjectEffect['endState'] })}><option value="hold">{t('最後の光を残す')}</option><option value="off">{t('消灯する')}</option></select></label>
        </div><button disabled={recipe.modes.length <= 1} onClick={() => { if (recipe.modes.length > 1) updateRecipe({ modes: recipe.modes.filter(item => item.id !== mode.id) }) }}>{t('この光り方を削除')}</button></fieldset>)}
        <button disabled={recipe.modes.length >= 8} onClick={addMode}>{t('光り方を追加（最大8つ）')}</button>
        <button className="primary maker-next" disabled={recipe.modes.some(mode => !mode.label.trim())} onClick={() => { if (recipe.modes.every(mode => mode.label.trim())) setStep({ stage: 4 }) }}>{t('次へ：操作を選ぶ')}</button>
      </>}
      {stage === 4 && <>
        <div className="maker-fields"><label>{t('短く押したら')}<select value={recipe.shortPress} disabled={recipe.whileHeld} onChange={event => updateRecipe({ shortPress: event.target.value as ProjectRecipe['shortPress'] })}><option value="next">{t('次の光り方にする')}</option><option value="toggle">{t('点灯・消灯を切り替える')}</option><option value="none">{t('何もしない')}</option></select></label><label>{t('長く押したら')}<select value={recipe.longPress} disabled={recipe.whileHeld} onChange={event => updateRecipe({ longPress: event.target.value as ProjectRecipe['longPress'] })}><option value="off">{t('消灯する')}</option><option value="none">{t('何もしない')}</option></select></label></div>
        <label className="maker-check"><input id="maker-held" type="checkbox" checked={recipe.whileHeld} onChange={event => updateRecipe({ whileHeld: event.target.checked })} />{t('押している間だけ光る（短押し・長押しより優先）')}</label>
        <label className="maker-check"><input id="maker-wireless" type="checkbox" checked={recipe.wireless} onChange={event => updateRecipe({ wireless: event.target.checked })} />{t('Bluetoothリモコンも使う')}</label>
        {recipe.wireless && <p className="maker-note">{t('無線にはNanoLED v2対応プログラムと、Web Bluetooth対応環境が必要です。実機未検証の場合は、接続・状態受信・操作も機器で確かめてください。')}</p>}
        {starterGuidance}
        {!props.sourceMatches && <p className="maker-note">{t('現在の編集コードは、この画面の設定から作るコードと異なります。既存コードを使う場合は「プログラム」で実行し、実際の動きを確認してください。')}</p>}
        <p>{t('設定を変えたらコードを準備し直して実行します。作成しただけでは、機器は更新されません。')}</p>
        <button className="primary maker-next" disabled={runDisabled} onClick={primaryRun}>{t(runLabel)}</button>
        <label className="maker-check"><input id="maker-tested" type="checkbox" checked={tested} disabled={!props.canMarkWorking} onChange={event => { if (props.canMarkWorking) setStep({ tested: event.target.checked }) }} />{t('今のプログラムで、使いたいボタン・無線の操作を実機で確認した')}</label>
        <button disabled={!tested} onClick={() => { if (tested) setStep({ stage: 5 }) }}>{t('次へ：完成して持ち出す')}</button>
        {recipe.wireless && <button className="text-button" onClick={props.onOpenController}>{t('無線リモコンを開く')}</button>}
      </>}
      {stage === 5 && <>
        <p>{t('持ち出す前に、今の動作を保存し、電源を入れ直しても動くことを確かめよう。')}</p>
        <button disabled={!props.canMarkWorking || !tested} onClick={() => { if (props.canMarkWorking && tested) props.onMarkWorking() }}>{t('今の版を「動作OK」として保存')}</button>
        <p>{t('保存済みのプログラムを自動起動に設定します。機器は再起動します。通常の「実行」とは別の操作です。')}</p>
        {!props.bootSupported && !props.canConfirmStandalone && <p className="maker-note">{t('この機器では自動起動の設定方法を確認できていません。プログラム画面の機器情報を確認してください。')}</p>}
        <button className="primary maker-next" disabled={!tested || (!running && (!props.canFinish || !props.bootSupported))} onClick={() => { if (!tested) return; if (running) props.onStop(); else if (props.canFinish && props.bootSupported) props.onFinish() }}>{t(running ? '持ち出す準備のため停止' : '自動起動を設定する')}</button>
        <p>{props.canConfirmStandalone ? t('自動起動の設定を確認しました。PCから外した動作確認は、まだ別途必要です。') : t('自動起動の設定完了を確認してから、PCを外して確認してください。')}</p>
        <label className="maker-check"><input id="maker-standalone" type="checkbox" checked={unplugged} disabled={!props.canConfirmStandalone} onChange={event => { if (props.canConfirmStandalone) setStep({ unplugged: event.target.checked }) }} />{t('安全な電源で、PCを外して電源を入れ直し、作品の動作を確認した')}</label>
        {unplugged && <p role="status">{t('持ち出し確認のチェックを記録しました。これは利用者による確認で、提供側の検証証明ではありません。')}</p>}
      </>}
      <div className="maker-secondary">{stage > 0 && <button className="text-button" onClick={() => setStep({ stage: stage - 1 })}>{t('一つ前へ')}</button>}{running && <button onClick={props.onStop}>{t('プログラムを停止')}</button>}<button className="text-button" onClick={props.onOpenProgram}>{t('コード・通信ログを見る')}</button></div>
    </div>
    <section className="panel maker-library" aria-labelledby="maker-library-title">
      <h3 id="maker-library-title">{t('作品を保存・戻す')}</h3>
      <label>{t('作品名')}<input id="maker-name" value={project.name} maxLength={64} onChange={event => props.onChange({ ...project, name: event.target.value })} /></label>
      <p className="maker-note">{t('編集中のコード・機器設定・操作ボタンをまとめて保存します。ブラウザの保存だけでなく、ファイルでも残しておくと安心です。')}</p>
      <div className="maker-library-buttons"><button onClick={props.onSave}>{t('作品を保存')}</button><button onClick={props.onExport}>{t('作品ファイルを書き出す')}</button><label className="maker-import">{t('作品ファイルを読み込む')}<input aria-label={t('作品ファイルを読み込む')} type="file" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void props.onImport(file) }} /></label><button disabled={!project.working} onClick={() => { if (project.working) props.onRestore() }}>{t('前の動作OK版に戻す')}</button></div>
      <p>{project.working ? t('保存した動作OK版と、今の編集中の版は別に保持しています。') : t('動作OK版はまだありません。実機で確認してから保存してください。')}</p>
      {props.canUndoReplacement && <button onClick={props.onUndoReplacement}>{t('直前の読み込み・復元を取り消す')}</button>}
    </section>
    <details className="panel maker-help"><summary>{t('うまくいかないとき')}</summary><h4>{t('機器が見つからない')}</h4><p>{t('電源とデータ通信対応のUSBケーブルを確認。他のアプリが機器につながっていたら接続を切り、もう一度つないでください。')}</p><h4>{t('つながったが状態が届かない')}</h4><p>{t('無線対応プログラムが動いているか確認。リモコンの「状態をもう一度受け取る」を試し、戻らなければ接続し直してください。')}</p><h4>{t('実行中なのに光らない')}</h4><p>{t('電源を外し、配線・LEDの向き・LED数・信号ピン・電源容量を確認。実行開始の表示だけでは、点灯した証拠にはなりません。')}</p><button onClick={props.onOpenAI}>{t('AIで自分好みに広げる')}</button></details>
    <details className="panel maker-help"><summary>{t('コードをファイルで確認する')}</summary><p>{t('生成コードを保存できます。ダウンロードだけでは機器に書き込みません。実機未検証のコードは、確認済みとして扱わないでください。')}</p><button disabled={!props.canPrepareStarter} onClick={() => { if (props.canPrepareStarter) props.onDownloadCandidate() }}>{t('生成コードをダウンロード')}</button></details>
  </section>
}
