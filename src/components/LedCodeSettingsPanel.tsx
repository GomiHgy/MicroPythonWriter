import { useMemo, useState } from 'react'
import { useLocale } from '../i18n'
import { applyLedCodeSettings, readLedCodeSettings, type SettingKey } from '../services/editor/ledCodeSettings'
import './LedCodeSettingsPanel.css'

const reasons = {
  missing: '対応する設定名が見つかりません。',
  ambiguous: '複数の定義があるため、自動変更できません。',
  unsupported: '計算式や処理内の設定は自動変更できません。トップレベルの数値設定に対応しています。',
  syntax: 'コードを解析できません。構文やコードのサイズを確認してください。',
} as const

export function LedCodeSettingsPanel({ source, onReplace, disabled = false }: { source: string; onReplace: (source: string) => void; disabled?: boolean }) {
  const { t } = useLocale()
  const settings = useMemo(() => readLedCodeSettings(source), [source])
  const [draft, setDraft] = useState<{ source: string; count: string; brightness: string } | null>(null)
  const [applied, setApplied] = useState<{ before: string; after: string } | null>(null)
  if (draft && draft.source !== source) setDraft(null)
  // コードを貼り付け・読込・手編集したら古い入力値を使わず、最新コードから読み直す。
  const values = draft?.source === source ? draft : { source, count: String(settings.count.setting?.value ?? ''), brightness: String(settings.brightness.setting?.value ?? '') }
  const changes: Partial<Record<SettingKey, number>> = {}
  for (const key of ['count', 'brightness'] as const) if (settings[key].setting) changes[key] = values[key].trim() ? Number(values[key]) : NaN
  const updated = applyLedCodeSettings(source, changes)
  const invalid = updated === null
  const changed = updated !== null && updated !== source

  return <section className="led-code-settings" aria-label={t('コード内のLED設定')}>
    <h3>{t('コード内のLED設定')}</h3>
    <p>{t('コードから読み取った値を変更できます。反映後、上の「実行」で機器を動かしてください。')}</p>
    <div className="led-code-fields">
      {(['count', 'brightness'] as const).map(key => {
        const result = settings[key]
        const id = `code-led-${key}`
        return <div key={key}>
          <label htmlFor={id}>{t(key === 'count' ? 'LED数（個）' : '最大輝度（%）')}</label>
          <input id={id} type="number" min={key === 'count' ? 1 : 0} max={key === 'brightness' ? 100 : undefined} step={key === 'count' ? 1 : 'any'} value={values[key]} disabled={disabled || !result.setting} aria-describedby={`${id}-help`} onChange={event => setDraft({ ...values, [key]: event.target.value })} />
          <small id={`${id}-help`}>{result.setting ? `${result.setting.name} → ${result.setting.value}${key === 'brightness' ? '%' : ''}` : t(reasons[result.reason])}</small>
        </div>
      })}
    </div>
    {invalid && <p role="alert">{t('LED数は1以上の整数、最大輝度は0〜100%で入力してください。')}</p>}
    <div className="led-code-actions">
      <button type="button" disabled={disabled || !changed || invalid} onClick={() => {
        if (disabled || !changed || updated === null) return
        setApplied({ before: source, after: updated }); onReplace(updated)
      }}>{t('コードに反映')}</button>
      {applied?.after === source && <button type="button" className="quiet-button" disabled={disabled} onClick={() => {
        if (disabled) return
        onReplace(applied.before); setApplied(null); setDraft(null)
      }}>{t('設定変更を元に戻す')}</button>}
    </div>
    {applied?.after === source && <p role="status">{t('コードに反映しました。機器への書き込み・実行はまだ行っていません。')}</p>}
    <details><summary>{t('読み取れる設定と注意点')}</summary><p>{t('LED_COUNT / NUM_LEDS と MAX_BRIGHTNESS（0〜1）/ MAX_BRIGHTNESS_PERCENT（0〜100）の単純な数値代入に対応します。各項目の定義が1つの場合のみ変更できます。')}</p><p>{t('最大輝度を上げると消費電流が増えます。配線・電源を確認してください。AIの準備やシミュレーターの表示設定は変更しません。シミュレーションにはリセット後に反映されます。')}</p></details>
  </section>
}
