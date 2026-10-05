import { describe, expect, it, vi } from 'vitest'
import { persistUpdateDraft } from '../services/pwa/UpdateDraft'

describe('更新前の下書き保存', () => {
  it('最新のコードと設定を書き、各値の読戻しを確認する', () => {
    const values = new Map<string, string>([['mpw-source', 'old code']])
    const storage = { setItem: vi.fn((key: string, value: string) => { values.set(key, value) }), getItem: vi.fn((key: string) => values.get(key) ?? null) }
    expect(persistUpdateDraft([['mpw-source', 'new code'], ['mpw-wrap', 'true']], storage)).toBe(true)
    expect(values.get('mpw-source')).toBe('new code')
    expect(storage.getItem).toHaveBeenCalledTimes(2)
  })
  it.each(['write', 'read', 'mismatch'])('%s失敗で再読み込みの許可を出さない', failure => {
    const storage = {
      setItem: vi.fn(() => { if (failure === 'write') throw new Error('quota') }),
      getItem: vi.fn(() => { if (failure === 'read') throw new Error('denied'); return 'old code' }),
    }
    expect(persistUpdateDraft([['mpw-source', 'new code'], ['mpw-wrap', 'true']], storage)).toBe(false)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })
})
