import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject, loadProject, markWorking, MAX_PROJECT_BYTES, MAX_PROJECT_SOURCE_LENGTH,
  parseProject, PROJECT_DRAFT_STORAGE_KEY, PROJECT_STORAGE_KEY, restoreWorking, saveProject, saveProjectDraft, serializeProject, validateProject,
} from '../services/projects/ProjectStorage'
import type { ArtworkProject } from '../services/projects/types'

function storage() {
  const values = new Map<string, string>()
  return { values, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) }
}
let target: ReturnType<typeof storage>
beforeEach(() => { target = storage(); vi.stubGlobal('localStorage', target) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('作品の形式・保存・読み込み', () => {
  it('安全な初期値を毎回独立した参照で作る', () => {
    const project = createProject()
    expect(project.draft.settings).toEqual({ boardId: 'm5nanoc6', firmwareVersion: '', ledModel: 'WS2812B', ledCount: 10, ledPin: 2, maxBrightnessPercent: 20 })
    expect(project.draft.recipe).toMatchObject({ shortPress: 'next', longPress: 'off', whileHeld: false, wireless: false })
    expect(project.draft.recipe.modes).toHaveLength(1)
    expect(project.draft.source).toBe('')
    expect(project.working).toBeNull()
    expect(validateProject(project)).toEqual(project)
    project.draft.recipe.modes[0].label = '別の名前'
    expect(createProject().draft.recipe.modes[0].label).not.toBe('別の名前')
  })

  it('名前・Unicodeコード・設定・モード・アイコン付きリモコンをまとめて往復する', () => {
    const project = createProject()
    project.name = '魔法の杖 🌟'
    project.draft.source = '# コメントを保持\r\nprint("星空"); print("<script>not executed</script>")\n'
    project.draft.settings.boardId = 'atoms3lite'
    project.draft.settings.firmwareVersion = '2.3.7'
    project.draft.remoteButtons = [{ kind: 'mode', id: 'STARRY', label: '星空 🌟', icon: 'star' }, { kind: 'action', id: 'TRANSFORM', label: '変身', icon: 'heart' }]
    expect(parseProject(serializeProject(project))).toEqual(project)
    expect(saveProject(project)).toBe('')
    expect(loadProject()).toEqual({ project, notice: '', sourceAuthoritative: false })
    expect(target.setItem).toHaveBeenCalledWith(PROJECT_STORAGE_KEY, expect.any(String))
  })

  it('保存がない場合は保存を行わず初期値を返す', () => {
    expect(loadProject().notice).toBe('')
    expect(loadProject().project.working).toBeNull()
    expect(target.setItem).not.toHaveBeenCalled()
  })

  it.each([
    ['format', (p: ArtworkProject) => { (p as unknown as { format: string }).format = 'other' }],
    ['future version', (p: ArtworkProject) => { (p as unknown as { version: number }).version = 2 }],
    ['empty name', (p: ArtworkProject) => { p.name = '   ' }],
    ['long name', (p: ArtworkProject) => { p.name = 'x'.repeat(65) }],
    ['invalid time', (p: ArtworkProject) => { p.updatedAt = '2026-02-30T00:00:00.000Z' }],
    ['board', (p: ArtworkProject) => { (p.draft.settings as unknown as { boardId: string }).boardId = 'atoms3' }],
    ['firmware', (p: ArtworkProject) => { p.draft.settings.firmwareVersion = 'v2\nwrong' }],
    ['LED model', (p: ArtworkProject) => { (p.draft.settings as unknown as { ledModel: string }).ledModel = 'RGBW' }],
    ['LED count low', (p: ArtworkProject) => { p.draft.settings.ledCount = 0 }],
    ['LED count high', (p: ArtworkProject) => { p.draft.settings.ledCount = 301 }],
    ['pin', (p: ArtworkProject) => { p.draft.settings.ledPin = 49 }],
    ['fractional pin', (p: ArtworkProject) => { p.draft.settings.ledPin = 2.5 }],
    ['brightness low', (p: ArtworkProject) => { p.draft.settings.maxBrightnessPercent = 0 }],
    ['brightness high', (p: ArtworkProject) => { p.draft.settings.maxBrightnessPercent = 101 }],
    ['brightness NaN', (p: ArtworkProject) => { p.draft.settings.maxBrightnessPercent = NaN }],
    ['brightness infinity', (p: ArtworkProject) => { p.draft.settings.maxBrightnessPercent = Infinity }],
    ['source NUL', (p: ArtworkProject) => { p.draft.source = 'print(1)\0' }],
    ['source long', (p: ArtworkProject) => { p.draft.source = 'x'.repeat(MAX_PROJECT_SOURCE_LENGTH + 1) }],
    ['modes empty', (p: ArtworkProject) => { p.draft.recipe.modes = [] }],
    ['modes excess', (p: ArtworkProject) => { p.draft.recipe.modes = Array.from({ length: 9 }, (_, i) => ({ ...p.draft.recipe.modes[0], id: `M${i}` })) }],
    ['mode duplicate', (p: ArtworkProject) => { p.draft.recipe.modes.push({ ...p.draft.recipe.modes[0] }) }],
    ['short button', (p: ArtworkProject) => { (p.draft.recipe as unknown as { shortPress: string }).shortPress = 'exec' }],
    ['wireless type', (p: ArtworkProject) => { (p.draft.recipe as unknown as { wireless: number }).wireless = 1 }],
    ['speed', (p: ArtworkProject) => { p.draft.recipe.modes[0].speed = -1 }],
    ['repeats', (p: ArtworkProject) => { p.draft.recipe.modes[0].repeats = 101 }],
    ['color injection', (p: ArtworkProject) => { p.draft.recipe.modes[0].color = '#fff;print(1)' }],
    ['working time', (p: ArtworkProject) => { p.working = { snapshot: structuredClone(p.draft), confirmedAt: 'yesterday' } }],
    ['working schema', (p: ArtworkProject) => { p.working = { snapshot: { ...structuredClone(p.draft), remoteButtons: [{}] } as ArtworkProject['draft'], confirmedAt: p.updatedAt } }],
  ])('%s を拒否し既存の保存データに触れない', (_label, mutate) => {
    const original = createProject()
    saveProject(original)
    const stored = target.values.get(PROJECT_STORAGE_KEY)
    const changed = createProject()
    mutate(changed)
    expect(() => validateProject(changed)).toThrow('作品データ')
    expect(saveProject(changed)).not.toBe('')
    expect(target.values.get(PROJECT_STORAGE_KEY)).toBe(stored)
  })

  it.each(['OFF', 'PLAY', 'PAUSE', 'STATUS', 'BRIGHTNESS', 'SPEED', 'MODE', 'ACTION', 'lowercase', '1ID', 'A'.repeat(13), '__proto__'])('予約・不正ID %s を拒否する', id => {
    const project = createProject()
    project.draft.recipe.modes[0].id = id
    expect(() => validateProject(project)).toThrow()
    project.draft.recipe.modes[0].id = 'VALID'
    project.draft.remoteButtons = [{ kind: 'action', id, label: '動作', icon: 'star' }]
    expect(() => validateProject(project)).toThrow()
  })

  it.each(['', ' ', 'x'.repeat(25), 'a\nb', 'a\u202eb', '\ud800', 'a\u2028b'])('表示名の不正Unicode・長さ %j を拒否する', label => {
    const project = createProject()
    project.draft.recipe.modes[0].label = label
    expect(() => validateProject(project)).toThrow()
  })

  it('Unicodeコードポイント24個、設定境界値、8個のモードを受け付ける', () => {
    const project = createProject()
    project.draft.recipe.modes = Array.from({ length: 8 }, (_, i) => ({ ...project.draft.recipe.modes[0], id: `MODE_${i}`, label: '🌟'.repeat(24), speed: i ? 0 : 100, repeats: i ? 0 : 100 }))
    project.draft.source = 'x'.repeat(MAX_PROJECT_SOURCE_LENGTH)
    project.draft.settings.ledCount = 300
    project.draft.settings.ledPin = 48
    project.draft.settings.maxBrightnessPercent = 0.1
    expect(validateProject(project)).toEqual(project)
  })

  it('remote mode/actionは種類ごとに8個まででIDを一意にする', () => {
    const project = createProject()
    project.draft.remoteButtons = Array.from({ length: 16 }, (_, i) => ({ kind: i < 8 ? 'mode' : 'action', id: `ID_${i % 8}`, label: `ボタン${i}`, icon: 'light' }))
    expect(validateProject(project)).toEqual(project)
    project.draft.remoteButtons[1].id = 'ID_0'
    expect(() => validateProject(project)).toThrow()
    project.draft.remoteButtons = Array.from({ length: 9 }, (_, i) => ({ kind: 'action', id: `ID_${i}`, label: '動作', icon: 'star' }))
    expect(() => validateProject(project)).toThrow()
  })

  it.each(['root', 'settings', 'recipe', 'mode', 'working', 'snapshot', 'remote'])('階層 %s の未定義キーを拒否する', level => {
    const project = markWorking({ ...createProject(), draft: { ...createProject().draft, source: 'print(1)' } })
    project.draft.remoteButtons = [{ kind: 'mode', id: 'LIGHT', label: '光', icon: 'light' }]
    const obj = level === 'root' ? project : level === 'settings' ? project.draft.settings : level === 'recipe' ? project.draft.recipe
      : level === 'mode' ? project.draft.recipe.modes[0] : level === 'working' ? project.working! : level === 'snapshot' ? project.draft : project.draft.remoteButtons[0]
    Object.defineProperty(obj, '__proto__', { value: { polluted: true }, enumerable: true })
    expect(() => validateProject(project)).toThrow()
    expect(() => parseProject(JSON.stringify(project))).toThrow()
    expect({}).not.toHaveProperty('polluted')
  })

  it('未知項目・欠損・クラス・アクセサーを実行せず拒否する', () => {
    const project = createProject()
    expect(() => validateProject({ ...project, version: undefined })).toThrow()
    expect(() => validateProject(Object.assign(new Date(), project))).toThrow()
    const getter = vi.fn(() => 'executed')
    Object.defineProperty(project, 'name', { get: getter })
    expect(() => validateProject(project)).toThrow()
    expect(getter).not.toHaveBeenCalled()
  })

  it.each(['{broken', 'null', '[]', '"text"', 'x'.repeat(MAX_PROJECT_BYTES + 1), 'あ'.repeat(Math.ceil(MAX_PROJECT_BYTES / 3))])('不正・巨大JSONを拒否する (case %#)', input => {
    expect(() => parseProject(input)).toThrow('作品データ')
    target.values.set(PROJECT_STORAGE_KEY, input)
    expect(loadProject().notice).toContain('元データは変更していません')
    expect(target.values.get(PROJECT_STORAGE_KEY)).toBe(input)
    expect(target.setItem).not.toHaveBeenCalled()
  })

  it('保存のサイズ境界はUTF-8バイトとJSONエスケープも数える', () => {
    const project = createProject()
    project.draft.source = '\u0001'.repeat(MAX_PROJECT_SOURCE_LENGTH)
    const saved = { ...project, working: { snapshot: structuredClone(project.draft), confirmedAt: project.updatedAt } }
    // 2つのスナップショットを合わせるとJSONでは1MBを超えるため保存しない。
    expect(() => serializeProject(saved)).toThrow('1MB')
  })

  it('ストレージ拒否や容量不足でもコードを失わず書き出せる', () => {
    const project = createProject()
    project.draft.source = 'print("手元に残す")'
    target.getItem.mockImplementation(() => { throw new Error('SecurityError') })
    target.setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(loadProject().notice).toContain('保存領域')
    expect(saveProject(project)).toContain('書き出して')
    expect(parseProject(serializeProject(project)).draft.source).toBe(project.draft.source)
  })
})

describe('利用者が確認した動作OK版', () => {
  it('保存点を深いコピーで作り、編集しても確認時のコード・設定・操作を保持する', () => {
    const project = createProject()
    project.draft.source = 'print("動作OK")\r\n'
    project.draft.remoteButtons = [{ kind: 'action', id: 'SPARKLE', label: 'きらきら', icon: 'star' }]
    const previous = structuredClone(project)
    const marked = markWorking(project)
    expect(project).toEqual(previous)
    const original = structuredClone(marked.working!.snapshot)
    marked.draft.source = 'broken('
    marked.draft.settings.ledPin = 3
    marked.draft.recipe.modes[0].label = '別の光'
    marked.draft.remoteButtons[0].label = '別の動作'
    expect(marked.working!.snapshot).toEqual(original)
    const restored = restoreWorking(marked)
    expect(restored.draft).toEqual(original)
    expect(marked.draft.source).toBe('broken(')
    restored.draft.recipe.modes[0].label = '変更'
    expect(restored.working!.snapshot.recipe.modes[0].label).toBe(original.recipe.modes[0].label)
    expect(Object.keys(marked).sort()).toEqual(['draft', 'format', 'name', 'updatedAt', 'version', 'working'])
  })

  it('未確認・空コードは復元点にせず、自動で動作確認済みにしない', () => {
    expect(() => restoreWorking(createProject())).toThrow('動作OK版がありません')
    expect(() => markWorking(createProject())).toThrow('実機で動きを確認')
  })

  it('ローカル保存は動作OK版を保つがファイル読み込みでは確認を解除する', () => {
    const project = createProject()
    project.draft.source = 'print("確認対象")'
    const marked = markWorking(project)
    marked.draft.source = 'print("編集中")'
    saveProject(marked)
    expect(loadProject().project.working).toEqual(marked.working)
    const exported = serializeProject(marked)
    expect(JSON.parse(exported).working).toEqual(marked.working)
    const imported = parseProject(exported)
    expect(imported.working).toBeNull()
    expect(imported.draft).toEqual(marked.draft)
    expect(marked.working).not.toBeNull()
  })

  it('不正な確認済みスナップショットを読み込み時に黙って無視しない', () => {
    const project = createProject()
    project.draft.source = 'print(1)'
    const marked = markWorking(project)
    marked.working!.snapshot.settings.ledCount = 999
    expect(() => parseProject(JSON.stringify(marked))).toThrow()
  })
})

describe('コードと機器設定を一体にした編集中作品の保存', () => {
  it('下書きを単一キーに保存し、古い名前付き保存とmpw-sourceより優先して復元する', () => {
    const saved = createProject(); saved.name = '保存済み'; saved.draft.source = 'old code'
    saveProject(saved)
    target.values.set('mpw-source', 'older code kept by legacy editor')
    const draft = structuredClone(saved)
    draft.name = '編集中'; draft.draft.source = 'new code'
    draft.draft.settings.boardId = 'atoms3lite'; draft.draft.settings.ledPin = 8
    draft.draft.recipe.modes[0].label = '新しい光'
    draft.draft.remoteButtons = [{ kind: 'action', id: 'SPARKLE', label: '変身', icon: 'star' }]
    const marked = markWorking(draft)
    expect(saveProjectDraft(marked)).toBe('')
    expect(loadProject()).toEqual({ project: marked, notice: '', sourceAuthoritative: true })
    expect(target.setItem).toHaveBeenLastCalledWith(PROJECT_DRAFT_STORAGE_KEY, serializeProject(marked))
    expect(target.values.get(PROJECT_STORAGE_KEY)).toBe(serializeProject(saved))
    expect(target.values.get('mpw-source')).toBe('older code kept by legacy editor')
  })

  it('空コードの下書きも正として復元し、古い編集コードへ戻さない', () => {
    const draft = createProject()
    target.values.set('mpw-source', 'old nonempty source')
    saveProjectDraft(draft)
    expect(loadProject().sourceAuthoritative).toBe(true)
    expect(loadProject().project.draft.source).toBe('')
  })

  it('不正な下書きは既存の下書き・名前付き保存・legacyコードのどれも変更しない', () => {
    const project = createProject()
    saveProject(project); saveProjectDraft(project)
    target.values.set('mpw-source', 'legacy')
    const original = new Map(target.values)
    project.draft.settings.ledCount = 0
    expect(saveProjectDraft(project)).not.toBe('')
    expect(target.values).toEqual(original)
  })

  it('下書き保存の容量不足で元の全体スナップショットを失わず、成功を返さない', () => {
    const project = createProject(); project.draft.source = 'old'
    saveProjectDraft(project)
    const original = target.values.get(PROJECT_DRAFT_STORAGE_KEY)
    project.draft.source = 'new'; project.draft.settings.ledCount = 25
    target.setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(saveProjectDraft(project)).toContain('保存できませんでした')
    expect(target.values.get(PROJECT_DRAFT_STORAGE_KEY)).toBe(original)
    expect(loadProject().project.draft.source).toBe('old')
  })

  it.each(['{broken', JSON.stringify({ format: 'micropython-writer-project', version: 2 })])('下書きの破損・未知版は保存済み作品へ戻し、復旧前のデータを両方保護する (case %#)', raw => {
    const saved = createProject(); saved.draft.source = 'last named save'; saveProject(saved)
    target.values.set(PROJECT_DRAFT_STORAGE_KEY, raw)
    const original = new Map(target.values)
    target.setItem.mockClear()
    const loaded = loadProject()
    expect(loaded.project).toEqual(saved)
    expect(loaded.sourceAuthoritative).toBe(false)
    expect(loaded.notice).toContain('編集中の作品を読み込めませんでした')
    expect(loaded.notice).toContain('元データは変更していません')
    expect(target.values).toEqual(original)
    expect(target.setItem).not.toHaveBeenCalled()
  })

  it('破損した下書きだけがある場合は注意付き初期値とし、勝手に保存しない', () => {
    target.values.set(PROJECT_DRAFT_STORAGE_KEY, 'corrupt')
    const loaded = loadProject()
    expect(loaded.sourceAuthoritative).toBe(false)
    expect(loaded.project.draft.source).toBe('')
    expect(loaded.notice).toContain('上書き前')
    expect(target.values.get(PROJECT_DRAFT_STORAGE_KEY)).toBe('corrupt')
    expect(target.setItem).not.toHaveBeenCalled()
  })

  it('有効な下書きがあれば古い名前付き保存の破損に影響されない', () => {
    const draft = createProject(); draft.draft.source = 'valid draft'; saveProjectDraft(draft)
    target.values.set(PROJECT_STORAGE_KEY, '{corrupt')
    expect(loadProject()).toEqual({ project: draft, notice: '', sourceAuthoritative: true })
    expect(target.values.get(PROJECT_STORAGE_KEY)).toBe('{corrupt')
  })
})
