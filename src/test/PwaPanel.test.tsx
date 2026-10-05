import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PwaPanel } from '../components/PwaPanel'
import { pwaMessages } from '../i18n/pwaMessages'
import type { PwaSnapshot } from '../services/pwa/PwaClient'

const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effectCursor: 0,
  effects: [] as { deps?: unknown[]; cleanup?: () => void }[], pending: [] as (() => void)[],
  emit: null as null | ((value: PwaSnapshot) => void),
  snapshot: {} as PwaSnapshot, activity: { active: false, updating: false },
  locale: 'ja' as 'ja' | 'en' | 'zh',
  start: vi.fn(), dispose: vi.fn(), install: vi.fn(), apply: vi.fn(), cache: vi.fn(), clear: vi.fn(), check: vi.fn(), save: vi.fn(), confirm: vi.fn(),
}))
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <T,>(initial: T | (() => T)) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial
    return [h.slots[index], (next: T) => { h.slots[index] = next }]
  },
  useRef: <T,>(initial: T) => { const index = h.cursor++; if (!(index in h.slots)) h.slots[index] = { current: initial }; return h.slots[index] },
  useSyncExternalStore: (_: unknown, get: () => unknown) => get(),
  useEffect: (run: () => void | (() => void), deps?: unknown[]) => {
    const index = h.effectCursor++, old = h.effects[index]
    if (!old || !deps || deps.some((value, position) => value !== old.deps?.[position])) h.pending.push(() => {
      old?.cleanup?.(); const cleanup = run(); h.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    })
  },
}))
vi.mock('../services/pwa/PwaClient', () => ({
  INITIAL_PWA_SNAPSHOT: { supported: false, installed: false, installAvailable: false, offline: false, ready: false, updateAvailable: false, simulatorReady: false, busy: false, error: '' },
  PwaClient: class {
    constructor(emit: (value: PwaSnapshot) => void) { h.emit = emit }
    start = h.start; dispose = h.dispose; install = h.install; applyUpdate = h.apply; cacheSimulator = h.cache; clearSimulator = h.clear; checkForUpdate = h.check
  },
}))
vi.mock('../services/pwa/PwaActivity', () => ({
  getPwaActivity: () => h.activity, subscribePwaActivity: () => () => {},
  beginPwaUpdate: () => { if (h.activity.active || h.activity.updating) return false; h.activity = { active: false, updating: true }; return true },
  endPwaUpdate: () => { h.activity = { ...h.activity, updating: false } },
}))
vi.mock('../i18n', () => ({ useLocale: () => ({ t: (key: string) => h.locale === 'ja' ? key : pwaMessages[key]?.[h.locale] ?? key }) }))
type Element = ReactElement<Record<string, unknown>>
function all(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...all(node.props.children as ReactNode, predicate)]
}
function render() { h.cursor = 0; h.effectCursor = 0; const view = PwaPanel({ onBeforeUpdate: h.save }); h.pending.splice(0).forEach(run => run()); return view }
function button(label: string) { return all(render(), element => element.type === 'button' && element.props.children === label)[0] }
function click(label: string) { return (button(label).props.onClick as () => unknown)() }
function updateState(patch: Partial<PwaSnapshot>) { h.snapshot = { ...h.snapshot, ...patch }; h.emit?.(h.snapshot) }

beforeEach(() => {
  vi.clearAllMocks(); h.slots = []; h.effects = []; h.pending = []; h.locale = 'ja'; h.activity = { active: false, updating: false }
  h.snapshot = { supported: true, installed: false, installAvailable: false, offline: false, ready: true, updateAvailable: false, simulatorReady: false, busy: false, error: '' }
  h.start.mockImplementation(async () => h.emit?.(h.snapshot)); h.save.mockReturnValue(null); h.confirm.mockReturnValue(true)
  h.apply.mockResolvedValue(true); h.cache.mockResolvedValue(true); h.clear.mockResolvedValue(true); h.check.mockResolvedValue(true)
  vi.stubGlobal('confirm', h.confirm); vi.stubEnv('PROD', true); render()
})
afterEach(() => { h.effects.forEach(effect => effect.cleanup?.()); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('接続前はインストールの手動案内を示し、保存は明示操作だけで行う', () => {
  expect(button('ホーム画面・パソコンに追加')).toBeUndefined()
  expect(JSON.stringify(render())).toContain('ホーム画面に追加')
  expect(h.cache).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled()
  expect(all(render(), element => element.type === 'details')[0].props.open).toBeUndefined()
  updateState({ installAvailable: true })
  click('ホーム画面・パソコンに追加')
  expect(h.install).toHaveBeenCalledOnce()
})
it('USB/BLE/シミュレーション活動中は更新の直接呼出しでも保存・再読込しない', async () => {
  updateState({ updateAvailable: true }); h.activity.active = true
  expect(button('更新して開き直す').props.disabled).toBe(true)
  await click('更新して開き直す')
  expect(h.confirm).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled()
})
it('更新を断ると保存・ワーカー更新をしない', async () => {
  updateState({ updateAvailable: true }); h.confirm.mockReturnValue(false)
  await click('更新して開き直す')
  expect(h.save).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled()
})
it('保存失敗では更新せずロックを解除する', async () => {
  updateState({ updateAvailable: true }); h.save.mockReturnValue('保存できません')
  await click('更新して開き直す')
  expect(h.apply).not.toHaveBeenCalled(); expect(h.activity.updating).toBe(false)
  expect(JSON.stringify(render())).toContain('保存できません')
})
it('確認と保存後だけ更新し、待機中のモーダルを表示して編集を保護する', async () => {
  updateState({ updateAvailable: true })
  let finish!: (value: boolean) => void
  h.apply.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
  const modal = { open: false, showModal: vi.fn(function () { modal.open = true }), close: vi.fn(() => { modal.open = false }) }
  const node = all(render(), element => element.type === 'dialog')[0]
  ;(node.props.ref as { current: unknown }).current = modal
  const pending = click('更新して開き直す')
  render()
  expect(h.save).toHaveBeenCalledOnce(); expect(h.apply).toHaveBeenCalledOnce(); expect(h.activity.updating).toBe(true)
  expect(modal.showModal).toHaveBeenCalledOnce()
  expect(h.confirm.mock.calls[0][0]).toContain('ログ、シミュレーションの状態は引き継がれません')
  finish(true); await pending; render()
  expect(h.activity.updating).toBe(false); expect(modal.close).toHaveBeenCalledOnce()
})
it('任意保存・削除は成功時に通知し、機器操作には触れない', async () => {
  await click('ネットなしでも試せるように保存')
  expect(JSON.stringify(render())).toContain('シミュレーターをオフライン用に保存しました。')
  updateState({ simulatorReady: true }); await click('オフライン用データを削除')
  expect(JSON.stringify(render())).toContain('コードと保存済みプログラムは残っています')
  expect(h.apply).not.toHaveBeenCalled()
})
it('オフライン・保存中は任意ダウンロードを無効化し、未知のエラーも表示する', () => {
  updateState({ offline: true, error: 'new-worker-error' })
  expect(button('ネットなしでも試せるように保存').props.disabled).toBe(true)
  expect(JSON.stringify(render())).toContain('処理を完了できませんでした')
})
it.each(['en', 'zh'] as const)('%sで更新・保存・案内を表示する', locale => {
  h.locale = locale; updateState({ updateAvailable: true })
  expect(button(pwaMessages['更新して開き直す'][locale])).toBeDefined()
  expect(button(pwaMessages['ネットなしでも試せるように保存'][locale])).toBeDefined()
  expect(JSON.stringify(render())).not.toContain('シミュレーターは希望したときだけ保存します')
})
