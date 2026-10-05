import { useLayoutEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n'
import { extractClipboardSource } from '../services/editor/clipboardSource'
import type { WorkshopContext } from '../services/prompt/WorkshopRules'
import { CopyLanguageRecoveryButton } from './SourceLanguageNotice'
import './PasteCodeButton.css'

export interface PasteCodeButtonProps {
  source: string
  onReplace: (source: string) => void
  disabled?: boolean
  active?: boolean
  workshop?: WorkshopContext | null
}

const rejectionMessages = {
  empty: 'コピーしたテキストが空です。Pythonコードをコピーしてから、もう一度押してください。',
  'not-python': 'Pythonコードとして確認できませんでした。AIの説明文ではなく、コード全体をコピーしてください。今のコードは変更していません。',
  ambiguous: '複数のコードや未完了のコード枠が含まれています。使いたいPythonコードを1つだけコピーしてください。今のコードは変更していません。',
  'too-large': 'コピーしたテキストが大きすぎます。100万文字以内のPythonコードをコピーしてください。今のコードは変更していません。',
  arduino: 'Arduino用のC++コードです。MicroPython版をAIに頼んでください。今のコードは変更していません。',
} as const

export function PasteCodeButton({ source, onReplace, disabled = false, active = true, workshop }: PasteCodeButtonProps) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; message: string; manualFallback?: boolean; arduino?: boolean } | null>(null)
  const [undo, setUndo] = useState<{ before: string; inserted: string } | null>(null)
  const pending = useRef(false)
  const mounted = useRef(false)
  const current = useRef({ source, onReplace, disabled, active, revision: 0 })

  useLayoutEffect(() => {
    const previous = current.current
    // 読み取りの許可を待つ間に編集・画面移動があれば、元に戻っても結果を適用しない。
    const changed = previous.source !== source || previous.disabled !== disabled || previous.active !== active
    current.current = { source, onReplace, disabled, active, revision: previous.revision + Number(changed) }
  }, [source, onReplace, disabled, active])
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; current.current.revision += 1 }
  }, [])

  const paste = async () => {
    const before = current.current
    if (pending.current || before.disabled || !before.active) return
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.readText !== 'function') {
      setNotice({ kind: 'error', manualFallback: true, message: 'このブラウザーではボタンから貼り付けできません。下のコード欄を選んで、通常の貼り付けを使ってください。' })
      return
    }
    pending.current = true
    setBusy(true)
    setNotice(null)
    const stillCurrent = () => mounted.current && current.current.revision === before.revision
    try {
      // クリック直後に読み取る。自動読み取りや権限確認でユーザー操作の有効期間を失わない。
      const clipboardText = await navigator.clipboard.readText()
      if (!mounted.current) return
      if (!stillCurrent()) {
        setNotice({ kind: 'info', message: '読み取り中に編集内容や画面の状態が変わったため、貼り付けを中止しました。今のコードは変更していません。' })
        return
      }
      const result = extractClipboardSource(clipboardText)
      if (!result.ok) {
        setNotice({ kind: 'error', message: rejectionMessages[result.reason], arduino: result.reason === 'arduino' })
        return
      }
      if (result.source === before.source) {
        setNotice({ kind: 'info', message: 'コピーしたコードは、今のコードと同じです。変更はありません。' })
        return
      }
      current.current.onReplace(result.source)
      setUndo({ before: before.source, inserted: result.source })
      setNotice({ kind: 'success', message: 'コピーしたコードをすべて貼り付けました。機器への書き込み・実行はしていません。' })
    } catch {
      if (!mounted.current) return
      setNotice({ kind: 'error', manualFallback: stillCurrent(), message: stillCurrent()
        ? 'クリップボードを読み取れませんでした。ブラウザーの許可を確認するか、下のコード欄を選んで通常の貼り付けを使ってください。今のコードは変更していません。'
        : '読み取り中に編集内容や画面の状態が変わったため、貼り付けを中止しました。今のコードは変更していません。' })
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const restore = () => {
    const latest = current.current
    if (!undo || pending.current || latest.disabled || !latest.active || latest.source !== undo.inserted) return
    latest.onReplace(undo.before)
    setUndo(null)
    setNotice({ kind: 'info', message: '貼り付け前のコードに戻しました。機器への書き込み・実行はしていません。' })
  }

  return <div className="paste-code-tools">
    <div className="paste-code-actions">
      <button type="button" disabled={busy || disabled || !active} onClick={paste} aria-busy={busy}>{t(busy ? 'コピーしたテキストを読み取り中…' : 'コピーしたテキストをペースト')}</button>
      {undo && <button type="button" className="quiet-button" disabled={busy || disabled || !active || source !== undo.inserted} onClick={restore}>{t('貼り付け前に戻す')}</button>}
    </div>
    <p className="paste-code-help">{t('コピーしたPythonコードで、下の内容をすべて置き換えます。機器への書き込み・実行はしません。')}</p>
    <details className="paste-code-details"><summary>{t('コードの確認について')}</summary><p>{t('コードの判定は、安全性や実機での動作を保証するものではありません。内容が分からないコードは実行しないでください。')}</p></details>
    {undo && source !== undo.inserted && <p className="paste-code-help">{t('貼り付け後にコードが変わったため、「貼り付け前に戻す」は使えません。')}</p>}
    {notice && <div className={`paste-code-notice ${notice.kind}`} role="status" aria-live="polite" aria-atomic="true"><p>{t(notice.message)}</p>{notice.manualFallback && <p>{t('手動で貼り付けるには、下のコード欄で全選択して貼り付けます（PC: Ctrl+A → Ctrl+V、Mac: ⌘A → ⌘V）。')}</p>}{notice.arduino && <CopyLanguageRecoveryButton workshop={workshop} disabled={disabled || !active} />}</div>}
  </div>
}
