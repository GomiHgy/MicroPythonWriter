// 開発サーバー専用の手動確認画面。index.htmlから参照せず、本番ビルドへ含めない。
// 架空のテストURLは表示検証のみ。すべてのリンク操作を止め、実課金しない。
import { useState } from 'react'
import { SupportPanel } from '../../components/SupportPanel'
import { supportedLocales, useLocale } from '../../i18n'
import type { SupportConfig } from '../../config/support'
import '../../App.css'

export function Fixture() {
  const { locale, setLocale } = useLocale()
  const [github, setGithub] = useState(true), [stripe, setStripe] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const config: SupportConfig = { github: { enabled: github, username: 'GomiHgy' }, stripe: { enabled: stripe, usageConfirmed: true, paymentLinkUrl: 'https://buy.stripe.com/test_localOnly', commercialDisclosureUrl: 'https://example.com/terms' } }
  return <main className="app" onClickCapture={event => { if ((event.target as Element).closest('a')) event.preventDefault() }}>
    <h1>LOCAL TEST ONLY — NO PAYMENTS</h1>
    <p>支援先はテスト用。外部リンクはすべて遷移を抑止しています。</p>
    <label>Language <select aria-label="Language" value={locale} onChange={event => setLocale(event.target.value as typeof locale)}>{supportedLocales.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{' '}
    <button type="button" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }}>Theme</button>
    <p><label><input type="checkbox" checked={github} onChange={event => setGithub(event.target.checked)} />GitHub</label>{' '}<label><input type="checkbox" checked={stripe} onChange={event => setStripe(event.target.checked)} />Stripe</label>{' '}<label><input type="checkbox" checked={blocked} onChange={event => setBlocked(event.target.checked)} />Critical operation</label></p>
    <section className="panel" style={{ minHeight: '50vh' }}>Editor / communication placeholder — unchanged</section>
    <details className="license-notice"><summary>License placeholder</summary></details>
    <footer className="app-version">Version placeholder — preserved</footer>
    <SupportPanel config={config} blockedReason={blocked ? '機器への書き込みや設定変更中は、支援先を開けません。処理が終わるまで、この画面で待ってください。' : undefined} />
  </main>
}
