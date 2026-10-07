import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { resolveSupportConfig, supportConfig, type SupportConfig } from '../config/support'
import { useLocale } from '../i18n'
import './SupportPanel.css'

export interface SupportPanelProps {
  /** 公開設定はAppから差し替えず、中央の設定だけを使う。引数はローカルテスト用。 */
  config?: SupportConfig
  blockedReason?: string
}

/** 編集・接続・決済状態には触れず、利用者が開いたときだけ説明する。 */
export function SupportPanel({ config = supportConfig, blockedReason }: SupportPanelProps) {
  const { t } = useLocale()
  const destinations = resolveSupportConfig(config)
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const modal = dialog.current
    // 設定が無効になった場合やアンマウント時にも、フォーカスを置き去りにしない。
    return () => {
      if (modal?.open) modal.close()
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
    }
  }, [destinations.available])

  if (!destinations.available) return null

  const restoreFocus = () => {
    if (previousFocus.current?.isConnected) previousFocus.current.focus()
    previousFocus.current = null
  }
  const open = () => {
    const modal = dialog.current
    if (!modal || modal.open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modal.showModal()
    closeButton.current?.focus()
  }
  const trapTab = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
    const first = controls[0], last = controls.at(-1)
    if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); return }
    const active = document.activeElement
    if (!controls.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }
  const externalLink = (url: string, label: string, icon?: string) => <a
    href={blockedReason ? undefined : url}
    target="_blank" rel="noopener noreferrer"
    aria-disabled={blockedReason ? true : undefined}
    aria-describedby={blockedReason ? `${id}-blocked` : undefined}
    tabIndex={blockedReason ? -1 : undefined}
    aria-label={`${t(label)} — ${t('新しいタブで開きます')}`}
    onClick={event => { if (blockedReason) event.preventDefault() }}
  >{icon && <span aria-hidden="true">{icon} </span>}{t(label)}<small>{t('新しいタブで開きます')}</small></a>

  return <div className="support-panel">
    <button type="button" className="support-entry quiet-button" aria-haspopup="dialog" onClick={open}>
      <span aria-hidden="true">☕ </span>{t('開発を応援する')}
    </button>
    <dialog ref={dialog} className="support-dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={event => { event.preventDefault(); dialog.current?.close() }}
      onClose={restoreFocus} onKeyDown={trapTab}>
      <div className="support-heading">
        <h2 id={`${id}-title`}>{t('開発を応援する')}</h2>
        <button ref={closeButton} type="button" className="quiet-button" aria-label={t('支援の説明を閉じる')} onClick={() => dialog.current?.close()}>{t('閉じる')}</button>
      </div>
      <div id={`${id}-description`}>
        <p>{t('MicroPythonWriterは無料で利用できるツールです。')}<br />{t('役に立ったら、コーヒー1杯分の応援をしてもらえるとうれしいです。')}<br />{t('いただいた支援は、開発・改善・検証に活用します。')}</p>
        <p className="support-optional">{t('支援は任意です。支援の有無で、利用できる機能は変わりません。')}<br />{t('個別サポートや特定の機能の実装をお約束するものではありません。')}</p>
      </div>
      <p>{t('支援の手続きは外部サービスで行います。')}<br />{t('金額・通貨・支払い条件を移動先で確認してください。')}<br />{t('MicroPythonWriterの画面ではカード情報を入力しません。')}</p>
      <p className="support-online-note">{t('支援先を開くにはインターネット接続が必要です。')}</p>
      {blockedReason && <p id={`${id}-blocked`} className="support-blocked" role="status">{t(blockedReason)}</p>}
      <div className="support-destinations">
        {destinations.stripe && externalLink(destinations.stripe.paymentLinkUrl, 'Stripeで応援する', '☕')}
        {destinations.github && externalLink(destinations.github.url, 'GitHub Sponsorsで応援する', '♡')}
      </div>
      {destinations.stripe && <div className="support-disclosure">{externalLink(destinations.stripe.commercialDisclosureUrl, '事業者情報・取引条件')}</div>}
    </dialog>
  </div>
}
