import { useLayoutEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n'
import { isArduinoSource } from '../services/editor/sourceLanguage'
import { buildLanguageRecoveryPrompt } from '../services/prompt/LanguageRecoveryPrompt'
import { copyPreparationPrompt } from '../services/prompt/PromptExport'
import type { WorkshopContext } from '../services/prompt/WorkshopRules'
import './PasteCodeButton.css'

export interface SourceLanguageNoticeProps {
  source: string
  workshop?: WorkshopContext | null
  disabled?: boolean
}

/** 貼り付け拒否時と通常編集時に共用する、同じAIへ戻すコピー導線。 */
export function CopyLanguageRecoveryButton({ workshop, disabled = false }: Pick<SourceLanguageNoticeProps, 'workshop' | 'disabled'>) {
  const { locale, t } = useLocale()
  const prompt = buildLanguageRecoveryPrompt(workshop, locale)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; message: string; prompt: string } | null>(null)
  const pending = useRef(false)
  const mounted = useRef(false)
  const revision = useRef(0)
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useLayoutEffect(() => { revision.current++ }, [prompt])
  const currentNotice = notice?.prompt === prompt ? notice : null

  const copy = async () => {
    if (pending.current || disabled) return
    pending.current = true
    setBusy(true)
    setNotice(null)
    const id = revision.current
    try {
      const result = await copyPreparationPrompt(prompt)
      if (!mounted.current || id !== revision.current) return
      setNotice({ ok: result.ok, prompt, message: result.ok
        ? 'コピーしました。コードを作ったAIとの会話に貼って送る → MicroPython版のコードをコピー → 下のコード欄へ貼り付け → 「実行」の順に進めてください。'
        : result.cancelled
          ? 'コピーをキャンセルしました。依頼文の内容を確認してください。'
          : 'コピーできませんでした。下の依頼文を選択して手動でコピーし、コードを作ったAIとの会話に貼って送ってください。' })
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <div className="language-recovery-tools">
    <button type="button" disabled={busy || disabled} aria-busy={busy} onClick={copy}>{t(busy ? '依頼文をコピー中…' : 'AIにMicroPython版を頼む文章をコピー')}</button>
    {currentNotice && <p role="status" aria-live="polite" aria-atomic="true">{t(currentNotice.message)}</p>}
    <details open={currentNotice?.ok === false}><summary>{t('AIに頼む文章を見る・手動でコピー')}</summary><textarea readOnly value={prompt} rows={9} aria-label={t('MicroPython版への修正依頼文')} /></details>
  </div>
}

export function SourceLanguageNotice({ source, workshop, disabled }: SourceLanguageNoticeProps) {
  const { t } = useLocale()
  if (!isArduinoSource(source)) return null
  return <div className="paste-code-notice error source-language-notice" role="alert">
    <strong>{t('Arduino用のC++コードです')}</strong>
    <p>{t('MicroPythonWriterで使うにはMicroPython版が必要です。コードを作ったAIとの会話に、下の依頼文を貼って送ってください。作品の光り方は維持して書き直すように頼みます。')}</p>
    <CopyLanguageRecoveryButton workshop={workshop} disabled={disabled} />
  </div>
}
