import { useLocale } from '../i18n'
import type { ProgramFeedback } from '../types/programFeedback'
import './ProgramResult.css'

interface Props {
  feedback: ProgramFeedback
  source: string
  connected: boolean
  onShowError?: () => void
  onRecover?: () => void
}

export function ProgramResult({ feedback, source, connected, onShowError, onRecover }: Props) {
  const { t } = useLocale()
  const { phase, saved, operation, failedAt } = feedback
  const pending = ['preparing', 'writing', 'verifying', 'starting'].includes(phase)
  const failed = phase === 'failed'
  const disconnected = phase === 'disconnected'
  const tone = failed ? 'error' : disconnected ? 'warning' : pending ? 'pending' : 'success'
  let title: string
  let description: string
  switch (phase) {
    case 'preparing':
      title = '書き込みの準備中です'
      description = '動作中のプログラムがあれば停止してから、書き込みます。USBケーブルを抜かずに待ってください。'
      break
    case 'writing':
      title = '機器へ書き込んでいます…'
      description = 'プログラムの転送と保存の確認をしています。USBケーブルを抜かずに待ってください。'
      break
    case 'verifying':
      title = '書き込み成功・実行前の確認中です'
      description = '機器への保存は完了しました。プログラムを実行できるか確認しています。'
      break
    case 'starting':
      title = '書き込み成功・実行を開始しています…'
      description = '機器への保存は完了しました。実行開始の応答を待っています。'
      break
    case 'saved':
      title = '書き込みに成功しました'
      description = 'プログラムを機器に保存しました。今回は保存だけで、実行はしていません。試すときは「実行」を押してください。'
      break
    case 'running':
      title = '書き込み成功・実行を開始しました'
      description = feedback.confirmation === 'startup-marker'
        ? '起動メッセージを受信しました。LEDやボタンが意図どおり動くか、機器を見て確認してください。'
        : '実行開始として扱っていますが、起動メッセージは未確認です。LEDやボタンが意図どおり動くか、機器を見て確認してください。'
      break
    case 'completed':
      title = '書き込み成功・プログラムが終了しました'
      description = 'エラーの報告なく処理が終了しました。LEDが意図どおり光ったかは、機器を見て確認してください。'
      break
    case 'stopped':
      title = '書き込み済み・実行を停止しました'
      description = '停止操作が完了しました。編集して、もう一度「実行」で試せます。'
      break
    case 'failed':
      title = failedAt === 'stop' ? '書き込み済み・停止を確認できませんでした'
        : saved ? '書き込み成功・実行でエラーが発生しました'
          : failedAt === 'prepare' ? '書き込みを開始できませんでした' : '書き込みを完了できませんでした'
      description = saved
        ? '機器への保存はできていますが、操作は正常に完了していません。下のエラー内容を確認してください。'
        : '今回の書き込みは成功していません。エラー内容とUSB接続を確認してから、もう一度試してください。'
      break
    case 'disconnected':
      title = saved ? '書き込み済み・USB接続が切れました' : 'USB切断・書き込み完了を確認できません'
      description = saved
        ? '切断前の保存完了は確認済みです。現在の機器の動作は確認できません。操作を続けるにはUSBをつなぎ直してください。'
        : '保存が完了したか確認できません。USBをつなぎ直してから、もう一度書き込んでください。'
      break
  }
  const writeState = saved ? '成功' : phase === 'preparing' ? '準備中' : phase === 'writing' ? '書き込み中' : failed ? '未完了' : '未確認'
  const runState = operation === 'write' ? '今回は実行しません'
    : phase === 'running' ? '実行開始' : phase === 'completed' ? '終了' : phase === 'stopped' ? '停止済み'
      : disconnected ? '未確認' : failed && saved ? 'エラー' : phase === 'verifying' || phase === 'starting' ? '確認中' : 'まだ実行していません'
  return <section className={`program-result result-${tone}`} aria-label={t('書き込み・実行の結果')} role={failed || disconnected ? 'alert' : 'status'} aria-atomic="true">
    <div className="program-result-heading">
      <span className="program-result-icon" aria-hidden="true">{pending ? '…' : failed || disconnected ? '!' : '✓'}</span>
      <div><p className="program-result-label">{t('今回の操作')}: {t(operation === 'run' ? '▶ 実行' : 'プログラム更新')} <span>#{feedback.id}</span></p><h3>{t(title)}</h3></div>
    </div>
    <p className="program-result-description">{t(description)}</p>
    <dl className="program-result-checks">
      <div className={saved ? 'confirmed' : ''}><dt>{t('機器への書き込み')}</dt><dd>{saved && <span aria-hidden="true">✓ </span>}{t(writeState)}</dd></div>
      <div><dt>{t('プログラムの実行')}</dt><dd>{t(runState)}</dd></div>
    </dl>
    {feedback.message && (failed || disconnected) && <p className="program-result-error">{t('エラー内容')}: {t(feedback.message)}</p>}
    {failed && onShowError && <button className="quiet-button" onClick={onShowError}>{t('エラーの詳細・対処を見る')}</button>}
    {failed && onRecover && <div className="program-result-recovery"><button onClick={onRecover}>{t('再試行の準備')}</button><p>{t('機器を停止・再初期化します。編集中のコードは変えません。準備後に「実行」または「プログラム更新」を押してください。')}</p></div>}
    {source !== feedback.source && <p className="program-result-note">{t('この結果は変更前のコードのものです。現在の編集内容はまだ機器に反映されていません。')}</p>}
    {!connected && !disconnected && <p className="program-result-note">{t('これは切断前の操作結果です。現在の機器の動作は確認できません。')}</p>}
  </section>
}
