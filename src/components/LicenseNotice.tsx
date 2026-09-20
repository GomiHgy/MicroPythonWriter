import { useLocale } from '../i18n'
import './LicenseNotice.css'

export function LicenseNotice() {
  const { t } = useLocale()

  return <details className="license-notice">
    <summary>{t('ライセンス・商標')}</summary>
    <div className="license-notice-body">
      <section>
        <h2>{t('非公式ツールについて')}</h2>
        <p>{t('MicroPython Writerは、EdelWorksが開発する非公式のツールです。M5Stack、MicroPythonプロジェクト、Bluetooth SIGの公式製品ではありません。これらの名称の記載は、本ツールに対する各団体の承認・認証を示すものではありません。')}</p>
      </section>
      <section>
        <h2>{t('第三者コンポーネントについて')}</h2>
        <p>{t('本ツールには、第三者が提供するソフトウェア等が含まれています。各コンポーネントには、それぞれのライセンスが適用されます。著作権表示およびライセンス全文は、以下から確認できます。')}</p>
        {import.meta.env.PROD
          ? <p><a href={`${import.meta.env.BASE_URL}third-party-licenses.txt`} target="_blank" rel="noopener noreferrer">{t('第三者ライセンス全文を開く（別タブ）')}</a></p>
          : <p className="license-development-note">{t('開発サーバーではライセンス一覧を生成しません。本番ビルド後のプレビューまたは公開ページで全文を確認できます。')}</p>}
        <p>{t('この第三者ライセンス一覧は、本ツール独自のコード・教材・テンプレートについて、新たに利用許諾を定めるものではありません。')}</p>
      </section>
      <section>
        <h2>{t('商標について')}</h2>
        <p>{t('Bluetoothのワードマークおよびロゴは、Bluetooth SIG, Inc.が所有する登録商標です。その他の製品名・サービス名等は、それぞれの権利者に帰属します。')}</p>
      </section>
    </div>
  </details>
}
