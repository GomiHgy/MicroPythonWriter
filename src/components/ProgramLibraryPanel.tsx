import { useState, type FormEvent } from 'react'
import { boardDefinitions, isBoardId, type BoardId } from '../config/boards'
import { useLocale } from '../i18n'
import { deleteLibraryProgram, loadProgramLibrary, saveLibraryProgram, type SavedProgram } from '../services/programs/ProgramLibrary'
import type { ProjectSettings } from '../services/projects/types'
import { LED_MODELS } from '../services/workshop/WorkshopProfile'
import './ProgramLibraryPanel.css'

export interface ProgramLibraryPanelProps {
  source: string
  settings: ProjectSettings | null
  busy: boolean
  onLoad: (program: SavedProgram) => boolean
  onOpenPreparation: () => void
}

interface SaveForm {
  name: string
  description: string
  boardId: BoardId | ''
  firmwareVersion: string
  ledModel: ProjectSettings['ledModel']
  ledCount: string
  ledPin: string
  maxBrightnessPercent: string
}

/** 保存欄の設定はコードの注記。コード解析・書き換え・機器への送信はしない。 */
export function ProgramLibraryPanel(props: ProgramLibraryPanelProps) {
  const { t, locale } = useLocale()
  const [library, setLibrary] = useState(loadProgramLibrary)
  const [form, setForm] = useState<SaveForm | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; neutral?: boolean; message: string } | null>(null)
  const change = (patch: Partial<SaveForm>) => setForm(previous => previous ? { ...previous, ...patch } : previous)
  const openForm = () => {
    const settings = props.settings
    setForm({ name: '', description: '', boardId: settings?.boardId ?? '', firmwareVersion: settings?.firmwareVersion ?? '', ledModel: settings?.ledModel ?? 'WS2812B', ledCount: String(settings?.ledCount ?? 10), ledPin: String(settings?.ledPin ?? 2), maxBrightnessPercent: String(settings?.maxBrightnessPercent ?? 20) })
    setNotice(null)
  }
  const canSave = !!form?.name.trim() && !!form.description.trim() && !!form.boardId && !!props.source.trim() && !library.error
  const fail = (error: unknown) => setNotice({ error: true, message: error instanceof Error ? error.message : 'プログラムを保存・読み込みできませんでした。内容を確認して、もう一度お試しください。' })
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!canSave || !form || !isBoardId(form.boardId)) return
    if ([form.ledCount, form.ledPin, form.maxBrightnessPercent].some(value => !value.trim())) {
      setNotice({ error: true, message: 'LED数・外部LEDピン・最大輝度を入力してください。' }); return
    }
    try {
      const programs = saveLibraryProgram({ name: form.name.trim(), description: form.description.trim(), source: props.source, settings: { boardId: form.boardId, firmwareVersion: form.firmwareVersion.trim(), ledModel: form.ledModel, ledCount: Number(form.ledCount), ledPin: Number(form.ledPin), maxBrightnessPercent: Number(form.maxBrightnessPercent) } })
      setLibrary({ programs, error: '' })
      setForm(null)
      setNotice({ error: false, message: 'プログラムをこのブラウザに保存しました。機器には送信していません。' })
    } catch (error) { fail(error) }
  }
  const read = (program: SavedProgram) => {
    if (props.busy) return
    try {
      if (props.onLoad(program)) {
        // 明示的な別プログラムの読み込みでは、以前のコード用の注記を持ち越さない。
        setForm(null)
        setNotice({ error: false, message: '保存したプログラムを編集画面に読み込みました。機器には送信していません。' })
      }
      else setNotice({ error: false, neutral: true, message: '読み込みを中止しました。編集中の内容は変更していません。' })
    } catch (error) { fail(error) }
  }
  const remove = (program: SavedProgram) => {
    if (!window.confirm(t('「{name}」を保存リストから削除しますか？編集中のコードや機器のプログラムは消しません。', { name: program.name }))) return
    try {
      const programs = deleteLibraryProgram(program.id)
      setLibrary({ programs, error: '' })
      setNotice({ error: false, message: '保存リストから削除しました。編集中のコードと機器のプログラムは変更していません。' })
    } catch (error) { fail(error) }
  }
  return <section className="program-library panel" aria-labelledby="program-library-title">
    <div className="program-library-heading"><div><p className="eyebrow">{t('あとから続きを作るために')}</p><h2 id="program-library-title">{t('プログラムを保存')}</h2></div>
      <button type="button" className="primary" disabled={!!library.error || !props.source.trim()} onClick={() => { if (!library.error && props.source.trim()) openForm() }}>{t('このプログラムを保存')}</button></div>
    <p className="program-library-note">{t('名前・説明・機器とLEDの設定を付けて、このブラウザに保存します。外部への送信や機器への書き込みは行いません。ブラウザのデータを消すと保存内容も消えます。')}</p>
    {!props.source.trim() && <p>{t('先に編集画面へプログラムを入力してください。')}</p>}
    {library.error && <div className="program-library-feedback error" role="alert"><strong>{t('保存リストを読み込めませんでした。元の保存データは変更していません。')}</strong><p>{t(library.error)}</p><button type="button" className="quiet-button" onClick={() => { setLibrary(loadProgramLibrary()); setNotice(null) }}>{t('保存リストを読み直す')}</button></div>}
    {notice && <p className={`program-library-feedback ${notice.error ? 'error' : notice.neutral ? 'neutral' : 'success'}`} role={notice.error ? 'alert' : 'status'}>{t(notice.message)}</p>}
    {form && <form className="program-library-form" onSubmit={save}>
      <h3>{t('名前と説明を付けて保存')}</h3>
      <label htmlFor="library-name">{t('プログラム名（必須）')}<input id="library-name" required maxLength={64} value={form.name} onChange={event => change({ name: event.target.value })} /></label>
      <label htmlFor="library-description">{t('説明（必須）')}<textarea id="library-description" required maxLength={1000} rows={3} value={form.description} onChange={event => change({ description: event.target.value })} /></label>
      <fieldset><legend>{t('このプログラムで使う機器とLED')}</legend>
        <p className="program-library-note">{t('コードと実際の配線に合う設定を確認してください。ここで設定を変えても、プログラムの内容は自動で変わりません。')}</p>
        {!props.settings && <p className="program-library-note">{t('使う機器を選んでください。LED設定の初期値は仮の値なので、必ず確認してください。')}</p>}
        <div className="program-library-fields">
          <label htmlFor="library-board">{t('使う機器')}<select id="library-board" required value={form.boardId} onChange={event => change({ boardId: event.target.value as SaveForm['boardId'] })}><option value="">{t('機器を選んでください')}</option>{Object.values(boardDefinitions).map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
          <label htmlFor="library-led-model">{t('LEDの型番')}<select id="library-led-model" value={form.ledModel} onChange={event => change({ ledModel: event.target.value as ProjectSettings['ledModel'] })}>{LED_MODELS.map(model => <option key={model}>{model}</option>)}</select></label>
          <label htmlFor="library-led-count">{t('LEDの数')}<input id="library-led-count" type="number" required min={1} max={300} step={1} value={form.ledCount} onChange={event => change({ ledCount: event.target.value })} /></label>
          <label htmlFor="library-led-pin">{t('外部LEDピン（GPIO）')}<input id="library-led-pin" type="number" required min={0} max={form.boardId === 'm5nanoc6' ? 30 : 48} step={1} value={form.ledPin} onChange={event => change({ ledPin: event.target.value })} /></label>
          <label htmlFor="library-brightness">{t('最大輝度（%）')}<input id="library-brightness" type="number" required min={0} max={100} step="any" value={form.maxBrightnessPercent} onChange={event => change({ maxBrightnessPercent: event.target.value })} /></label>
          <label htmlFor="library-firmware">{t('UIFlow2の版（任意）')}<input id="library-firmware" maxLength={200} value={form.firmwareVersion} onChange={event => change({ firmwareVersion: event.target.value })} /></label>
        </div>
      </fieldset>
      <p className="program-library-note">{t('保存ボタンを押した時点の編集コードを、新しい項目として残します。同じ名前でも以前の保存は上書きしません。')}</p>
      <div className="program-library-actions"><button type="submit" className="primary" disabled={!canSave}>{t('名前を付けて保存する')}</button><button type="button" className="quiet-button" onClick={() => { setForm(null); setNotice(null) }}>{t('キャンセル')}</button></div>
    </form>}
    <div className="program-library-list-heading"><h3>{t('保存したプログラム')} <span>({library.programs.length})</span></h3><button type="button" className="quiet-button" onClick={props.onOpenPreparation}>{t('機器・LED設定をAIの準備で確認')}</button></div>
    <p className="program-library-note">{t('一覧の機器・LED設定は保存時のメモです。コードから自動で読み取った値や、実機での動作保証ではありません。')}</p>
    {!library.error && library.programs.length === 0 && <p className="program-library-empty">{t('保存したプログラムはまだありません。「このプログラムを保存」から残せます。')}</p>}
    {props.busy && <p className="program-library-note">{t('機器の処理中は読み込みできません。処理が終わってから選んでください。')}</p>}
    <ul className="program-library-list">{[...library.programs].reverse().map(program => <li key={program.id} className="program-library-item">
      <h4>{program.name}</h4><p className="program-library-description">{program.description}</p>
      <dl><div><dt>{t('使う機器')}</dt><dd>{boardDefinitions[program.settings.boardId].name}</dd></div><div><dt>{t('LEDの型番')}</dt><dd>{program.settings.ledModel}</dd></div><div><dt>{t('LEDの数')}</dt><dd>{t('{count}個', { count: program.settings.ledCount })}</dd></div><div><dt>{t('外部LEDピン（GPIO）')}</dt><dd>GPIO {program.settings.ledPin}</dd></div><div><dt>{t('最大輝度（%）')}</dt><dd>{program.settings.maxBrightnessPercent}%</dd></div><div><dt>{t('UIFlow2の版')}</dt><dd>{program.settings.firmwareVersion || t('未記入')}</dd></div></dl>
      <p className="program-library-date">{t('保存日時')} <time dateTime={program.savedAt}>{new Date(program.savedAt).toLocaleString(locale)}</time></p>
      <div className="program-library-actions"><button type="button" disabled={props.busy} onClick={() => read(program)}>{t('編集画面に読み込む')}</button><button type="button" className="quiet-button" onClick={() => remove(program)}>{t('保存リストから削除')}</button></div>
    </li>)}</ul>
  </section>
}
