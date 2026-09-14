import { beforeEach, expect, it, vi } from 'vitest'
import { CodeEditor } from '../components/CodeEditor'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  effects: [] as Array<() => unknown>,
  bindings: [] as Array<{ key?: string; run?: () => boolean }>,
  creations: 0,
}))

vi.mock('react', () => ({
  useRef: <Value,>(initial: Value) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: index === 0 ? {} : initial }
    return harness.slots[index]
  },
  useEffect: (effect: () => unknown, dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as unknown[] | undefined
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous[position]))) harness.effects.push(effect)
    harness.slots[index] = dependencies
  },
}))

vi.mock('@codemirror/view', () => ({
  EditorView: class {
    static updateListener = { of: () => [] }
    static lineWrapping = []
    state: { doc: { toString(): string; length: number } }
    constructor(options: { state: { doc: { toString(): string; length: number } } }) { this.state = options.state; harness.creations++ }
    dispatch() {}
    destroy() {}
  },
  keymap: { of: (bindings: typeof harness.bindings) => { harness.bindings = bindings; return [] } },
  lineNumbers: () => [],
}))
vi.mock('@codemirror/state', () => ({ EditorState: { create: ({ doc }: { doc: string }) => ({ doc: { toString: () => doc, length: doc.length } }) } }))
vi.mock('@codemirror/commands', () => ({ defaultKeymap: [], indentWithTab: {} }))
vi.mock('@codemirror/lang-python', () => ({ python: () => [] }))
vi.mock('@codemirror/theme-one-dark', () => ({ oneDark: [] }))

beforeEach(() => { harness.slots = []; harness.cursor = 0; harness.effects = []; harness.bindings = []; harness.creations = 0 })

function render(value: string, onRun: () => void, onSave: () => void) {
  harness.cursor = 0
  CodeEditor({ value, onChange: vi.fn(), onRun, onSave, dark: false, wrap: false })
  harness.effects.splice(0).forEach(effect => effect())
}

it('エディタを再生成せずCtrl+EnterとCtrl+Sを最新の編集内容へ結び直す', () => {
  const sent: string[] = []
  const initialRun = vi.fn(() => sent.push('old run'))
  const initialSave = vi.fn(() => sent.push('old save'))
  render('old', initialRun, initialSave)
  const run = harness.bindings.find(binding => binding.key === 'Ctrl-Enter')?.run
  const save = harness.bindings.find(binding => binding.key === 'Ctrl-s')?.run
  render('edited', () => { sent.push('edited run') }, () => { sent.push('edited save') })
  expect(run?.()).toBe(true)
  expect(save?.()).toBe(true)
  expect(sent).toEqual(['edited run', 'edited save'])
  expect(initialRun).not.toHaveBeenCalled()
  expect(initialSave).not.toHaveBeenCalled()
  expect(harness.creations).toBe(1)
})
