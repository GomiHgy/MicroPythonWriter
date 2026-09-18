import { useState } from 'react'
import { useLocale } from '../i18n'
import { effectIcons, type RemoteButton } from '../services/projects/types'

export function RemoteButtonEditor({ value, onSave }: { value: RemoteButton; onSave: (value: RemoteButton) => void }) {
  const { t } = useLocale()
  const [label, setLabel] = useState(value.label)
  const [icon, setIcon] = useState(value.icon)
  const valid = label.trim().length > 0 && [...label.trim()].length <= 24 && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(label)
  return <form className="remote-button-editor" onSubmit={event => { event.preventDefault(); if (valid) onSave({ ...value, label: label.trim(), icon }) }}>
    <label>{t('表示名')}<input value={label} maxLength={48} onChange={event => setLabel(event.target.value)} /></label>
    <label>{t('アイコン')}<select value={icon} onChange={event => { const next = event.target.value; if (Object.hasOwn(effectIcons, next)) setIcon(next as RemoteButton['icon']) }}>{Object.entries(effectIcons).map(([id, symbol]) => <option key={id} value={id}>{symbol}</option>)}</select></label>
    <button type="submit" disabled={!valid}>{t('このボタン名を保存')}</button>
  </form>
}
