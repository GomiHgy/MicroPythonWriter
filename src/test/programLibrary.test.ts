import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteLibraryProgram, loadProgramLibrary, MAX_PROGRAM_LIBRARY_BYTES, MAX_PROGRAM_SOURCE_LENGTH,
  MAX_SAVED_PROGRAMS, PROGRAM_LIBRARY_STORAGE_KEY, saveLibraryProgram,
  type ProgramInput, type SavedProgram,
} from '../services/programs/ProgramLibrary'

function makeStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

function input(): ProgramInput {
  return {
    name: '魔法の杖 🌟', description: '押すと黄色に光る。\n離すとゆっくり消える。', source: '# 日本語\r\nprint("光る")\n',
    settings: { boardId: 'm5nanoc6', firmwareVersion: '2.5.3', ledModel: 'WS2812B-MINI', ledCount: 37, ledPin: 2, maxBrightnessPercent: 20 },
  }
}

function envelope(programs: SavedProgram[]) {
  return { format: 'micropython-writer-program-library', version: 1, programs }
}

let storage: ReturnType<typeof makeStorage>
beforeEach(() => {
  storage = makeStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('プログラム保存一覧', () => {
  it('未保存時は読み取りだけで空の一覧を返す', () => {
    expect(loadProgramLibrary()).toEqual({ programs: [], error: '' })
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('名前・改行説明・コード・機器・全LED設定・日時を別キーへ往復する', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'))
    storage.values.set('mpw-artwork-project-v1', 'existing project')
    storage.values.set('mpw-artwork-draft-v1', 'existing draft')
    storage.values.set('mpw-workshop-profile-v1', 'existing baseline')
    const result = saveLibraryProgram(input())
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ ...input(), id: expect.any(String), savedAt: '2026-09-25T10:00:00.000Z' })
    expect(loadProgramLibrary()).toEqual({ programs: result, error: '' })
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(PROGRAM_LIBRARY_STORAGE_KEY, expect.any(String))
    expect(storage.values.get('mpw-artwork-project-v1')).toBe('existing project')
    expect(storage.values.get('mpw-artwork-draft-v1')).toBe('existing draft')
    expect(storage.values.get('mpw-workshop-profile-v1')).toBe('existing baseline')
  })

  it('同名を別IDで追加し、保存のたびに最新の一覧を読み取る', () => {
    const first = saveLibraryProgram(input())[0]
    const external = { ...first, id: 'another-tab', name: '別のタブの保存' }
    storage.values.set(PROGRAM_LIBRARY_STORAGE_KEY, JSON.stringify(envelope([first, external])))
    const result = saveLibraryProgram({ ...input(), source: 'print("変更")' })
    expect(result).toHaveLength(3)
    expect(result.slice(0, 2)).toEqual([first, external])
    expect(result[2].name).toBe(first.name)
    expect(result[2].id).not.toBe(first.id)
    expect(first.source).toBe(input().source)
  })

  it('入力・返却値・再読込の設定参照を共有しない', () => {
    const value = input()
    const before = structuredClone(value)
    Object.freeze(value.settings)
    Object.freeze(value)
    const saved = saveLibraryProgram(value)
    expect(value).toEqual(before)
    expect(saved[0].settings).not.toBe(value.settings)
    saved[0].settings.ledCount = 111
    saved[0].source = 'modified outside'
    const loaded = loadProgramLibrary().programs
    expect(loaded[0]).toMatchObject(before)
    loaded[0].settings.ledCount = 222
    expect(loadProgramLibrary().programs[0].settings.ledCount).toBe(37)
  })

  it('HTMLやPythonを実行せず、そのまま文字列として保存する', () => {
    const value = { ...input(), name: '<script>attack()</script>', description: '<img src=x onerror=attack()>', source: 'raise Exception("not executed")' }
    expect(saveLibraryProgram(value)[0]).toMatchObject(value)
    expect(loadProgramLibrary().programs[0]).toMatchObject(value)
  })

  it('指定IDだけを消し、直前に別操作で追加された保存を残す', () => {
    const first = saveLibraryProgram(input())[0]
    const external = { ...first, id: 'external', name: '別の保存' }
    storage.values.set(PROGRAM_LIBRARY_STORAGE_KEY, JSON.stringify(envelope([first, external])))
    expect(deleteLibraryProgram(first.id)).toEqual([external])
    expect(loadProgramLibrary().programs).toEqual([external])
    expect(deleteLibraryProgram(external.id)).toEqual([])
  })

  it('不正ID・存在しないIDを削除しても既存データを変更しない', () => {
    const first = saveLibraryProgram(input())[0]
    const raw = storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)
    storage.setItem.mockClear()
    expect(() => deleteLibraryProgram('missing')).toThrow('見つかりません')
    expect(() => deleteLibraryProgram('../wrong')).toThrow('IDが正しくありません')
    expect(() => deleteLibraryProgram(null as unknown as string)).toThrow('IDが正しくありません')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(raw)
    expect(loadProgramLibrary().programs[0].id).toBe(first.id)
  })

  it.each([
    ['name empty', (v: ProgramInput) => { v.name = ' \n ' }],
    ['name too long', (v: ProgramInput) => { v.name = 'x'.repeat(65) }],
    ['name newline', (v: ProgramInput) => { v.name = 'a\nb' }],
    ['name unpaired surrogate', (v: ProgramInput) => { v.name = '\ud800' }],
    ['description empty', (v: ProgramInput) => { v.description = '\r\n ' }],
    ['description too long', (v: ProgramInput) => { v.description = 'あ'.repeat(1001) }],
    ['description control', (v: ProgramInput) => { v.description = 'a\0b' }],
    ['description bidi', (v: ProgramInput) => { v.description = 'a\u202eb' }],
    ['source empty', (v: ProgramInput) => { v.source = '\n ' }],
    ['source too long', (v: ProgramInput) => { v.source = 'x'.repeat(MAX_PROGRAM_SOURCE_LENGTH + 1) }],
    ['source NUL', (v: ProgramInput) => { v.source = 'print(1)\0' }],
    ['board unsupported', (v: ProgramInput) => { Object.assign(v.settings, { boardId: 'atoms3' }) }],
    ['firmware too long', (v: ProgramInput) => { v.settings.firmwareVersion = 'x'.repeat(201) }],
    ['firmware newline', (v: ProgramInput) => { v.settings.firmwareVersion = 'v1\nv2' }],
    ['LED model unsupported', (v: ProgramInput) => { Object.assign(v.settings, { ledModel: 'RGBW' }) }],
    ['count minimum', (v: ProgramInput) => { v.settings.ledCount = 0 }],
    ['count maximum', (v: ProgramInput) => { v.settings.ledCount = 301 }],
    ['count integer', (v: ProgramInput) => { v.settings.ledCount = 2.5 }],
    ['pin minimum', (v: ProgramInput) => { v.settings.ledPin = -1 }],
    ['NanoC6 pin maximum', (v: ProgramInput) => { v.settings.ledPin = 31 }],
    ['Atom pin maximum', (v: ProgramInput) => { v.settings.boardId = 'atoms3lite'; v.settings.ledPin = 49 }],
    ['pin integer', (v: ProgramInput) => { v.settings.ledPin = 2.5 }],
    ['brightness minimum', (v: ProgramInput) => { v.settings.maxBrightnessPercent = 0 }],
    ['brightness maximum', (v: ProgramInput) => { v.settings.maxBrightnessPercent = 101 }],
    ['brightness finite', (v: ProgramInput) => { v.settings.maxBrightnessPercent = Infinity }],
    ['brightness NaN', (v: ProgramInput) => { v.settings.maxBrightnessPercent = NaN }],
  ])('%s を保存前に拒否し元データを保持する', (_label, mutate) => {
    saveLibraryProgram(input())
    const raw = storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)
    const value = input()
    mutate(value)
    storage.setItem.mockClear()
    expect(() => saveLibraryProgram(value)).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(raw)
  })

  it.each(['m5nanoc6', 'atoms3lite'] as const)('%s の境界値と空のファームウェア版を保存できる', boardId => {
    const value = input()
    value.name = '🌟'.repeat(64)
    value.description = '🌟'.repeat(998) + '\r\n'
    value.source = 'x'.repeat(MAX_PROGRAM_SOURCE_LENGTH)
    value.settings = { boardId, firmwareVersion: '', ledModel: 'SK6812MINI', ledCount: 300, ledPin: boardId === 'm5nanoc6' ? 30 : 48, maxBrightnessPercent: 0.1 }
    expect(saveLibraryProgram(value)[0]).toMatchObject(value)
    value.settings.ledCount = 1
    value.settings.ledPin = 0
    value.settings.maxBrightnessPercent = 100
    expect(saveLibraryProgram(value)[1]).toMatchObject(value)
  })

  it.each(['input', 'settings'])('%s のアクセサー・未知項目・シンボル・クラス・toJSONを拒否する', level => {
    const getter = vi.fn(() => 'must not run')
    const withGetter = input()
    Object.defineProperty(level === 'input' ? withGetter : withGetter.settings, level === 'input' ? 'name' : 'ledCount', { get: getter })
    expect(() => saveLibraryProgram(withGetter)).toThrow()
    expect(getter).not.toHaveBeenCalled()
    for (const key of ['unexpected', Symbol('extra'), '__proto__', 'toJSON']) {
      const value = input()
      Object.defineProperty(level === 'input' ? value : value.settings, key, { value: getter, enumerable: true })
      expect(() => saveLibraryProgram(value)).toThrow()
    }
    const value = input()
    if (level === 'input') Object.setPrototypeOf(value, Date.prototype)
    else Object.setPrototypeOf(value.settings, Date.prototype)
    expect(() => saveLibraryProgram(value)).toThrow()
    expect(getter).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it.each([
    ['broken JSON', '{bad'],
    ['null', 'null'],
    ['array', '[]'],
    ['future version', JSON.stringify({ ...envelope([]), version: 2 })],
    ['wrong format', JSON.stringify({ ...envelope([]), format: 'other' })],
    ['missing key', JSON.stringify({ version: 1, programs: [] })],
    ['unknown key', JSON.stringify({ ...envelope([]), surprise: 1 })],
    ['wrong list', JSON.stringify({ ...envelope([]), programs: {} })],
  ])('%s はload/save/deleteで元データを上書きしない', (_label, raw) => {
    storage.values.set(PROGRAM_LIBRARY_STORAGE_KEY, raw)
    expect(loadProgramLibrary().error).not.toBe('')
    expect(loadProgramLibrary().programs).toEqual([])
    expect(() => saveLibraryProgram(input())).toThrow()
    expect(() => deleteLibraryProgram('id')).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(raw)
  })

  it.each([
    ['invalid ID', (p: SavedProgram) => { p.id = 'a/b' }],
    ['invalid date', (p: SavedProgram) => { p.savedAt = '2026-02-30T00:00:00.000Z' }],
    ['non ISO date', (p: SavedProgram) => { p.savedAt = 'yesterday' }],
    ['name type', (p: SavedProgram) => { Object.assign(p, { name: 1 }) }],
    ['settings missing', (p: SavedProgram) => { Reflect.deleteProperty(p.settings, 'ledCount') }],
    ['settings unknown', (p: SavedProgram) => { Object.assign(p.settings, { bpp: 4 }) }],
  ])('保存済みレコードの %s も厳密に検査する', (_label, mutate) => {
    const saved = saveLibraryProgram(input())[0]
    mutate(saved)
    const raw = JSON.stringify(envelope([saved]))
    storage.values.set(PROGRAM_LIBRARY_STORAGE_KEY, raw)
    storage.setItem.mockClear()
    expect(loadProgramLibrary().error).not.toBe('')
    expect(() => saveLibraryProgram(input())).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(raw)
  })

  it('重複IDを読み込み時に拒否する', () => {
    const saved = saveLibraryProgram(input())[0]
    storage.values.set(PROGRAM_LIBRARY_STORAGE_KEY, JSON.stringify(envelope([saved, saved])))
    expect(loadProgramLibrary().error).toContain('IDが重複')
  })

  it('50件は保存でき51件目は保存せず、削除後に保存できる', () => {
    for (let i = 0; i < MAX_SAVED_PROGRAMS; i += 1) saveLibraryProgram(input())
    expect(loadProgramLibrary().programs).toHaveLength(MAX_SAVED_PROGRAMS)
    const raw = storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)
    expect(() => saveLibraryProgram(input())).toThrow('50件まで')
    expect(storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(raw)
    deleteLibraryProgram(loadProgramLibrary().programs[0].id)
    expect(saveLibraryProgram(input())).toHaveLength(MAX_SAVED_PROGRAMS)
  })

  it('過剰件数の外部データを読み込み時にも拒否する', () => {
    const saved = saveLibraryProgram(input())[0]
    const programs = Array.from({ length: MAX_SAVED_PROGRAMS + 1 }, (_, i) => ({ ...saved, id: `id-${i}` }))
    storage.values.set(PROGRAM_LIBRARY_STORAGE_KEY, JSON.stringify(envelope(programs)))
    expect(loadProgramLibrary().error).toContain('50件まで')
  })

  it('UTF-8の合計容量を制限し、2MBを超える追加時も元データを保持する', () => {
    const value = { ...input(), source: 'あ'.repeat(MAX_PROGRAM_SOURCE_LENGTH) }
    for (let i = 0; i < 6; i += 1) saveLibraryProgram(value)
    const raw = storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)!
    expect(new TextEncoder().encode(raw).length).toBeLessThan(MAX_PROGRAM_LIBRARY_BYTES)
    expect(() => saveLibraryProgram(value)).toThrow('合計容量は2MB')
    expect(storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(raw)
  })

  it.each(['x', 'あ'])('過剰な文字列・UTF-8容量をJSON解析前に拒否する: %s', character => {
    const raw = character.repeat(character === 'x' ? MAX_PROGRAM_LIBRARY_BYTES + 1 : Math.ceil(MAX_PROGRAM_LIBRARY_BYTES / 3))
    storage.values.set(PROGRAM_LIBRARY_STORAGE_KEY, raw)
    expect(loadProgramLibrary().error).toContain('合計容量は2MB')
    expect(() => saveLibraryProgram(input())).toThrow('合計容量は2MB')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('保存領域が利用できないとき成功扱いせず理由を返す', () => {
    storage.getItem.mockImplementation(() => { throw new Error('denied') })
    expect(loadProgramLibrary()).toEqual({ programs: [], error: expect.stringContaining('保存領域を利用できません') })
    expect(() => saveLibraryProgram(input())).toThrow('保存領域を利用できません')
    expect(() => deleteLibraryProgram('id')).toThrow('保存領域を利用できません')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('容量不足による保存/削除の失敗をthrowし、保存済みの値を維持する', () => {
    const first = saveLibraryProgram(input())[0]
    const raw = storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)
    storage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(() => saveLibraryProgram(input())).toThrow('ブラウザに保存できませんでした')
    expect(() => deleteLibraryProgram(first.id)).toThrow('ブラウザに保存できませんでした')
    expect(storage.values.get(PROGRAM_LIBRARY_STORAGE_KEY)).toBe(raw)
  })

  it.each(['absent', 'throws', 'duplicate'] as const)('randomUUIDが%sでも時刻固定で衝突しないIDを作る', mode => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'))
    vi.stubGlobal('crypto', mode === 'absent' ? undefined : {
      randomUUID: mode === 'throws' ? () => { throw new Error('unsupported') } : () => '00000000-0000-4000-8000-000000000000',
    })
    for (let i = 0; i < 4; i += 1) saveLibraryProgram(input())
    const programs = loadProgramLibrary().programs
    expect(programs).toHaveLength(4)
    expect(new Set(programs.map(program => program.id)).size).toBe(4)
  })
})
