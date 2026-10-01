import { useLocale } from '../i18n'
import { boardDefinitions } from '../config/boards'
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
    <p className="boot-preserve">{t('通常はダウンロードモードにする必要はありません。UIFlow2が動いている状態で操作します。')}</p>
    <ol className="boot-guide">
      <li>{t('本体のボタンを押さずにUSBでパソコンにつなぎ、「USBをつなぐ」を押す。実行中の作品はアプリが停止を試みます。')}</li>
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
    <details className="boot-more boot-troubleshooting" id="boot-troubleshooting">
      <summary>{t('困ったとき：停止できない・フリーズ・再起動を繰り返す')}</summary>
      <h3>{t('1. まず接続と電源を確認')}</h3>
      <ol className="boot-guide">
        <li>{t('M5Burner・UIFlowの画面・ほかのシリアル通信アプリを閉じ、データ通信対応のUSBケーブルと別のUSBポートで試してください。')}</li>
        <li>{t('書き込み・設定変更の処理中は電源を切らないでください。失敗が表示された後に電源を外し、外付けLEDや周辺機器を外して、本体だけをUSBでつないで試してください。')}</li>
        <li>{t('「USBをつなぐ」、接続中のエラーなら「USB操作をやり直す」を試します。操作できる状態になったら、上の「自動実行しない設定に戻す」を押してください。')}</li>
      </ol>
      <p>{t('停止要求を無視するコードや本体のフリーズでは、通常のUSB操作を取り戻せない場合があります。再起動の繰り返しは電源・配線・プログラム・ファームウェアなど原因が複数あり、再書き込みだけで直るとは限りません。')}</p>
      <h3>{t('2. 直らないとき：ダウンロードモードへ')}</h3>
      <div className="boot-download-warning">
        <strong>{t('ダウンロードモードは復旧用の書き込み待機状態です。移行しただけでは、自動実行の設定はOFFになりません。')}</strong>
        <p>{t('この状態ではUIFlow2が動いていないため、このアプリの設定変更・コード読み込みはできません。ファームウェアの再書き込みや消去では、機器内のプログラム・設定が失われる可能性があります。')}</p>
      </div>
      <p>{t('先に編集欄のコードをコピーして手元へ保存し、必要なら「プログラムを保存」も使ってください。ブラウザのコードが機器内の最新版とは限りません。ログを共有するときはWi-Fi情報などの秘密情報を除いてください。機器内にしかない大切なコードがある場合は、消去・再書き込み前に相談してください。')}</p>
      <p>{t('このアプリのUSB接続を切り、ほかのUSB通信アプリも閉じます。電源を外して外付けLED・周辺機器を取り外し、次のうち実際の機種の手順だけを行ってください。')}</p>
      <div className="boot-download-boards">
        <section aria-labelledby="boot-download-nanoc6"><h4 id="boot-download-nanoc6">M5NanoC6</h4>
          <ol className="boot-guide">
            <li>{t('USBと外部電源を外して、本体の電源を切ります。')}</li>
            <li>{t('正面の本体ボタン（GPIO9）を押したまま、USBケーブルをパソコンにつなぎます。')}</li>
            <li>{t('電源が入ったらボタンを離します。ダウンロードモードに入り、書き込み待機になります。')}</li>
          </ol>
          <a href="https://docs.m5stack.com/en/core/NanoC6" target="_blank" rel="noopener noreferrer">{t('{board}の公式手順 ↗', { board: 'M5NanoC6' })}</a>
        </section>
        <section aria-labelledby="boot-download-atoms3lite"><h4 id="boot-download-atoms3lite">AtomS3Lite</h4>
          <ol className="boot-guide">
            <li>{t('本体をUSBケーブルでパソコンにつなぎます。')}</li>
            <li>{t('リセットボタンを約2秒押し続け、内部の緑LEDが点灯したら離します。作品を操作する正面ボタンとは別のボタンです。')}</li>
            <li>{t('離すと緑LEDが消え、ダウンロードモードになります。液晶付きAtomS3など、別機種の手順としては使わないでください。')}</li>
          </ol>
          <a href="https://docs.m5stack.com/en/core/AtomS3-Lite" target="_blank" rel="noopener noreferrer">{t('{board}の公式手順 ↗', { board: 'AtomS3Lite' })}</a>
        </section>
      </div>
      <h3>{t('3. 復旧して、このアプリへ戻る')}</h3>
      <ol className="boot-guide">
        <li>{t('まずM5Burnerの公式手順を確認してください。使用版でConfigure（設定変更）から起動設定だけを戻せる場合は、その方法を優先します。')}</li>
        <li>{t('再書き込みが必要な場合だけ、バックアップとデータ消失の可能性を確認してから、機種別の書き込みページでUIFlow2.0を選び、手動で書き込んでください。USBポートが変わる場合は、接続先を選び直します。')}</li>
        <li>{t('Boot Optionを選べる場合は「Show startup menu and network setup」を選び、「Run main.py directly」は選ばないでください。設定変更や書き込みの完了表示を確認するまで、USBを抜かないでください。')}</li>
        <li>{t('完了後はM5BurnerのUSB接続を切り、本体をボタンを押さずに電源入れ直しして通常起動します。このアプリの「USBをつなぐ」で再接続し、「自動実行 OFF」を確認してください。ONなら上の解除ボタンで変更します。')}</li>
      </ol>
      <div className="boot-reference-links">
        {Object.values(boardDefinitions).map(board => <a key={board.id} href={board.firmwareBurnerUrl} target="_blank" rel="noopener noreferrer">{t('{board}の書き込みページを開く ↗', { board: board.name })}</a>)}
        <a href="https://docs.m5stack.com/en/uiflow2/nanoc6/program" target="_blank" rel="noopener noreferrer">{t('{board}のUIFlow2復旧手順 ↗', { board: 'M5NanoC6' })}</a>
        <a href="https://docs.m5stack.com/en/uiflow2/atoms3lite/program" target="_blank" rel="noopener noreferrer">{t('{board}のUIFlow2復旧手順 ↗', { board: 'AtomS3Lite' })}</a>
      </div>
      <p>{t('案内やリンクを開くだけでは、接続・設定変更・消去・書き込みは行いません。ダウンロードモードに入っただけで書き込まない場合も、ボタンを押さずに電源を入れ直すと通常起動へ戻りますが、元の自動実行設定は残ります。')}</p>
    </details>
    <details className="boot-more"><summary>{t('自動実行を再び使う・USB操作をやり直す')}</summary>
      <p>{t('実物の動作を確認したら、自動実行を再び有効にできます。こちらも保存したプログラムを消しません。')}</p>
      <div className="boot-actions"><button disabled={!canChange || props.bootOption === 0 || changing} onClick={() => { if (canChange && props.bootOption !== 0 && !changing) props.onEnable() }}>{t('電源を入れたら自動で実行する')}</button>
        {props.state !== 'error' && <button className="quiet-button" disabled={!(ready || running) || changing} onClick={() => { if ((ready || running) && !changing) props.onRecover() }}>{t('USB操作をやり直す（起動設定は変えません）')}</button>}
        <button className="quiet-button" disabled={!ready || changing} onClick={() => { if (ready && !changing) props.onReset() }}>{t('↻ 機器を再起動')}</button></div>
    </details>
  </section>
}
