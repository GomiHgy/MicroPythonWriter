import { useLocale } from '../i18n'
import type { DeviceState } from '../types'
import type { BootFeedback } from '../types/bootFeedback'
import './BootModePanel.css'

export interface BootModePanelProps {
  state: DeviceState
  bootOption?: number
  supported: boolean
  bootSupported: boolean
  feedback?: BootFeedback | null
  onDisable: () => void
  onEnable: () => void
  onConnect: () => void
  onRecover: () => void
  onReset: () => void
}

export function BootModePanel(props: BootModePanelProps) {
  const { t } = useLocale()
  const disconnected = ['disconnected', 'connection-lost'].includes(props.state)
  const ready = ['raw-repl-ready', 'stopped'].includes(props.state)
  const running = ['running', 'running-no-marker'].includes(props.state)
  const canChange = props.supported && props.bootSupported && (ready || running)
  const confirmed = ready || running
  const feedback = props.feedback
  const changing = feedback?.phase === 'saving' || feedback?.phase === 'resetting'
  const reason = !props.supported ? 'パソコン版ChromeまたはEdgeで開き、機器をUSBで接続してください。'
    : disconnected ? 'まずUSBをつなぐと、今の設定を確認できます。接続しただけでは自動起動の設定は変わりません。'
      : props.state === 'error' ? 'USB操作をやり直してから、もう一度設定してください。'
        : !confirmed ? '機器の処理が終わるまで、ケーブルを抜かずに待ってください。'
          : !props.bootSupported ? 'このファームウェアでは起動設定の変更方法を確認できません。設定は変更せず、プログラムも残します。'
            : props.bootOption === 1 ? '今の設定では、電源を入れても作品を自動実行しません。「実行」で試せます。'
              : '実行中でも押せます。今の動作を停止してから設定を保存します。'
  return <section id="boot-settings" className="boot-mode-panel panel" aria-labelledby="boot-settings-title">
    <div className="boot-mode-heading"><div><p className="eyebrow">{t('持ち出した作品を、また編集したいとき')}</p><h2 id="boot-settings-title">{t('電源を入れた時の動き')}</h2></div>
      <span className={`boot-mode-badge ${confirmed && props.bootOption === 0 ? 'automatic' : ''}`}>{t(confirmed && props.bootOption === 0 ? '自動実行 ON' : confirmed && props.bootOption === 1 ? '自動実行 OFF' : '起動設定は未確認')}</span></div>
    <p>{t('「停止」やUSB接続は、今の動作を止めるだけです。次の電源投入時も止めておきたいときは、下の設定を使います。')}</p>
    <ol className="boot-guide">
      <li>{t('機器をパソコンにUSBでつなぎ、「USBをつなぐ」を押す。')}</li>
      <li>{t('「自動実行しない設定に戻す」を押して、確認画面で続ける。')}</li>
      <li>{t('設定の保存後に機器を再起動します。USBをつなぎ直し、「自動実行 OFF」を確認する。')}</li>
    </ol>
    <p className="boot-preserve">{t('作品のプログラムは消しません。電源を入れた時の設定だけを変えます。')}</p>
    <div className="boot-actions">
      <button className="primary" disabled={!canChange || props.bootOption === 1 || changing} onClick={() => { if (canChange && props.bootOption !== 1 && !changing) props.onDisable() }}>{t('自動実行しない設定に戻す')}</button>
      {disconnected && <button className="quiet-button" disabled={!props.supported} onClick={() => { if (props.supported) props.onConnect() }}>{t('USBで接続して設定を確認')}</button>}
    </div>
    <p className="boot-mode-note">{t(reason)}</p>
    {props.state === 'error' && <div className="boot-recovery"><button className="quiet-button" disabled={changing} onClick={() => { if (!changing) props.onRecover() }}>{t('USB操作をやり直す（起動設定は変えません）')}</button><p>{t('停止要求を受け付けないプログラムや、本体のフリーズでは、USBから設定を変更できないことがあります。ほかのUSB通信アプリを閉じて試し、直らない場合は見守りログを保存して相談してください。')}</p></div>}
    {feedback && <div className={`boot-result ${feedback.phase}`} role={feedback.phase === 'failed' ? 'alert' : 'status'}>
      <strong>{t(feedback.phase === 'saving' ? '起動設定を変更しています…' : feedback.phase === 'resetting' ? '設定を保存しました。再起動を指示しています…' : feedback.phase === 'failed' ? '設定変更の完了を確認できませんでした' : feedback.mode === 1 ? '自動実行しない設定を保存しました' : '自動実行する設定を保存しました')}</strong>
      {feedback.phase === 'saved' && <p>{t('直前にUSB接続した機器への設定結果です。再起動を指示したため、USBをつなぎ直して現在の設定を確認してください。')}</p>}
      {feedback.phase === 'failed' && <><p>{t(feedback.saved ? '設定の保存は確認済みですが、再起動手順は完了していません。USBをつなぎ直して現在の設定を確認してください。' : '現在の設定は未確認です。USB操作をやり直すか、USBをつなぎ直して確認してください。')}</p>{feedback.message && <p>{t(feedback.message)}</p>}</>}
    </div>}
    <details className="boot-more"><summary>{t('自動実行を再び使う・USB操作をやり直す')}</summary>
      <p>{t('実物の動作を確認したら、自動実行を再び有効にできます。こちらも保存したプログラムを消しません。')}</p>
      <div className="boot-actions"><button disabled={!canChange || props.bootOption === 0 || changing} onClick={() => { if (canChange && props.bootOption !== 0 && !changing) props.onEnable() }}>{t('電源を入れたら自動で実行する')}</button>
        {props.state !== 'error' && <button className="quiet-button" disabled={!(ready || running) || changing} onClick={() => { if ((ready || running) && !changing) props.onRecover() }}>{t('USB操作をやり直す（起動設定は変えません）')}</button>}
        <button className="quiet-button" disabled={!ready || changing} onClick={() => { if (ready && !changing) props.onReset() }}>{t('↻ 機器を再起動')}</button></div>
    </details>
  </section>
}
