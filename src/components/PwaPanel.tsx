import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocale } from '../i18n'
import { INITIAL_PWA_SNAPSHOT, PwaClient } from '../services/pwa/PwaClient'
import { beginPwaUpdate, endPwaUpdate, getPwaActivity, subscribePwaActivity } from '../services/pwa/PwaActivity'
import './PwaPanel.css'

export interface PwaPanelProps { onBeforeUpdate: () => string | null }

const errors: Record<string, string> = {
  unsupported: 'このブラウザではオフライン保存を利用できません。通常のWebページとして使えます。',
  'insecure-context': 'インストール・オフライン保存はHTTPSの公開ページで使ってください。',
  'registration-failed': 'オフライン用の画面を準備できませんでした。通信を確認して、ページを開き直してください。',
  'install-failed': 'インストール画面を開けませんでした。ブラウザのメニューから追加してください。',
  'update-failed': '更新を確認できませんでした。通信を確認して、もう一度試してください。',
  offline: '今はオフラインです。ネットにつないでから、もう一度試してください。',
  'not-ready': 'オフライン保存の準備中です。少し待ってから、もう一度試してください。',
  'no-update': '更新の準備が変わりました。「更新を確認」を押してください。',
  'multiple-clients': 'このアプリを開いている他のタブ・ウィンドウを閉じてから、更新してください。',
  'request-failed': '処理を完了できませんでした。通信と保存容量を確認して、もう一度試してください。',
  'download-failed': 'シミュレーターを保存できませんでした。通信と保存容量を確認してください。',
  timeout: '処理の応答がありません。通信を確認して、もう一度試してください。',
  disposed: 'ページを開き直してから、もう一度試してください。',
}

export function PwaPanel({ onBeforeUpdate }: PwaPanelProps) {
  const { t } = useLocale()
  const [snapshot, setSnapshot] = useState(INITIAL_PWA_SNAPSHOT)
  const [notice, setNotice] = useState('')
  const client = useRef<PwaClient | null>(null)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const activity = useSyncExternalStore(subscribePwaActivity, getPwaActivity, getPwaActivity)
  useEffect(() => {
    const modal = dialog.current
    if (!modal || !activity.updating) return
    // モーダルはinertな祖先から抜けて表示される。更新待ち中の編集も防ぐ。
    if (typeof modal.showModal === 'function') modal.showModal()
    else modal.open = true
    return () => { if (modal.open) { if (typeof modal.close === 'function') modal.close(); else modal.open = false } }
  }, [activity.updating])
  useEffect(() => {
    const instance = new PwaClient(setSnapshot)
    client.current = instance
    void instance.start()
    return () => { instance.dispose(); if (client.current === instance) client.current = null }
  }, [])

  const update = async () => {
    if (!client.current || !snapshot.updateAvailable || snapshot.busy) return
    if (getPwaActivity().active || getPwaActivity().updating) { setNotice('USB・Bluetoothの接続を切り、シミュレーションを一時停止してから更新してください。'); return }
    if (!confirm(t('アプリを更新して開き直しますか？\n\n編集中のコードは保存を確認してから更新します。ブラウザに保存済みのプログラム・設定は残ります。\n\nブラウザに未保存のAI詳細設定、保存フォームの名前・説明、ログ、シミュレーションの状態は引き継がれません。必要な設定は先に保存し、他のタブ・ウィンドウを閉じてください。'))) return
    if (!beginPwaUpdate()) { setNotice('USB・Bluetoothの接続を切り、シミュレーションを一時停止してから更新してください。'); return }
    try {
      const failure = onBeforeUpdate()
      if (failure) { setNotice(failure); return }
      setNotice('更新しています。ページが開き直るまで待ってください。')
      const applied = await client.current.applyUpdate()
      if (!applied) setNotice('')
    } catch { setNotice('編集中の内容を保存できないため、更新を中止しました。コードをファイルに保存してから、もう一度試してください。') }
    finally { endPwaUpdate() }
  }
  const cacheSimulator = async () => {
    setNotice('')
    if (await client.current?.cacheSimulator()) setNotice('シミュレーターをオフライン用に保存しました。')
  }
  const clearSimulator = async () => {
    setNotice('')
    if (await client.current?.clearSimulator()) setNotice('シミュレーターのオフライン用データを削除しました。コードと保存済みプログラムは残っています。')
  }
  const blocked = activity.active || activity.updating
  const error = snapshot.error ? errors[snapshot.error] ?? errors['request-failed'] : ''
  return <section className="pwa-panel" aria-label={t('アプリとして使う')}>
    <div className="pwa-heading"><span aria-hidden="true">📱</span><strong>{t(snapshot.installed ? 'アプリとして使用中' : 'アプリとして使う')}</strong>
      {snapshot.installAvailable && !snapshot.installed && <button type="button" className="quiet-button" disabled={snapshot.busy} onClick={() => { setNotice(''); void client.current?.install() }}>{t('ホーム画面・パソコンに追加')}</button>}
      {snapshot.offline && <span className="pwa-offline" role="status">{t('オフライン')}</span>}
    </div>
    {snapshot.updateAvailable && <div className="pwa-update" role="status"><strong>{t('新しいバージョンがあります')}</strong><p>{t('勝手に開き直しません。作業が終わってから更新してください。')}</p><button type="button" disabled={snapshot.busy || blocked || snapshot.offline} aria-describedby="pwa-update-help" onClick={update}>{t('更新して開き直す')}</button>
      <p id="pwa-update-help">{t('USB・Bluetoothの接続を切り、シミュレーションを一時停止してから更新してください。')}</p></div>}
    {notice && <p className="pwa-feedback" role="status">{t(notice)}</p>}
    {snapshot.busy && <p role="status">{t('アプリの準備・保存・更新を確認しています…')}</p>}
    {error && import.meta.env.PROD && <p className="pwa-feedback warning" role="status">{t(error)}</p>}
    {import.meta.env.PROD && !snapshot.supported && !error && <p>{t(errors.unsupported)}</p>}
    <details><summary>{t('インストール・オフラインの使い方')}</summary>
      {!import.meta.env.PROD && <p>{t('開発用画面ではオフライン保存を無効にしています。公開ページ、または本番ビルドのプレビューで確認してください。')}</p>}
      <p>{t('追加ボタンがない場合：Chrome・Edgeはブラウザのメニューから「アプリをインストール」。iPhone・iPadのSafariは共有メニューから「ホーム画面に追加」を選んでください。表示名はブラウザにより異なります。')}</p>
      <p>{t(snapshot.ready ? '基本画面をオフライン用に保存しました。次回から、ネットにつながらなくてもコードの編集や保存済みプログラムを使えます。' : '最初はネットにつないで開き、オフライン用の画面が準備されるまで待ってください。')}</p>
      <p>{t('AIへの相談・外部サイト・初回のシミュレーションにはネット接続が必要です。USB・Bluetoothは追加後も対応ブラウザと接続許可が必要です。iPhone・iPadのSafariではUSB・Web Bluetoothを使えません。')}</p>
      <div className="pwa-cache-actions"><strong>{t('シミュレーターのオフライン保存')}</strong><span>{t(snapshot.simulatorReady ? '保存済み' : '未保存（約12MB）')}</span>
        <button type="button" className="quiet-button" disabled={!snapshot.ready || snapshot.busy || snapshot.offline || snapshot.simulatorReady || blocked} onClick={cacheSimulator}>{t('ネットなしでも試せるように保存')}</button>
        {snapshot.simulatorReady && <button type="button" className="quiet-button" disabled={snapshot.busy || blocked} onClick={clearSimulator}>{t('オフライン用データを削除')}</button>}
      </div>
      <p>{t('シミュレーターは希望したときだけ保存します。アプリの更新で必要な版が変わった場合は、もう一度保存してください。ブラウザが保存領域を削除すると、オフライン用データも失われます。')}</p>
      <p>{t('旧版のキャッシュは、開いている画面を壊さないため自動削除しません。削除ボタンは現在のシミュレーター版だけが対象です。サイトデータを全削除する場合は、保存済みプログラムも消えるため、先にファイルへ退避してください。')}</p>
      <button type="button" className="quiet-button" disabled={!snapshot.supported || snapshot.busy || snapshot.offline} onClick={async () => { setNotice(''); if (await client.current?.checkForUpdate()) setNotice('更新を確認しました。新しい版の準備ができると案内が表示されます。') }}>{t('更新を確認')}</button>
      <p>{t('保存内容はこの端末・ブラウザ内だけです。別の端末やブラウザとは自動で共有しません。大切なコードはファイルにも保存してください。')}</p>
    </details>
    <dialog ref={dialog} className="pwa-updating-dialog" aria-label={t('アプリの更新')} onCancel={event => event.preventDefault()}><p role="status">{t('更新しています。ページが開き直るまで待ってください。')}</p></dialog>
  </section>
}
