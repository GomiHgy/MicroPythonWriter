import { useMemo, useRef, useState } from 'react'
import { useLocale } from '../i18n'
import { restoreLedSettings, saveLedSettings, ledSettingsKey, type LedSettings } from '../services/workshop/LedSettings'
import { workshopPresets } from '../config/workshops'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile, MAX_BASELINE_CODE_LENGTH, validateWorkshopProfile, type WorkshopProfile } from '../services/workshop/WorkshopProfile'
import { removeWorkshopProfile, restoreWorkshopProfile, storeWorkshopProfile } from '../services/workshop/WorkshopStorage'

function initialSettings() {
  const loaded = workshopPresets.map(preset => {
    const saved = restoreWorkshopProfile(preset)
    const led = restoreLedSettings(preset, saved.profile)
    return { preset, restored: { profile: led.profile, notice: saved.notice || led.notice } }
  })
  return {
    profiles: loaded.map(({ preset, restored }) => ({ id: preset.id, profile: restored.profile })),
    notice: loaded.find(({ restored }) => restored.notice)?.restored.notice ?? '',
  }
}

export function useWorkshopPreparation() {
  const { locale } = useLocale()
  const [settings, setSettings] = useState(initialSettings)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WorkshopProfile | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const editGeneration = useRef(0)
  const selectedProfile = settings.profiles.find(preset => preset.id === selectedId)?.profile ?? null
  const context = useMemo(() => selectedProfile ? createWorkshopContext(selectedProfile, locale) : null, [selectedProfile, locale])
  const prompt = useMemo(() => context ? buildStartPrompt(context) : '', [context])
  const draftErrors = useMemo(() => draft ? validateWorkshopProfile(draft) : [], [draft])
  const hasPendingChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(selectedProfile), [draft, selectedProfile])

  function setNotice(notice: string) { setSettings(previous => ({ ...previous, notice })) }

  function editLedSettings(patch: Partial<LedSettings>) {
    const preset = workshopPresets.find(item => item.id === selectedId)
    if (!preset || !selectedProfile || !draft || isImporting) return
    if (Object.entries(patch).every(([key, value]) => selectedProfile[key as keyof LedSettings] === value)) return
    const next = { ...selectedProfile, ...patch, baseline: { ...selectedProfile.baseline, verification: null } }
    const notice = saveLedSettings(preset, next)
    setSettings(previous => ({ profiles: previous.profiles.map(item => item.id === selectedId ? { ...item, profile: next } : item), notice }))
    setDraft(previous => previous ? { ...previous, ...patch, baseline: { ...previous.baseline, verification: null } } : previous)
  }

  function selectProfile(id: string | null) {
    const next = settings.profiles.find(preset => preset.id === id)
    editGeneration.current++
    setIsImporting(false)
    setSelectedId(next?.id ?? null)
    setDraft(next ? cloneWorkshopProfile(next.profile) : null)
  }

  function editDraft(patch: Partial<WorkshopProfile>) {
    editGeneration.current++
    setIsImporting(false)
    setDraft(previous => {
      if (!previous) return previous
      // 機器の変更はプリセット選択で行う。別機器の配線・実機確認を混ぜない。
      const next = { ...previous, ...patch, materialId: previous.materialId, revision: previous.revision, boardId: previous.boardId }
      if (next.firmwareVersion !== previous.firmwareVersion || next.baseline.code !== previous.baseline.code) next.baseline = { ...next.baseline, verification: null }
      return next
    })
    setNotice('変更はまだ適用されていません。確認後に「設定を適用」を押してください。')
  }

  function applyDraft() {
    if (isImporting) { setNotice('基準コードを読み込み中です。完了してから設定を適用してください。'); return false }
    if (!draft || !selectedId) return false
    if (draftErrors.length) { setNotice('設定を適用できません。講師用設定の確認項目を直してください。'); return false }
    setSettings(previous => ({ profiles: previous.profiles.map(preset => preset.id === selectedId ? { ...preset, profile: cloneWorkshopProfile(draft) } : preset), notice: 'この画面に設定を適用しました。再読み込み後も使う場合は、ブラウザに保存してください。' }))
    return true
  }

  function saveDraft(persistBaseline: boolean) {
    if (!draft || !applyDraft()) return
    const preset = workshopPresets.find(item => item.id === selectedId)
    if (!preset) return
    const failure = storeWorkshopProfile(preset, draft, persistBaseline)
    setNotice(failure || (persistBaseline ? '設定と基準コードを、このブラウザに保存しました。' : '設定をこのブラウザに保存しました。基準コードは保存していません。'))
  }

  function confirmBaseline(confirmedBy: string, nanoLedV1: boolean) {
    if (isImporting) { setNotice('基準コードを読み込み中です。完了してから確認してください。'); return }
    if (!draft?.baseline.code.trim() || !draft.firmwareVersion?.trim() || !confirmedBy.trim() || confirmedBy.trim().length > 200 || /\{\{|\}\}/.test(confirmedBy + draft.firmwareVersion)) {
      setNotice('基準コード・対象UIFlow2版・確認した講師名を入力してください。')
      return
    }
    editDraft({ baseline: { code: draft.baseline.code, verification: { code: draft.baseline.code, firmwareVersion: draft.firmwareVersion, boardId: draft.boardId, confirmedBy: confirmedBy.trim(), confirmedAt: new Date().toISOString(), nanoLedV1 } } })
  }

  async function importBaseline(file: Pick<File, 'name' | 'size' | 'text'>) {
    const generation = ++editGeneration.current
    setIsImporting(false)
    if (!draft) return
    if (!/\.py$/i.test(file.name) || file.size > MAX_BASELINE_CODE_LENGTH * 4) { setNotice('100,000文字以内の .py ファイルを選んでください。ファイルは実行されません。'); return }
    setIsImporting(true)
    setNotice('基準コードを読み込み中です。完了するまでコピー・ファイル保存・設定適用を待ってください。')
    try {
      const code = await file.text()
      if (generation !== editGeneration.current) return
      if (code.length > MAX_BASELINE_CODE_LENGTH) { setNotice('基準コードは100,000文字以内にしてください。'); return }
      editDraft({ baseline: { code, verification: null } })
    } catch { if (generation === editGeneration.current) setNotice('基準コードを読み込めませんでした。テキスト欄へ貼り付けてください。') }
    finally { if (generation === editGeneration.current) setIsImporting(false) }
  }

  function resetProfile() {
    const preset = workshopPresets.find(item => item.id === selectedId)
    if (!preset) return
    const failure = removeWorkshopProfile(preset)
    if (failure) { setNotice(failure); return }
    try { localStorage.removeItem(ledSettingsKey(preset)) } catch { setNotice('LED設定を保存できませんでした。この画面では使えますが、再読み込みすると失われます。'); return }
    editGeneration.current++
    setIsImporting(false)
    const original = cloneWorkshopProfile(preset.profile)
    setDraft(cloneWorkshopProfile(original))
    setSettings(previous => ({ profiles: previous.profiles.map(item => item.id === preset.id ? { ...item, profile: original } : item), notice: 'このキットを配布時の設定に戻しました。保存済みのブラウザ設定も削除しました。' }))
  }

  return { profiles: settings.profiles, selectedId, selectedProfile, context, prompt, draft, draftErrors, hasPendingChanges, isImporting, notice: settings.notice, selectProfile, editDraft, editLedSettings, applyDraft, saveDraft, confirmBaseline, importBaseline, resetProfile }
}

export type WorkshopPreparation = ReturnType<typeof useWorkshopPreparation>
