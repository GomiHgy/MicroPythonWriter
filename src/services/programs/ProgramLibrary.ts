import { isBoardId } from '../../config/boards'
import type { ProjectSettings } from '../projects/types'
import { isLedModel } from '../workshop/WorkshopProfile'

export interface SavedProgram {
  id: string
  name: string
  description: string
  source: string
  settings: ProjectSettings
  savedAt: string
}

export type ProgramInput = Omit<SavedProgram, 'id' | 'savedAt'>

export const PROGRAM_LIBRARY_STORAGE_KEY = 'mpw-program-library-v1'
export const MAX_SAVED_PROGRAMS = 50
export const MAX_PROGRAM_LIBRARY_BYTES = 2_000_000
export const MAX_PROGRAM_SOURCE_LENGTH = 100_000

const inputKeys = ['name', 'description', 'source', 'settings'] as const
const settingsKeys = ['boardId', 'firmwareVersion', 'ledModel', 'ledCount', 'ledPin', 'maxBrightnessPercent'] as const
const invalidText = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u
const idPattern = /^[A-Za-z0-9_-]{1,96}$/
const fail = (message: string): never => { throw new Error(message) }
let fallbackSequence = 0

/** 値を読む前にキーと記述子を確認し、アクセサーや独自のtoJSONを実行しない。 */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return fail('プログラムの保存データの形式が正しくありません。')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || !keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'))) {
    return fail('プログラムの保存データに不足または未対応の項目があります。')
  }
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]))
}

function validText(value: unknown, limit: number, multiline = false, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= limit * 2 && [...value].length <= limit
    && (allowEmpty || value.trim().length > 0)
    && !invalidText.test(multiline ? value.replaceAll('\r', '').replaceAll('\n', '') : value)
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function validateSettings(input: unknown): ProjectSettings {
  const value = record(input, settingsKeys)
  if (!isBoardId(value.boardId) || !validText(value.firmwareVersion, 200, false, true)
    || !isLedModel(value.ledModel) || !integer(value.ledCount, 1, 300)
    || !integer(value.ledPin, 0, value.boardId === 'm5nanoc6' ? 30 : 48)
    || typeof value.maxBrightnessPercent !== 'number' || !Number.isFinite(value.maxBrightnessPercent)
    || value.maxBrightnessPercent <= 0 || value.maxBrightnessPercent > 100) {
    return fail('使う機器・UIFlow2版・LEDの設定を確認してください。')
  }
  return {
    boardId: value.boardId, firmwareVersion: value.firmwareVersion, ledModel: value.ledModel,
    ledCount: value.ledCount, ledPin: value.ledPin, maxBrightnessPercent: value.maxBrightnessPercent,
  }
}

function validateInput(input: unknown): ProgramInput {
  const value = record(input, inputKeys)
  if (!validText(value.name, 64)) fail('プログラム名は1〜64文字で入力してください。')
  if (!validText(value.description, 1000, true)) fail('説明は1〜1000文字で入力してください。改行も使えます。')
  if (typeof value.source !== 'string' || !value.source.trim() || value.source.length > MAX_PROGRAM_SOURCE_LENGTH || value.source.includes('\0')) {
    fail('プログラムは1〜100000文字で、不正な文字を含めずに入力してください。')
  }
  return {
    name: value.name as string, description: value.description as string, source: value.source as string,
    settings: validateSettings(value.settings),
  }
}

function validateSaved(input: unknown): SavedProgram {
  const value = record(input, [...inputKeys, 'id', 'savedAt'])
  if (typeof value.id !== 'string' || !idPattern.test(value.id)) fail('保存したプログラムのIDが正しくありません。')
  if (typeof value.savedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.savedAt)
    || !Number.isFinite(Date.parse(value.savedAt)) || new Date(value.savedAt).toISOString() !== value.savedAt) {
    fail('保存したプログラムの日時が正しくありません。')
  }
  return {
    ...validateInput({ name: value.name, description: value.description, source: value.source, settings: value.settings }),
    id: value.id as string, savedAt: value.savedAt as string,
  }
}

function checkSize(raw: string): void {
  // UTF-16長を先に制限し、大きすぎる入力をUTF-8へ複製しない。
  if (raw.length > MAX_PROGRAM_LIBRARY_BYTES || new TextEncoder().encode(raw).length > MAX_PROGRAM_LIBRARY_BYTES) {
    fail('保存できるプログラムの合計容量は2MBまでです。不要なプログラムを整理してください。')
  }
}

function readPrograms(): SavedProgram[] {
  let raw: string | null
  try { raw = localStorage.getItem(PROGRAM_LIBRARY_STORAGE_KEY) }
  catch { return fail('ブラウザの保存領域を利用できません。ブラウザの保存設定を確認してください。') }
  if (raw === null) return []
  checkSize(raw)
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { return fail('保存したプログラムを読み込めません。元の保存データは変更していません。') }
  const value = record(parsed, ['format', 'version', 'programs'])
  if (value.format !== 'micropython-writer-program-library' || value.version !== 1) {
    return fail('この版のプログラム保存データには対応していません。元の保存データは変更していません。')
  }
  if (!Array.isArray(value.programs) || value.programs.length > MAX_SAVED_PROGRAMS) {
    return fail('保存できるプログラムは50件までです。不要なプログラムを整理してください。')
  }
  const programs = value.programs.map(validateSaved)
  if (new Set(programs.map(program => program.id)).size !== programs.length) fail('保存したプログラムのIDが重複しています。')
  return programs
}

export function loadProgramLibrary(): { programs: SavedProgram[]; error: string } {
  try { return { programs: readPrograms(), error: '' } }
  catch (error) {
    return { programs: [], error: error instanceof Error ? error.message : '保存したプログラムを読み込めません。元の保存データは変更していません。' }
  }
}

function createId(programs: SavedProgram[]): string {
  const existing = new Set(programs.map(program => program.id))
  try {
    const id = globalThis.crypto?.randomUUID?.()
    if (id && idPattern.test(id) && !existing.has(id)) return id
  } catch { /* 非対応・制限環境では保存済みIDと照合するローカル連番を使う。 */ }
  // IDは認証用途ではない。時刻が同じ／戻った場合も既存IDと照合し、上書きしない。
  for (let attempt = 0; attempt <= MAX_SAVED_PROGRAMS; attempt += 1) {
    fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER
    const id = `local-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`
    if (!existing.has(id)) return id
  }
  return fail('プログラムの保存IDを作成できませんでした。もう一度お試しください。')
}

function writePrograms(programs: SavedProgram[]): SavedProgram[] {
  const raw = JSON.stringify({ format: 'micropython-writer-program-library', version: 1, programs })
  checkSize(raw)
  try { localStorage.setItem(PROGRAM_LIBRARY_STORAGE_KEY, raw) }
  catch { return fail('プログラムをブラウザに保存できませんでした。容量や保存設定を確認してください。') }
  return programs
}

/** 別の操作で追加された内容も毎回読み直す。同名でも既存項目を上書きしない。 */
export function saveLibraryProgram(input: ProgramInput): SavedProgram[] {
  const validated = validateInput(input)
  const programs = readPrograms()
  if (programs.length >= MAX_SAVED_PROGRAMS) fail('保存できるプログラムは50件までです。不要なプログラムを整理してください。')
  return writePrograms([...programs, { ...validated, id: createId(programs), savedAt: new Date().toISOString() }])
}

/** 利用者が確認した単一IDだけを削除する。他の作品・基準コードの保存領域には触れない。 */
export function deleteLibraryProgram(id: string): SavedProgram[] {
  if (typeof id !== 'string' || !idPattern.test(id)) fail('削除するプログラムのIDが正しくありません。')
  const programs = readPrograms()
  if (!programs.some(program => program.id === id)) fail('削除するプログラムが見つかりません。一覧を読み直してください。')
  return writePrograms(programs.filter(program => program.id !== id))
}
