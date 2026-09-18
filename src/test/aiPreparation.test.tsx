import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPreparationPanel } from '../components/AiPreparationPanel'
import type { WorkshopPreparation } from '../hooks/useWorkshopPreparation'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { PREPARATION_COPY_TIMEOUT_MS } from '../services/prompt/PromptExport'
import type { WorkshopProfile } from '../services/workshop/WorkshopProfile'
import { setLocale } from '../i18n'

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, focus: vi.fn(), select: vi.fn() }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [harness.slots[index], (next: Value | ((previous: Value) => Value)) => { harness.slots[index] = typeof next === 'function' ? (next as (previous: Value) => Value)(harness.slots[index] as Value) : next }]
  },
  useRef: () => { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: { focus: harness.focus, select: harness.select } }; return harness.slots[index] },
  useEffect: (effect: () => void, dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as unknown[] | undefined
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous[position]))) harness.effects.push(effect)
    harness.slots[index] = dependencies
  },
}))

const profile: WorkshopProfile = { boardId: 'm5nanoc6', materialId: 'test-material', revision: 'test-1', displayName: 'テスト教材', firmwareVersion: 'test-ui-2', ledModel: 'WS2812B', ledCount: 37, ledPin: 2, ledBpp: 3, maxBrightnessPercent: 30, features: { button: true, ble: false, controller: false }, baseline: { code: '', verification: null } }
function preparation(): WorkshopPreparation {
  const context = createWorkshopContext(profile)
  return { profiles: [{ id: 'test', profile }], selectedId: 'test', selectedProfile: profile, context, prompt: buildStartPrompt(context), draft: profile, draftErrors: [], hasPendingChanges: false, isImporting: false, notice: '', selectProfile: vi.fn(), adoptProjectSettings: vi.fn(), editDraft: vi.fn(), editLedSettings: vi.fn(), applyDraft: vi.fn(() => true), saveDraft: vi.fn(), confirmBaseline: vi.fn(), importBaseline: vi.fn(async () => {}), resetProfile: vi.fn() }
}
type Element = ReactElement<Record<string, unknown>>
function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function content(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(content).join('')
  if (isValidElement<Record<string, unknown>>(node)) return content(node.props.children as ReactNode)
  return String(node)
}
function find(node: ReactNode, predicate: (element: Element) => boolean) { const result = all(node, predicate); expect(result).toHaveLength(1); return result[0] }
function button(node: ReactNode, label: string) { return find(node, element => element.type === 'button' && content(element.props.children as ReactNode).includes(label)) }
function event(element: Element, name: string, value?: unknown) { return (element.props[name] as (value: unknown) => unknown)(value) }
function render(prep: WorkshopPreparation, onOpenProgram = vi.fn()) { harness.cursor = 0; const node = AiPreparationPanel({ preparation: prep, onOpenProgram }); harness.effects.splice(0).forEach(effect => effect()); return node }
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

beforeEach(() => { setLocale('ja'); harness.slots = []; harness.cursor = 0; harness.effects = []; harness.focus.mockClear(); harness.select.mockClear(); vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } }); vi.stubGlobal('confirm', vi.fn(() => true)) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('AIの準備パネル', () => {
  it.each(['ja', 'en', 'zh'] as const)('%s の書き込み案内は選択機種のページだけを開き、版やコードを変更しない', locale => {
    setLocale(locale)
    for (const [boardId, name, path] of [['m5nanoc6', 'M5NanoC6', 'nanoc6'], ['atoms3lite', 'AtomS3Lite', 'atoms3-lite']] as const) {
      const selectedProfile = { ...profile, boardId, firmwareVersion: null }
      const prep = { ...preparation(), selectedProfile, prompt: '' }
      const panel = render(prep)
      const guide = find(panel, element => element.type === 'section' && element.props['aria-labelledby'] === 'ai-firmware-heading')
      const link = find(guide, element => element.type === 'a')
      expect(link.props.href).toBe(`https://burner.m5stack.com/device/${path}`)
      expect(content(link)).toContain(name)
      expect(link.props.target).toBe('_blank')
      expect(link.props.rel).toBe('noopener noreferrer')
      expect(link.props.onClick).toBeUndefined()
      expect(content(guide)).toContain('UIFlow2.0')
      expect(all(guide, element => element.type === 'li')).toHaveLength(3)
      expect(content(guide)).toContain(locale === 'ja' ? '飛ばせます' : locale === 'en' ? 'skip this step' : '跳过此步骤')
      expect(content(guide)).toContain(locale === 'ja' ? '消える場合' : locale === 'en' ? 'may erase' : '可能会清除')
      if (locale !== 'ja') expect(content(guide)).not.toMatch(/[ぁ-んァ-ヶ]/u)
      expect(prep.selectedProfile.firmwareVersion).toBeNull()
      expect(prep.editLedSettings).not.toHaveBeenCalled()
      expect(prep.editDraft).not.toHaveBeenCalled()
    }
  })

  it('機種を選ぶまでは書き込みページのリンクを表示しない', () => {
    const node = render({ ...preparation(), selectedProfile: null })
    expect(all(node, element => element.type === 'a' && String(element.props.href).includes('burner.m5stack.com'))).toHaveLength(0)
  })

  it.each(['ja', 'en', 'zh'] as const)('%s ではLED_BPPの設定欄を表示せず、準備文はRGBの3固定を維持する', locale => {
    setLocale(locale)
    const prep = preparation()
    const context = createWorkshopContext(profile, locale)
    prep.context = context
    prep.prompt = buildStartPrompt(context)
    const panel = render(prep)
    const advancedComponent = find(panel, element => typeof element.type === 'function')
    harness.slots = []; harness.cursor = 0
    const advanced = (advancedComponent.type as (props: typeof advancedComponent.props) => ReactNode)(advancedComponent.props)
    for (const node of [panel, advanced]) {
      expect(all(node, element => element.type === 'label' && content(element).includes('LED_BPP'))).toHaveLength(0)
    }
    expect(all(advanced, element => element.type === 'input' && element.props.type === 'number')).toHaveLength(0)
    expect(prep.prompt).toContain('LED_BPP: 3')
    expect(prep.editDraft).not.toHaveBeenCalled()
  })

  it('3つのLED設定は詳細設定を開かず編集できる', () => {
    const prep = preparation()
    const node = render(prep)
    const settings = find(node, item => item.type === 'fieldset' && item.props.className === 'ai-led-settings')
    for (const [label, key, value] of [['LED数', 'ledCount', '10'], ['最大輝度（%）', 'maxBrightnessPercent', '20'], ['外部LEDピン（GPIO）', 'ledPin', '3']]) {
      const field = find(settings, item => item.type === 'label' && content(item).startsWith(label))
      event(find(field, item => item.type === 'input'), 'onChange', { target: { value } })
      expect(prep.editLedSettings).toHaveBeenLastCalledWith({ [key]: Number(value) })
    }
    expect(prep.editDraft).not.toHaveBeenCalled()
  })
  it('対象UIFlow2版と指定の5種類のLED型番を主画面で入力して自動保存へ渡す', () => {
    const prep = preparation()
    const settings = find(render(prep), item => item.type === 'fieldset' && item.props.className === 'ai-led-settings')
    const firmware = find(settings, item => item.type === 'label' && content(item).startsWith('対象UIFlow2ファームウェア版'))
    const input = find(firmware, item => item.type === 'input')
    expect(input.props.value).toBe('test-ui-2')
    expect(input.props.maxLength).toBe(200)
    event(input, 'onChange', { target: { value: '2.3.6' } })
    expect(prep.editLedSettings).toHaveBeenLastCalledWith({ firmwareVersion: '2.3.6' })
    event(input, 'onChange', { target: { value: '' } })
    expect(prep.editLedSettings).toHaveBeenLastCalledWith({ firmwareVersion: null })
    const model = find(settings, item => item.type === 'select')
    expect(all(model, item => item.type === 'option').map(item => item.props.value)).toEqual(['', 'WS2812B', 'WS2812B-MINI', 'WS2812C-2020', 'SK6812', 'SK6812MINI'])
    for (const value of ['WS2812B', 'WS2812B-MINI', 'WS2812C-2020', 'SK6812', 'SK6812MINI']) {
      event(model, 'onChange', { target: { value } })
      expect(prep.editLedSettings).toHaveBeenLastCalledWith({ ledModel: value })
    }
    for (const value of ['', 'unknown-led']) {
      event(model, 'onChange', { target: { value } })
      expect(prep.editLedSettings).toHaveBeenLastCalledWith({ ledModel: null })
    }
    expect(prep.editDraft).not.toHaveBeenCalled()
  })
  it('未入力の版や型番を推測せず、キット番号を要求しない', () => {
    const prep = { ...preparation(), selectedProfile: { ...profile, firmwareVersion: null, ledModel: null } }
    const panel = render(prep)
    const settings = find(panel, item => item.type === 'fieldset' && item.props.className === 'ai-led-settings')
    expect(find(settings, item => item.type === 'select').props.value).toBe('')
    expect(find(settings, item => item.type === 'input' && item.props.maxLength === 200).props.value).toBe('')
    const devices = find(panel, item => item.type === 'select' && item.props.id === 'ai-kit')
    expect(content(devices)).toContain('テスト教材')
    expect(content(panel)).not.toMatch(/キット|講師|教材ID/)
    const teacher = find(panel, element => typeof element.type === 'function')
    harness.slots = []; harness.cursor = 0
    const advanced = (teacher.type as (props: typeof teacher.props) => ReactNode)(teacher.props)
    expect(content(advanced)).not.toMatch(/キット|講師|教材ID/)
    expect(content(advanced)).not.toContain('対象UIFlow2ファームウェア版')
    expect(content(advanced)).not.toContain('LED型番')
  })
  it('英語・中国語へ切り替えてもプレビュー状態と入力済みデータを維持する', () => {
    const prep = preparation()
    event(find(render(prep), element => element.type === 'details' && element.props.className === 'ai-preview'), 'onToggle', { currentTarget: { open: true } })
    for (const [locale, label] of [['en', 'Copy setup prompt for AI'], ['zh', '复制给 AI 的准备提示词']] as const) {
      setLocale(locale)
      const node = render(prep)
      expect(content(node)).toContain(label)
      expect(content(node)).toContain('テスト教材')
      expect(find(node, element => element.type === 'details' && element.props.className === 'ai-preview').props.open).toBe(true)
      expect(find(node, element => element.type === 'textarea').props.value).toBe(prep.prompt)
      expect(prep.selectProfile).not.toHaveBeenCalled()
      expect(prep.editDraft).not.toHaveBeenCalled()
    }
  })
  it.each(['m5nanoc6', 'atoms3lite'] as const)('%s の内蔵LED・外付けLED・ボタンを区別して表示する', boardId => {
    const prep = { ...preparation(), draft: { ...profile, boardId } }
    const panel = render(prep)
    const teacher = find(panel, element => typeof element.type === 'function')
    harness.slots = []; harness.cursor = 0
    const node = (teacher.type as (props: typeof teacher.props) => ReactNode)(teacher.props)
    const text = content(node)
    expect(text).toContain('外付けLED: GPIO2')
    expect(text).toContain(boardId === 'm5nanoc6' ? '本体ボタン: GPIO9' : '本体ボタン: GPIO41')
    expect(text).toContain(boardId === 'm5nanoc6' ? '内蔵RGB LED: GPIO20' : '内蔵RGB LED: GPIO35')
    if (boardId === 'atoms3lite') expect(text).not.toContain('内蔵RGB電源')
  })
  it('詳細設定の開閉や確認者入力をリセットせず、英語・中国語の全ラベルを表示する', () => {
    const prep = preparation()
    const teacher = find(render(prep), element => typeof element.type === 'function')
    harness.slots = []; harness.cursor = 0
    const renderTeacher = () => { harness.cursor = 0; return (teacher.type as (props: typeof teacher.props) => ReactNode)(teacher.props) }
    const nameInput = find(renderTeacher(), element => element.type === 'label' && element.props.className === 'ai-confirm-name')
    event(find(nameInput, element => element.type === 'input'), 'onChange', { target: { value: '講師の入力データ' } })
    for (const [locale, title] of [['en', 'Advanced settings (optional)'], ['zh', '详细设置（按需使用）']] as const) {
      setLocale(locale)
      const node = renderTeacher()
      expect(content(node)).toContain(title)
      expect(content(node)).not.toMatch(/[ぁ-んァ-ヶ]/)
      const label = find(node, element => element.type === 'label' && element.props.className === 'ai-confirm-name')
      expect(find(label, element => element.type === 'input').props.value).toBe('講師の入力データ')
      expect(prep.editDraft).not.toHaveBeenCalled()
    }
  })
  it.each([{ ledModel: 'SK6812' }, { firmwareVersion: 'another-ui-version' }])('主画面で %j を変えたら古い実機確認チェックを流用できない', changed => {
    let prep = { ...preparation(), draft: { ...profile, baseline: { code: 'print("baseline")', verification: null } } }
    const advanced = find(render(prep), element => typeof element.type === 'function')
    harness.slots = []; harness.cursor = 0
    const renderAdvanced = () => { harness.cursor = 0; return (advanced.type as (props: typeof advanced.props) => ReactNode)({ ...advanced.props, preparation: prep }) }
    const name = find(renderAdvanced(), element => element.type === 'label' && element.props.className === 'ai-confirm-name')
    event(find(name, element => element.type === 'input'), 'onChange', { target: { value: 'Device owner' } })
    const confirmation = find(renderAdvanced(), element => element.type === 'label' && content(element).includes('この基準コードを、指定の対象機器'))
    event(find(confirmation, element => element.type === 'input'), 'onChange', { target: { checked: true } })
    expect(button(renderAdvanced(), '実機確認を登録').props.disabled).toBe(false)
    prep = { ...prep, draft: { ...prep.draft, ...changed } }
    const changedPanel = renderAdvanced()
    expect(button(changedPanel, '実機確認を登録').props.disabled).toBe(true)
    const changedConfirmation = find(changedPanel, element => element.type === 'label' && content(element).includes('この基準コードを、指定の対象機器'))
    expect(find(changedConfirmation, element => element.type === 'input').props.checked).toBe(false)
    expect(prep.confirmBaseline).not.toHaveBeenCalled()
  })
  it('v2確認は独立した明示操作とし、条件変更後の再確認へチェックを流用しない', () => {
    let prep = { ...preparation(), draft: { ...profile, baseline: { code: 'print("baseline")', verification: null } } }
    const advanced = find(render(prep), element => typeof element.type === 'function')
    harness.slots = []; harness.cursor = 0
    const renderAdvanced = () => { harness.cursor = 0; return (advanced.type as (props: typeof advanced.props) => ReactNode)({ ...advanced.props, preparation: prep }) }
    const checkbox = (text: string) => find(find(renderAdvanced(), element => element.type === 'label' && content(element).includes(text)), element => element.type === 'input')
    const name = find(renderAdvanced(), element => element.type === 'label' && element.props.className === 'ai-confirm-name')
    event(find(name, element => element.type === 'input'), 'onChange', { target: { value: 'Device owner' } })
    expect(checkbox('NanoLED v2の').props.checked).toBe(false)
    event(checkbox('この基準コードを、'), 'onChange', { target: { checked: true } })
    event(checkbox('NanoLED v2の'), 'onChange', { target: { checked: true } })
    event(button(renderAdvanced(), '実機確認を登録'), 'onClick')
    expect(prep.confirmBaseline).toHaveBeenLastCalledWith('Device owner', false, true)
    prep = { ...prep, draft: { ...prep.draft, firmwareVersion: 'different-version' } }
    expect(checkbox('NanoLED v2の').props.checked).toBe(false)
    expect(button(renderAdvanced(), '実機確認を登録').props.disabled).toBe(true)
    event(checkbox('この基準コードを、'), 'onChange', { target: { checked: true } })
    expect(checkbox('NanoLED v2の').props.checked).toBe(false)
    event(button(renderAdvanced(), '実機確認を登録'), 'onClick')
    expect(prep.confirmBaseline).toHaveBeenLastCalledWith('Device owner', false, false)
  })
  it('コピー完了が返らなくても操作を復帰し、遅い完了で成功表示に変えない', async () => {
    vi.useFakeTimers()
    let resolve!: () => void
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise(done => { resolve = done }))
    const prep = preparation()
    event(button(render(prep), '準備文をコピー'), 'onClick')
    expect(find(render(prep), element => element.type === 'select' && element.props.id === 'ai-kit').props.disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(PREPARATION_COPY_TIMEOUT_MS)
    const node = render(prep)
    expect(button(node, '準備文をコピー').props.disabled).toBe(false)
    expect(find(node, element => element.type === 'select' && element.props.id === 'ai-kit').props.disabled).toBe(false)
    expect(content(node)).toContain('コピーの完了を確認できませんでした')
    expect(harness.select).toHaveBeenCalledOnce()
    resolve(); await flush()
    expect(content(render(prep))).not.toContain('準備文をコピーしたよ')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('基準コード読込中も以前の準備文をコピー・保存・プレビューしない', () => {
    const node = render({ ...preparation(), isImporting: true })
    expect(button(node, '準備文をコピー').props.disabled).toBe(true)
    expect(button(node, 'ファイルで保存').props.disabled).toBe(true)
    expect(all(node, element => element.type === 'textarea')).toHaveLength(0)
    expect(content(node)).toContain('基準コードを読み込み中')
  })
  it('未適用の講師設定がある間は古い準備文をコピー・保存しない', () => {
    const prep = { ...preparation(), hasPendingChanges: true }
    const node = render(prep)
    expect(button(node, '準備文をコピー').props.disabled).toBe(true)
    expect(button(node, 'ファイルで保存').props.disabled).toBe(true)
    event(button(node, '準備文をコピー'), 'onClick')
    event(button(node, 'ファイルで保存'), 'onClick')
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(content(node)).toContain('先に「設定を適用」')
    expect(all(node, element => element.type === 'textarea')).toHaveLength(0)
  })
  it('未選択・設定不備ではコピーと保存を無効にし、プログラムへは進める', () => {
    const prep = { ...preparation(), selectedId: null, selectedProfile: null, context: null, prompt: '', draft: null }
    const open = vi.fn()
    const node = render(prep, open)
    expect(button(node, '準備文をコピー').props.disabled).toBe(true)
    expect(button(node, 'ファイルで保存').props.disabled).toBe(true)
    event(button(node, 'プログラム'), 'onClick')
    expect(open).toHaveBeenCalledOnce()
    expect(content(node)).not.toContain('machine.bitstream')
  })
  it('プレビューとコピーで同じ全文を使い、成功通知はPromise成功後だけ', async () => {
    const prep = preparation()
    let resolve!: () => void
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise(done => { resolve = done }))
    const node = render(prep)
    const preview = find(node, element => element.type === 'textarea')
    expect(preview.props.value).toBe(prep.prompt)
    expect(preview.props.readOnly).toBe(true)
    event(button(node, '準備文をコピー'), 'onClick')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(preview.props.value)
    expect(content(render(prep))).not.toContain('準備文をコピーしたよ')
    resolve(); await flush()
    expect(content(render(prep))).toContain('準備文をコピーしたよ')
  })
  it.each(['rejected', 'unsupported'])('%s では成功と表示せず、全文を選択して手動コピーへ誘導', async mode => {
    if (mode === 'rejected') vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'))
    else vi.stubGlobal('navigator', {})
    const prep = preparation()
    event(button(render(prep), '準備文をコピー'), 'onClick')
    await flush()
    const node = render(prep)
    expect(content(node)).toContain('手動でコピー')
    expect(content(node)).not.toContain('準備文をコピーしたよ')
    expect(find(node, element => element.type === 'details' && element.props.className === 'ai-preview').props.open).toBe(true)
    expect(harness.focus).toHaveBeenCalled()
    expect(harness.select).toHaveBeenCalled()
    event(button(node, '全文を選択'), 'onClick')
    expect(harness.select).toHaveBeenCalledTimes(2)
  })
  it('キャンセルした秘密情報付き準備文はコピーせず、内容確認へ案内', async () => {
    vi.mocked(confirm).mockReturnValue(false)
    const prep = { ...preparation(), prompt: '準備文\nTOKEN="private"' }
    event(button(render(prep), '準備文をコピー'), 'onClick')
    await flush()
    const node = render(prep)
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(content(node)).toContain('キャンセルしました')
    expect(find(node, element => element.type === 'textarea').props.value).toBe(prep.prompt)
  })
  it('通常リンクはコードや準備文をURLへ含まずコピーと別操作', () => {
    const node = render(preparation())
    const aiLinks = find(node, element => element.props['aria-label'] === '好きなAIを開く')
    const links = all(aiLinks, element => element.type === 'a')
    expect(links).toHaveLength(4)
    expect(links.map(link => link.props.href)).toEqual(['https://chatgpt.com/', 'https://claude.ai/', 'https://gemini.google.com/', 'https://chat.deepseek.com/'])
    for (const link of links) {
      const url = new URL(link.props.href as string)
      expect(url.search).toBe(''); expect(url.hash).toBe('')
      expect(link.props.target).toBe('_blank')
      expect(link.props.rel).toBe('noopener noreferrer')
      expect(link.props.onClick).toBeUndefined()
    }
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })
  it('保存も同じ生成済み文字列を使用する', async () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn(), remove: vi.fn() }), body: { appendChild: vi.fn() } })
    const prep = preparation()
    const node = render(prep)
    event(button(node, 'ファイルで保存'), 'onClick')
    const blob = create.mock.calls[0][0] as Blob
    expect(await blob.text()).toBe(find(node, element => element.type === 'textarea').props.value)
    vi.runAllTimers()
  })
})
