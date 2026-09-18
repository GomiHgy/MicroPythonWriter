/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest'
import { getBuildInfo } from '../../build/buildInfo'

describe('ビルド情報', () => {
  const now = new Date('2026-09-18T12:00:00.000Z')
  const hash = '1234567890abcdef1234567890abcdef12345678'
  it.each(['', ' M src/App.tsx', '?? new-file.ts'])('Git版と未コミット状態を取得する: %j', status => {
    const readGit = vi.fn().mockReturnValueOnce(hash).mockReturnValueOnce(status)
    expect(getBuildInfo('.', readGit, now)).toEqual({ revision: '1234567', dirty: status !== '', builtAt: now.toISOString() })
  })
  it('Gitがない環境でも生成日時を残す', () => {
    expect(getBuildInfo('.', () => { throw new Error('no git') }, now)).toEqual({ revision: null, dirty: null, builtAt: now.toISOString() })
  })
  it('状態取得失敗を変更なしと扱わない', () => {
    const readGit = vi.fn().mockReturnValueOnce(hash).mockImplementationOnce(() => { throw new Error('status failed') })
    expect(getBuildInfo('.', readGit, now)).toMatchObject({ revision: '1234567', dirty: null })
  })
  it('不正な版情報を表示しない', () => {
    expect(getBuildInfo('.', () => 'not-a-hash', now)).toMatchObject({ revision: null, dirty: null })
  })
})
