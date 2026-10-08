import { useMemo, useState } from 'react'
import { useLocale } from '../i18n'
import { buildStartupDiagnostic } from '../services/micropython/StartupDiagnostic'
import { hasSensitiveAssignments } from '../services/prompt/RepairPromptBuilder'

interface Props { source: string; log: string; disabled: boolean; onSourceChange?(source: string): void }

export function StartupDiagnosticsPanel({ source, log, disabled, onSourceChange }: Props) {
  const { t } = useLocale()
  const [prepared, setPrepared] = useState<{ original: string; diagnostic: string } | null>(null)
  const originalSource = prepared?.diagnostic === source ? prepared.original : source
  const diagnostic = useMemo(() => buildStartupDiagnostic(originalSource), [originalSource])
  const [backupSource, setBackupSource] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const prepare = () => {
    if (disabled || !onSourceChange || !diagnostic || backupSource !== originalSource || source === prepared?.diagnostic) return
    if (!confirm(t('診断版をコード欄へ入れます。編集中のコードは置き換わりますが、機器への書き込み・実行・自動起動設定の変更は行いません。続けますか？'))) return
    onSourceChange(diagnostic.source)
    setPrepared({ original: originalSource, diagnostic: diagnostic.source })
    setNotice('診断版をコード欄へ入れました。まだ機器には書き込んでいません。「実行」を1回押してください。')
  }
  const restore = () => {
    if (disabled || !onSourceChange || !prepared) return
    if (!confirm(t('保管した元コードへ戻します。診断版に加えた編集は失われます。機器のプログラムは変更しません。続けますか？'))) return
    onSourceChange(prepared.original)
    setBackupSource(prepared.original)
    setPrepared(null)
    setNotice('元コードをコード欄へ戻しました。機器のプログラムはまだ変更していません。')
  }
  const save = (contents: string, filename: string) => {
    let url: string | undefined
    let anchor: HTMLAnchorElement | undefined
    try {
      if ((filename.endsWith('.txt') || hasSensitiveAssignments(contents)) && !confirm(t('コードやログにWi-Fi情報・アクセスコードなどが含まれる場合があります。保存後、共有する前に内容を確認してください。保存しますか？'))) return
      url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }))
      anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
      document.body.appendChild(anchor); anchor.click()
      setNotice('ファイル保存を開始しました。ブラウザのダウンロードを確認してください。')
    } catch { setNotice('ファイルを保存できませんでした。ブラウザのダウンロード設定を確認してください。') }
    finally { anchor?.remove(); if (url) { const savedUrl = url; setTimeout(() => URL.revokeObjectURL(savedUrl), 0) } }
  }
  return <details id="program-startup-diagnostics" className="startup-diagnostics" tabIndex={-1}>
    <summary>{t('起動時に再起動する場合の診断（必要なときだけ）')}</summary>
    <p>{t('元の作品を残したまま、初期化の番号とメモリ情報を出す別ファイルを作ります。エディタ・機器・自動起動設定は、この操作では変更しません。')}</p>
    <ol><li>{t('元コードを保存し、ダウンロードできたことを確認する')}</li><li>{t(onSourceChange ? '「診断版をコード欄へ入れる」を押し、コード欄の変更を確認してから「実行」を1回押す' : '診断版を保存し、その全文をコード欄に貼って「実行」を1回押す')}</li><li>{t('起動中は本体ボタン・BLEを操作せず、診断ログを保存する。終わったら元コードに戻す')}</li></ol>
    <p>{t('診断版の実行は機器のmain.pyを上書きします。自動実行がONなら次の電源投入でも診断版が動きます。元コードは機器のバックアップだけに頼らず保管してください。')}</p>
    <div className="prompt-export-actions">
      <button className="quiet-button" disabled={disabled || !originalSource.trim()} onClick={() => save(originalSource, 'main-original.py')}>{t('元コードを保存')}</button>
      {onSourceChange && <button className="primary-button" disabled={disabled || !diagnostic || backupSource !== originalSource || source === prepared?.diagnostic} onClick={prepare}>{t('診断版をコード欄へ入れる')}</button>}
      {onSourceChange && prepared && <button className="quiet-button" disabled={disabled} onClick={restore}>{t('保管した元コードへ戻す')}</button>}
      <button className="quiet-button" disabled={disabled || !diagnostic || backupSource !== originalSource} onClick={() => { if (diagnostic) save(diagnostic.source, 'main-diagnostic.py') }}>{t('診断版を保存')}</button>
      <button className="quiet-button" disabled={!log} onClick={() => save(log, 'MicroPython-diagnostic-log.txt')}>{t('診断ログを保存')}</button>
    </div>
    <label><input type="checkbox" checked={backupSource === originalSource} disabled={disabled || !originalSource.trim()} onChange={event => setBackupSource(event.target.checked ? originalSource : null)} />{t('元コードを別ファイルに保管しました')}</label>
    {!diagnostic && <p>{t('構文エラーや診断用変数との競合があるコードには、自動でログを追加できません。元コードとログを保存して相談してください。')}</p>}
    {diagnostic && <p>{t('診断対象は{count}か所です。一行に複数の処理がある場合など、{skipped}か所は変更せずに残しました。', { count: diagnostic.points, skipped: diagnostic.skipped })}</p>}
    <p>{t('診断はクラッシュの修正ではありません。ログ追加自体でメモリ・タイミングが変わります。診断版が動いても、元作品の問題解消や実機確認済みとは扱いません。')}</p>
    {notice && <p role="status">{t(notice)}</p>}
  </details>
}
