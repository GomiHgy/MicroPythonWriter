import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import panelSource from '../components/MakerPanel.tsx?raw'
import { MakerPanel, type MakerPanelProps } from '../components/MakerPanel'
import { makerMessages } from '../i18n/makerMessages'
import { createProject } from '../services/projects/ProjectStorage'

type Element = ReactElement<Record<string, unknown>>
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, locale: 'ja' as 'ja' | 'en' | 'zh' }))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <Value,>(initial: Value | (() => Value)) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => Value)() : initial
    return [harness.slots[index], (next: Value | ((old: Value) => Value)) => { harness.slots[index] = typeof next === 'function' ? (next as (old: Value) => Value)(harness.slots[index] as Value) : next }]
  },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ locale: harness.locale, t: (key: string, values: Record<string, string | number> = {}) => (harness.locale === 'ja' ? key : makerMessages[key]?.[harness.locale] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match)) }) }))

let props: MakerPanelProps
function render() { harness.cursor = 0; return MakerPanel(props) }
function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function find(predicate: (element: Element) => boolean) { const matches = all(render(), predicate); expect(matches).toHaveLength(1); return matches[0] }
function button(label: string) { return find(element => element.type === 'button' && text(element.props.children as ReactNode) === label) }
function input(id: string) { return find(element => element.props.id === id) }
function event(element: Element, handler: string, value?: unknown) { return (element.props[handler] as (value: unknown) => unknown)(value) }
function click(label: string) { event(button(label), 'onClick') }
function check(id: string, value = true) { event(input(id), 'onChange', { target: { checked: value } }) }
function testStep() { click('次へ：配線を確認'); check('maker-wired'); click('次へ：試しに光らせる') }
function designStep() { testStep(); click('実機確認は後で行い、先に光り方を作る') }
function controlsStep() { designStep(); click('次へ：操作を選ぶ') }
function finishStep() { controlsStep(); props.canMarkWorking = true; check('maker-tested'); click('次へ：完成して持ち出す') }
function sideEffects() { return [props.onConnect, props.onRun, props.onStop, props.onFinish, props.onPrepare, props.onMarkWorking] }

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.locale = 'ja'
  const project = createProject()
  project.draft.settings.firmwareVersion = 'test-version'
  project.draft.source = 'print("test")'
  props = {
    project, onChange: vi.fn(next => { props.project = next }), onSave: vi.fn(), onExport: vi.fn(), onImport: vi.fn(async () => {}), onMarkWorking: vi.fn(), onRestore: vi.fn(), onPrepare: vi.fn(), onOpenProgram: vi.fn(), onOpenAI: vi.fn(), onOpenController: vi.fn(), onConnect: vi.fn(), onRun: vi.fn(), onStop: vi.fn(), onFinish: vi.fn(), onDownloadCandidate: vi.fn(), onUndoReplacement: vi.fn(),
    state: 'disconnected', error: null, notice: '', verifiedStarter: false, canPrepareStarter: true, boardMatches: true, starterReason: 'TEST UNVERIFIED', sourceMatches: false, canMarkWorking: false, canFinish: false, canConfirmStandalone: false, bootSupported: false,
  }
})

describe('作品づくりの順序と安全確認', () => {
  it('初回にコードではなく6ステップと設定を表示し、機器操作をしない', () => {
    const view = render()
    expect(text(view)).toContain('作品をつくる')
    expect(all(view, element => element.props['aria-current'] === 'step').map(element => text(element))).toEqual(['1機器を選ぶ'])
    expect(input('maker-led-count').props.value).toBe(10)
    expect(input('maker-brightness').props.value).toBe(20)
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('ファームウェア版未入力なら次へ進めず、実行・接続も行わない', () => {
    props.project.draft.settings.firmwareVersion = ''
    expect(button('次へ：配線を確認').props.disabled).toBe(true)
    click('次へ：配線を確認')
    expect(input('maker-board')).toBeDefined()
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it.each([['m5nanoc6', 9, 20], ['atoms3lite', 41, 35]] as const)('%sの内蔵ボタンとLEDのピンを分けて表示する', (boardId, buttonPin, rgbPin) => {
    props.project.draft.settings.boardId = boardId
    click('次へ：配線を確認')
    expect(text(render())).toContain(`GPIO ${buttonPin}`)
    expect(text(render())).toContain(`GPIO ${rgbPin}`)
    expect(text(render())).toContain('GPIO 2')
    expect(button('次へ：試しに光らせる').props.disabled).toBe(true)
    click('次へ：試しに光らせる')
    expect(input('maker-wired')).toBeDefined()
  })
  it('配線チェックと段階移動だけでは通信や実行をしない', () => {
    testStep()
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
    expect(input('maker-seen').props.checked).toBe(false)
  })
  it('未検証でもコード準備・表示・保存を通信なしで許可し、検証済みにはしない', () => {
    testStep()
    expect(text(render())).toContain('実機未確認')
    expect(text(render())).toContain('USB接続なしでできます')
    expect(text(render())).toContain('提供側の実機確認済みプログラムにはなりません')
    expect(button('試すコードを準備').props.disabled).toBe(false)
    click('試すコードを準備'); click('コード・通信ログを見る'); click('作品を保存')
    expect(props.onPrepare).toHaveBeenCalledTimes(1)
    expect(props.onOpenProgram).toHaveBeenCalledTimes(1)
    expect(props.onSave).toHaveBeenCalledTimes(1)
    for (const callback of [props.onConnect, props.onRun, props.onMarkWorking]) expect(callback).not.toHaveBeenCalled()
    expect(props.verifiedStarter).toBe(false)
  })
  it.each([false, true])('検証済み=%sでもコード準備・USB接続・実行を別々の明示操作にする', verified => {
    props.verifiedStarter = verified
    testStep()
    click('試すコードを準備')
    expect(props.onPrepare).toHaveBeenCalledTimes(1)
    expect(props.onConnect).not.toHaveBeenCalled()
    expect(props.onRun).not.toHaveBeenCalled()
    props.sourceMatches = true
    click('USBでつなぐ')
    expect(props.onConnect).toHaveBeenCalledTimes(1)
    expect(props.onRun).not.toHaveBeenCalled()
    props.state = 'raw-repl-ready'
    click(verified ? '機器で実行する' : '未検証コードを機器で試す')
    expect(props.onRun).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])('生成できない設定はソース一致=%sでも準備・接続・実行を阻止する', matches => {
    props.canPrepareStarter = false; props.sourceMatches = matches; props.state = 'raw-repl-ready'; props.starterReason = 'PIN CONFLICT'
    testStep()
    expect(text(render())).toContain('設定を見直してから')
    expect(text(render())).toContain('PIN CONFLICT')
    expect(text(render())).not.toContain('この組み合わせの入門プログラムは実機未確認です')
    const primary = find(element => element.type === 'button' && element.props.className === 'primary maker-next')
    expect(primary.props.disabled).toBe(true); event(primary, 'onClick')
    expect(button('生成コードをダウンロード').props.disabled).toBe(true); click('生成コードをダウンロード')
    expect(props.onDownloadCandidate).not.toHaveBeenCalled()
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('接続した機種が違うと機器実行を阻止するがコード準備は許可する', () => {
    props.state = 'raw-repl-ready'; props.boardMatches = false
    testStep()
    expect(text(render())).toContain('接続した機器と、選択した機器が違います')
    expect(button('試すコードを準備').props.disabled).toBe(false); click('試すコードを準備')
    expect(props.onPrepare).toHaveBeenCalledTimes(1)
    props.sourceMatches = true
    expect(button('未検証コードを機器で試す').props.disabled).toBe(true); click('未検証コードを機器で試す')
    expect(props.onRun).not.toHaveBeenCalled()
    props.boardMatches = true
    expect(button('未検証コードを機器で試す').props.disabled).toBe(false)
  })
  it.each(['connected', 'error', 'reconnecting', 'requesting-port', 'opening', 'interrupting', 'entering-raw-repl', 'probing', 'uploading', 'verifying', 'starting', 'stopping', 'setting-boot-mode', 'resetting', 'unsupported'] as const)('%sでは一致するコードがあっても接続・機器実行をしない', state => {
    props.state = state; props.sourceMatches = true
    testStep()
    const primary = find(element => element.type === 'button' && element.props.className === 'primary maker-next')
    expect(primary.props.disabled).toBe(true); event(primary, 'onClick')
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it.each(['raw-repl-ready', 'stopped', 'running', 'running-no-marker'] as const)('%sでは未検証であることを示して実行確認を親に委ねる', state => {
    props.state = state; props.sourceMatches = true
    testStep()
    expect(button('未検証コードを機器で試す').props.disabled).toBe(false)
    click('未検証コードを機器で試す')
    expect(props.onRun).toHaveBeenCalledTimes(1)
  })
  it('Web Serial非対応でも機器操作をせずコード準備はできる', () => {
    props.state = 'unsupported'; testStep()
    expect(button('試すコードを準備').props.disabled).toBe(false); click('試すコードを準備')
    expect(props.onPrepare).toHaveBeenCalledTimes(1)
    props.sourceMatches = true
    expect(button('USBでつなぐ').props.disabled).toBe(true); click('USBでつなぐ')
    expect(props.onConnect).not.toHaveBeenCalled(); expect(props.onRun).not.toHaveBeenCalled()
  })
  it('ボタン・無線の段階でも未検証の説明を表示し、準備・接続・実行を分離する', () => {
    controlsStep(); check('maker-wireless')
    expect(text(render())).toContain('この組み合わせの入門プログラムは実機未確認です')
    expect(text(render())).toContain('USB接続なしでできます')
    expect(text(render())).toContain('接続・状態受信・操作も機器で確かめて')
    click('試すコードを準備')
    expect(props.onPrepare).toHaveBeenCalledTimes(1)
    expect(props.onConnect).not.toHaveBeenCalled(); expect(props.onRun).not.toHaveBeenCalled()
    props.sourceMatches = true; click('USBでつなぐ')
    expect(props.onConnect).toHaveBeenCalledTimes(1); expect(props.onRun).not.toHaveBeenCalled()
    props.state = 'stopped'; click('未検証コードを機器で試す')
    expect(props.onRun).toHaveBeenCalledTimes(1)
    expect(props.onMarkWorking).not.toHaveBeenCalled()
  })
  it('ボタン・無線の段階でも不正な設定と機種不一致の理由を示す', () => {
    controlsStep(); props.canPrepareStarter = false; props.starterReason = 'INVALID RECIPE'; props.boardMatches = false; props.state = 'stopped'
    expect(text(render())).toContain('INVALID RECIPE')
    expect(text(render())).toContain('接続した機器と、選択した機器が違います')
    expect(button('試すコードを準備').props.disabled).toBe(true); click('試すコードを準備')
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('ソース編集後は準備をやり直し、準備だけでは実行しない', () => {
    props.state = 'raw-repl-ready'; props.sourceMatches = true; testStep()
    props.project = { ...props.project, draft: { ...props.project.draft, source: 'changed' } }; props.sourceMatches = false
    expect(button('試すコードを準備').props.disabled).toBe(false); click('試すコードを準備')
    expect(props.onPrepare).toHaveBeenCalledTimes(1); expect(props.onRun).not.toHaveBeenCalled()
  })
  it('同じ機器設定に戻しても以前の配線確認を再利用しない', () => {
    props.state = 'raw-repl-ready'; props.sourceMatches = true; testStep()
    const original = structuredClone(props.project)
    props.project = { ...props.project, draft: { ...props.project.draft, settings: { ...props.project.draft.settings, ledPin: 3 } } }; render()
    props.project = original; render()
    click('次へ：配線を確認')
    expect(input('maker-wired').props.checked).toBe(false)
    expect(button('次へ：試しに光らせる').props.disabled).toBe(true)
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('実行中の表示を実際の点灯確認として扱わない', () => {
    props.state = 'running'; props.canMarkWorking = true
    testStep()
    expect(text(render())).toContain('機器を見て確認')
    expect(input('maker-seen').props.checked).toBe(false)
    check('maker-seen')
    expect(input('maker-seen').props.checked).toBe(true)
    expect(props.onMarkWorking).not.toHaveBeenCalled()
    props.project = { ...props.project, draft: { ...props.project.draft, source: 'changed' } }
    expect(input('maker-seen').props.checked).toBe(false)
    props.project = { ...props.project, draft: { ...props.project.draft, source: 'print("test")' } }
    expect(input('maker-seen').props.checked).toBe(false)
  })
  it('未実行のチェックをプログラム的に呼んでも確認状態を設定できない', () => {
    testStep(); check('maker-seen')
    expect(input('maker-seen').props.checked).toBe(false)
    click('実機確認は後で行い、先に光り方を作る'); click('次へ：操作を選ぶ'); check('maker-tested')
    expect(input('maker-tested').props.checked).toBe(false)
    click('次へ：完成して持ち出す')
    expect(input('maker-tested')).toBeDefined()
  })
  it('機器設定が外部で変わったら最初へ戻し、配線確認も失効させる', () => {
    testStep()
    props.project = { ...props.project, draft: { ...props.project.draft, settings: { ...props.project.draft.settings, boardId: 'atoms3lite' } } }
    expect(input('maker-board').props.value).toBe('atoms3lite')
    click('次へ：配線を確認')
    expect(input('maker-wired').props.checked).toBe(false)
  })
})

describe('選択式レシピとプレビュー', () => {
  it('色切り替えプリセットは異なる2色と短押し操作を設定する', () => {
    designStep(); click('ボタンで色を切り替える')
    const { recipe, remoteButtons } = props.project.draft
    expect(recipe.modes).toHaveLength(2)
    expect(new Set(recipe.modes.map(mode => mode.color)).size).toBe(2)
    expect(recipe).toMatchObject({ shortPress: 'next', doublePress: 'none', longPress: 'toggle', whileHeld: false, wireless: false })
    expect(remoteButtons.map(button => button.label)).toEqual(recipe.modes.map(mode => mode.label))
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it.each([['押している間だけ光る', true, false], ['スマホで光り方を変える', false, true]] as const)('%sプリセットは実行せず設定だけを変更する', (label, held, wireless) => {
    designStep(); click(label)
    expect(props.project.draft.recipe.whileHeld).toBe(held)
    expect(props.project.draft.recipe.wireless).toBe(wireless)
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('光り方は1〜8個で、追加IDは重複しない', () => {
    designStep()
    expect(button('この光り方を削除').props.disabled).toBe(true)
    click('この光り方を削除')
    expect(props.project.draft.recipe.modes).toHaveLength(1)
    for (let index = 0; index < 9; index++) click('光り方を追加（最大8つ）')
    expect(props.project.draft.recipe.modes).toHaveLength(8)
    expect(new Set(props.project.draft.recipe.modes.map(mode => mode.id)).size).toBe(8)
    expect(button('光り方を追加（最大8つ）').props.disabled).toBe(true)
  })
  it('プレビューを機器の受信状態とは表示しない', () => {
    designStep()
    const preview = find(element => element.props.className === 'maker-preview')
    expect(preview.props['aria-label']).toBe('光り方のイメージ。実機の状態ではありません。')
    expect(text(preview)).toContain('保証するものではありません')
    expect(all(preview, element => element.type === 'span')).toHaveLength(10)
  })
  it('押している間の操作が優先され、3種類の操作欄を無効にする', () => {
    designStep(); click('押している間だけ光る'); click('次へ：操作を選ぶ')
    const selectors = all(render(), element => element.type === 'select')
    expect(selectors).toHaveLength(3)
    expect(selectors.every(select => select.props.disabled)).toBe(true)
    const before = structuredClone(props.project.draft.recipe)
    for (const key of ['shortPress', 'doublePress', 'longPress']) event(input(`maker-button-${key}`), 'onChange', { target: { value: 'next' } })
    expect(props.project.draft.recipe).toEqual(before)
  })
  it.each(['shortPress', 'doublePress', 'longPress'] as const)('%sで同じ3つの動作を選べ、以前の消灯設定は新規に選べない', key => {
    controlsStep()
    const choices = all(input(`maker-button-${key}`), element => element.type === 'option')
    expect(choices.map(option => option.props.value)).toEqual(['next', 'toggle', 'none'])
    expect(choices.map(option => text(option))).toEqual(['次の光り方にする', '点灯・消灯を切り替える', '何もしない'])
    const before = structuredClone(props.project.draft.recipe)
    event(input(`maker-button-${key}`), 'onChange', { target: { value: 'off' } })
    expect(props.project.draft.recipe).toEqual(before)
  })
  it.each((['shortPress', 'doublePress', 'longPress'] as const).flatMap(key => (['next', 'toggle', 'none'] as const).map(action => [key, action] as const)))('%sを%sへ変更しても別の操作とコードは変更せず、実機確認は失効する', (key, action) => {
    controlsStep(); props.canMarkWorking = true; check('maker-tested')
    const before = structuredClone(props.project.draft.recipe)
    event(input(`maker-button-${key}`), 'onChange', { target: { value: action } })
    expect(props.project.draft.recipe).toEqual({ ...before, [key]: action })
    expect(props.project.draft.source).toBe('print("test")')
    expect(input('maker-tested').props.checked).toBe(false)
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('旧作品の長押し消灯を表示・保持し、明示変更した場合だけ共通3択へ移行する', () => {
    props.project.draft.recipe.longPress = 'off'
    controlsStep()
    expect(input('maker-button-longPress').props.value).toBe('off')
    const legacy = all(input('maker-button-longPress'), element => element.type === 'option' && element.props.value === 'off')
    expect(legacy).toHaveLength(1)
    expect(legacy[0].props.disabled).toBe(true)
    expect(text(render())).toContain('以前の作品の「長押しで消灯」を保持')
    expect(props.onChange).not.toHaveBeenCalled()
    event(input('maker-button-longPress'), 'onChange', { target: { value: 'toggle' } })
    expect(props.project.draft.recipe.longPress).toBe('toggle')
    expect(all(input('maker-button-longPress'), element => element.type === 'option')).toHaveLength(3)
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it.each(['ja', 'en', 'zh'] as const)('%sでも1回・2回・長押しを区別し、判定時間と共通の値を保持する', locale => {
    controlsStep(); harness.locale = locale
    for (const label of ['短く1回押したら', '短く2回押したら', '長く押したら']) expect(text(render())).toContain(locale === 'ja' ? label : makerMessages[label][locale])
    expect(text(render())).toContain('0.35')
    expect(text(render())).toContain('0.8')
    for (const key of ['shortPress', 'doublePress', 'longPress']) expect(all(input(`maker-button-${key}`), element => element.type === 'option').map(option => option.props.value)).toEqual(['next', 'toggle', 'none'])
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('既存コードの実機確認は生成コードと一致しなくても許可し、相違を案内する', () => {
    controlsStep(); props.canMarkWorking = true; props.sourceMatches = false
    expect(text(render())).toContain('現在の編集コードは')
    check('maker-tested'); click('次へ：完成して持ち出す')
    expect(button('今の版を「動作OK」として保存').props.disabled).toBe(false)
  })
  it('レシピを変更すると操作済みチェックが失効する', () => {
    controlsStep(); props.canMarkWorking = true; check('maker-tested')
    const wireless = input('maker-wireless')
    event(wireless, 'onChange', { target: { checked: true } })
    expect(input('maker-tested').props.checked).toBe(false)
  })
})

describe('完成・保存・読み込み', () => {
  it('実行中は先に停止し、停止後の別操作で自動起動を設定する', () => {
    props.state = 'running'; props.bootSupported = true
    finishStep()
    click('今の版を「動作OK」として保存')
    expect(props.onMarkWorking).toHaveBeenCalledTimes(1)
    click('持ち出す準備のため停止')
    expect(props.onStop).toHaveBeenCalledTimes(1)
    expect(props.onFinish).not.toHaveBeenCalled()
    props.state = 'stopped'; props.canFinish = true
    click('自動起動を設定する')
    expect(props.onFinish).toHaveBeenCalledTimes(1)
  })
  it('保存・機器状態の条件が足りないと自動起動できない', () => {
    props.state = 'stopped'; finishStep()
    expect(button('自動起動を設定する').props.disabled).toBe(true)
    click('自動起動を設定する')
    expect(props.onFinish).not.toHaveBeenCalled()
  })
  it.each([0, 1, undefined])('機器の自動起動設定値%sだけでは持ち出し確認を許可しない', bootOption => {
    props.bootOption = bootOption; finishStep()
    expect(text(render())).not.toContain('自動起動の設定を確認しました')
    expect(input('maker-standalone').props.disabled).toBe(true)
    check('maker-standalone')
    expect(input('maker-standalone').props.checked).toBe(false)
    expect(text(render())).not.toContain('持ち出し確認のチェックを記録しました')
    expect(props.onFinish).not.toHaveBeenCalled()
  })
  it('自動起動の成功証拠があれば機器情報の消去後も独立した持ち出し確認を許可する', () => {
    finishStep()
    props.canConfirmStandalone = true; props.bootOption = undefined; props.bootSupported = false
    expect(text(render())).toContain('自動起動の設定を確認しました')
    expect(text(render())).not.toContain('自動起動の設定方法を確認できていません')
    expect(input('maker-standalone').props.disabled).toBe(false)
    expect(input('maker-standalone').props.checked).toBe(false)
    check('maker-standalone')
    expect(input('maker-standalone').props.checked).toBe(true)
    expect(text(render())).toContain('提供側の検証証明ではありません')
    expect(props.onFinish).not.toHaveBeenCalled()
  })
  it('持ち出し確認後でも成功証拠が失効したらチェックと完了表示を隠す', () => {
    finishStep(); props.canConfirmStandalone = true; check('maker-standalone')
    props.canConfirmStandalone = false
    expect(input('maker-standalone').props.checked).toBe(false)
    expect(input('maker-standalone').props.disabled).toBe(true)
    expect(text(render())).not.toContain('持ち出し確認のチェックを記録しました')
    expect(text(render())).not.toContain('自動起動の設定を確認しました')
    props.canConfirmStandalone = true
    expect(input('maker-standalone').props.checked).toBe(false)
  })
  it('名前・保存・ファイル操作は機器を変更しない', async () => {
    event(input('maker-name'), 'onChange', { target: { value: '魔法の杖' } })
    expect(props.project.name).toBe('魔法の杖')
    expect(input('maker-name').props.maxLength).toBe(64)
    click('作品を保存'); click('作品ファイルを書き出す')
    const file = new File(['{}'], 'artwork.json', { type: 'application/json' })
    const target = { files: [file], value: 'artwork.json' }
    event(find(element => element.type === 'input' && element.props.type === 'file'), 'onChange', { currentTarget: target })
    expect(props.onImport).toHaveBeenCalledWith(file)
    expect(target.value).toBe('')
    expect(props.onSave).toHaveBeenCalledTimes(1)
    expect(props.onExport).toHaveBeenCalledTimes(1)
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('動作OK版がない復元は無効にし、保存済みなら確認処理へ委ねる', () => {
    expect(button('前の動作OK版に戻す').props.disabled).toBe(true)
    click('前の動作OK版に戻す')
    expect(props.onRestore).not.toHaveBeenCalled()
    props.project.working = { snapshot: structuredClone(props.project.draft), confirmedAt: new Date().toISOString() }
    click('前の動作OK版に戻す')
    expect(props.onRestore).toHaveBeenCalledTimes(1)
    props.canUndoReplacement = true
    click('直前の読み込み・復元を取り消す')
    expect(props.onUndoReplacement).toHaveBeenCalledTimes(1)
  })
  it('生成コードのダウンロードは実行と分離し、検証済みとは扱わない', () => {
    expect(text(render())).toContain('実機未検証のコードは、確認済みとして扱わない')
    click('生成コードをダウンロード')
    expect(props.onDownloadCandidate).toHaveBeenCalledTimes(1)
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
})

describe('多言語と案内', () => {
  it.each((['en', 'zh'] as const).flatMap(locale => [0, 1, 2, 3, 4, 5].map(stage => [locale, stage] as const)))('%sの段階%sでも固定案内を翻訳し、設定値を保持する', (locale, stage) => {
    if (stage === 1) click('次へ：配線を確認')
    if (stage === 2) testStep()
    if (stage === 3) designStep()
    if (stage === 4) controlsStep()
    if (stage === 5) finishStep()
    harness.locale = locale
    expect(text(render())).not.toMatch(/[ぁ-んァ-ヶ]/u)
    expect(props.project.draft.settings.firmwareVersion).toBe('test-version')
    for (const callback of sideEffects()) expect(callback).not.toHaveBeenCalled()
  })
  it('コンポーネントの全日本語文字列が英語・中国語で揃う', () => {
    const source = ts.createSourceFile('MakerPanel.tsx', panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const keys: string[] = []
    const visit = (node: ts.Node) => { if (ts.isStringLiteral(node) && /[ぁ-んァ-ヶ一-龯]/u.test(node.text)) keys.push(node.text); ts.forEachChild(node, visit) }
    visit(source)
    expect(keys.length).toBeGreaterThan(100)
    for (const key of keys) {
      expect(makerMessages, key).toHaveProperty(key)
      for (const locale of ['en', 'zh'] as const) {
        const value = makerMessages[key][locale]
        expect(value).not.toMatch(/[ぁ-んァ-ヶ]/u)
        expect([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()).toEqual([...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort())
      }
    }
  })
})
