import { isBoardId } from '../../config/boards'
import { isLedModel } from '../workshop/WorkshopProfile'
import type { ArtworkProject, ProjectSnapshot } from './types'

export const PROJECT_STORAGE_KEY = 'mpw-artwork-project-v1'
export const PROJECT_DRAFT_STORAGE_KEY = 'mpw-artwork-draft-v1'
export const MAX_PROJECT_BYTES = 1_000_000
export const MAX_PROJECT_SOURCE_LENGTH = 100_000

const invalidTextCharacters = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u
const reservedIds = new Set(['OFF', 'PLAY', 'PAUSE', 'STATUS', 'BRIGHTNESS', 'SPEED', 'MODE', 'ACTION'])
const fail = (detail: string): never => { throw new Error(`作品データを読み込めません。${detail}`) }

/** JSON以外のクラス・アクセサー・余分なキーも受け付けない。 */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('データ形式が正しくありません。')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'))) {
    return fail('必要な項目が足りないか、未対応の項目があります。')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, limit: number, allowEmpty = false): value is string {
  return typeof value === 'string' && (allowEmpty || value.trim().length > 0)
    && [...value].length <= limit && !invalidTextCharacters.test(value)
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,11}$/.test(value) && !reservedIds.has(value)
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
const icon = (value: unknown) => ['light', 'star', 'rainbow', 'heart'].includes(value as string)

function snapshot(value: unknown): ProjectSnapshot {
  const draft = record(value, ['source', 'settings', 'recipe', 'remoteButtons'])
  if (typeof draft.source !== 'string' || draft.source.length > MAX_PROJECT_SOURCE_LENGTH || draft.source.includes('\0')) fail('コードは100000文字以内で、不正な文字を含めずに保存してください。')
  const settings = record(draft.settings, ['boardId', 'firmwareVersion', 'ledModel', 'ledCount', 'ledPin', 'maxBrightnessPercent'])
  if (!isBoardId(settings.boardId) || !text(settings.firmwareVersion, 200, true) || !isLedModel(settings.ledModel)
    || !integer(settings.ledCount, 1, 300) || !integer(settings.ledPin, 0, 48)
    || typeof settings.maxBrightnessPercent !== 'number' || !Number.isFinite(settings.maxBrightnessPercent)
    || settings.maxBrightnessPercent <= 0 || settings.maxBrightnessPercent > 100) fail('機器・UIFlow2版・LED設定を確認してください。')
  const recipe = record(draft.recipe, ['modes', 'shortPress', 'longPress', 'whileHeld', 'wireless'])
  if (!['next', 'toggle', 'none'].includes(recipe.shortPress as string) || !['off', 'none'].includes(recipe.longPress as string)
    || typeof recipe.whileHeld !== 'boolean' || typeof recipe.wireless !== 'boolean') fail('ボタン・無線の設定が正しくありません。')
  if (!Array.isArray(recipe.modes) || recipe.modes.length < 1 || recipe.modes.length > 8) fail('光り方は1〜8個で設定してください。')
  const modes = recipe.modes as unknown[]
  const ids = new Set<string>()
  for (const candidate of modes) {
    const mode = record(candidate, ['id', 'label', 'icon', 'kind', 'color', 'speed', 'repeats', 'endState'])
    if (!identifier(mode.id) || ids.has(mode.id) || !text(mode.label, 24) || !icon(mode.icon)
      || !['solid', 'rainbow', 'chase', 'twinkle'].includes(mode.kind as string)
      || typeof mode.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(mode.color)
      || !integer(mode.speed, 0, 100) || !integer(mode.repeats, 0, 100)
      || !['hold', 'off'].includes(mode.endState as string)) fail('光り方の名前・ID・色・速さ・繰り返しを確認してください。')
    ids.add(mode.id as string)
  }
  if (!Array.isArray(draft.remoteButtons) || draft.remoteButtons.length > 16) fail('リモコンのボタンは種類ごとに8個までです。')
  const remoteIds = { mode: new Set<string>(), action: new Set<string>() }
  for (const candidate of draft.remoteButtons as unknown[]) {
    const button = record(candidate, ['kind', 'id', 'label', 'icon'])
    if ((button.kind !== 'mode' && button.kind !== 'action') || !identifier(button.id) || !text(button.label, 24) || !icon(button.icon)) fail('リモコンのボタン設定が正しくありません。')
    const kind = button.kind as 'mode' | 'action'
    const id = button.id as string
    if (remoteIds[kind].has(id) || remoteIds[kind].size >= 8) fail('リモコンのボタンIDの重複や個数を確認してください。')
    remoteIds[kind].add(id)
  }
  // 受信したコードや名前は実行せず、そのまま保存する。HTMLとしても扱わない。
  return structuredClone(draft) as unknown as ProjectSnapshot
}

export function createProject(): ArtworkProject {
  return {
    format: 'micropython-writer-project', version: 1, name: '新しい作品', updatedAt: new Date().toISOString(),
    draft: {
      source: '',
      settings: { boardId: 'm5nanoc6', firmwareVersion: '', ledModel: 'WS2812B', ledCount: 10, ledPin: 2, maxBrightnessPercent: 20 },
      recipe: {
        modes: [{ id: 'LIGHT', label: 'あたたかい光', icon: 'light', kind: 'solid', color: '#ffcc00', speed: 50, repeats: 0, endState: 'hold' }],
        shortPress: 'next', longPress: 'off', whileHeld: false, wireless: false,
      },
      remoteButtons: [],
    },
    working: null,
  }
}

/** 検証結果は独立したコピー。入力の参照や保存済みスナップショットを共有しない。 */
export function validateProject(input: unknown): ArtworkProject {
  const value = record(input, ['format', 'version', 'name', 'updatedAt', 'draft', 'working'])
  if (value.format !== 'micropython-writer-project' || value.version !== 1) fail('この形式・版の作品ファイルには対応していません。')
  if (!text(value.name, 64)) fail('作品名は1〜64文字で入力してください。')
  if (!timestamp(value.updatedAt)) fail('保存日時が正しくありません。')
  const draft = snapshot(value.draft)
  let working: ArtworkProject['working'] = null
  if (value.working !== null) {
    const saved = record(value.working, ['snapshot', 'confirmedAt'])
    if (!timestamp(saved.confirmedAt)) fail('動作確認日時が正しくありません。')
    working = { snapshot: snapshot(saved.snapshot), confirmedAt: saved.confirmedAt as string }
  }
  const project: ArtworkProject = { format: 'micropython-writer-project', version: 1, name: value.name as string, updatedAt: value.updatedAt as string, draft, working }
  if (new TextEncoder().encode(JSON.stringify(project)).length > MAX_PROJECT_BYTES) fail('作品ファイルは1MB以内にしてください。')
  return project
}

export function serializeProject(project: ArtworkProject): string {
  const serialized = JSON.stringify(validateProject(project), null, 2)
  if (new TextEncoder().encode(serialized).length > MAX_PROJECT_BYTES) fail('作品ファイルは1MB以内にしてください。')
  return serialized
}

function decode(text: string): ArtworkProject {
  if (typeof text !== 'string' || text.length > MAX_PROJECT_BYTES || new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) fail('作品ファイルは1MB以内にしてください。')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return fail('JSON形式の作品ファイルを選んでください。') }
  return validateProject(parsed)
}

/** 他の場所で確認した記録を、この端末・配線での動作確認には流用しない。 */
export function parseProject(text: string): ArtworkProject {
  const project = decode(text)
  return { ...project, working: null }
}

export function loadProject(): { project: ArtworkProject; notice: string; sourceAuthoritative: boolean } {
  try {
    const draft = localStorage.getItem(PROJECT_DRAFT_STORAGE_KEY)
    let draftNotice = ''
    if (draft !== null) {
      try { return { project: decode(draft), notice: '', sourceAuthoritative: true } }
      catch { draftNotice = '編集中の作品を読み込めませんでした。元データは変更していません。保存済みの作品があれば表示します。上書き前に元データを確認してください。' }
    }
    const stored = localStorage.getItem(PROJECT_STORAGE_KEY)
    if (stored === null) return { project: createProject(), notice: draftNotice, sourceAuthoritative: false }
    try { return { project: decode(stored), notice: draftNotice, sourceAuthoritative: false } }
    catch { return { project: createProject(), notice: draftNotice || '保存済みの作品を読み込めませんでした。元データは変更していません。別の作品ファイルを読み込むか、保存前に元データを確認してください。', sourceAuthoritative: false } }
  } catch {
    return { project: createProject(), notice: 'ブラウザの保存領域を利用できません。作品ファイルを書き出して保管してください。', sourceAuthoritative: false }
  }
}

/** 先に全項目を検証する。失敗時は既存の保存データを変更しない。 */
export function saveProject(project: ArtworkProject): string {
  let serialized: string
  try { serialized = serializeProject(project) }
  catch (error) { return error instanceof Error ? error.message : '作品データが正しくないため保存できません。' }
  try { localStorage.setItem(PROJECT_STORAGE_KEY, serialized); return '' }
  catch { return 'ブラウザに保存できませんでした。容量や保存設定を確認し、作品ファイルを書き出して保管してください。' }
}

/** コード・設定・操作・確認点を単一キーにまとめ、途中の不整合な復元を防ぐ。 */
export function saveProjectDraft(project: ArtworkProject): string {
  let serialized: string
  try { serialized = serializeProject(project) }
  catch (error) { return error instanceof Error ? error.message : '作品データが正しくないため保存できません。' }
  try { localStorage.setItem(PROJECT_DRAFT_STORAGE_KEY, serialized); return '' }
  catch { return '編集中の作品をブラウザに保存できませんでした。作品ファイルを書き出して保管してください。' }
}

/** 利用者の明示確認専用。提供側のBLE確認済みコードへ昇格する操作ではない。 */
export function markWorking(project: ArtworkProject): ArtworkProject {
  const result = validateProject(project)
  if (!result.draft.source.trim()) fail('コードを用意し、実機で動きを確認してから動作OK版を保存してください。')
  const now = new Date().toISOString()
  result.working = { snapshot: structuredClone(result.draft), confirmedAt: now }
  result.updatedAt = now
  return validateProject(result)
}

/** 呼び出し側で編集中データを書き出し、利用者の復元確認を得てから使う。 */
export function restoreWorking(project: ArtworkProject): ArtworkProject {
  const result = validateProject(project)
  const working = result.working
  if (!working) return fail('この端末で保存した動作OK版がありません。')
  result.draft = structuredClone(working.snapshot)
  result.updatedAt = new Date().toISOString()
  return result
}
