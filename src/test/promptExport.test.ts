import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyPreparationPrompt, downloadPreparationPrompt, preparationFileName, PREPARATION_COPY_TIMEOUT_MS } from '../services/prompt/PromptExport'
import { setLocale, translate } from '../i18n'

beforeEach(() => { setLocale('ja') })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('準備文のコピーとファイル保存', () => {
  it.each(['en', 'zh'] as const)('%s の秘密情報確認をコピーと保存の両方で使い、内容は翻訳し直さない', async locale => {
    setLocale(locale)
    const confirmation = vi.fn<(message: string) => boolean>(() => false)
    const writeText = vi.fn()
    const prompt = 'API_KEY="コード内の日本語"'
    const copied = await copyPreparationPrompt(prompt, confirmation, () => ({ writeText }))
    const saved = downloadPreparationPrompt(prompt, 'm5nanoc6', 'test-1', confirmation)
    expect(copied.cancelled).toBe(true)
    expect(saved.cancelled).toBe(true)
    expect(confirmation).toHaveBeenCalledTimes(2)
    const question = confirmation.mock.calls[0][0]
    expect(question).toContain(locale === 'en' ? 'passwords or API keys' : '密码或 API 密钥')
    expect(confirmation.mock.calls[1][0]).toBe(question)
    expect(writeText).not.toHaveBeenCalled()
    expect(translate(locale, copied.message)).toContain(locale === 'en' ? 'cancelled' : '已取消')
  })
  it.each(['resolve', 'reject'])('未完了のコピーは有限時間で手動案内し、後の%sで結果を書き換えない', async settle => {
    vi.useFakeTimers()
    let resolve!: () => void
    let reject!: (error: Error) => void
    const writeText = vi.fn(() => new Promise<void>((done, fail) => { resolve = done; reject = fail }))
    let responses = 0
    const operation = copyPreparationPrompt('準備文', () => true, () => ({ writeText })).then(result => { responses++; return result })
    await vi.advanceTimersByTimeAsync(PREPARATION_COPY_TIMEOUT_MS - 1)
    expect(responses).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    const result = await operation
    expect(result).toMatchObject({ ok: false, cancelled: false })
    expect(result.message).toContain('コピーの完了を確認できませんでした')
    expect(result.message).toContain('手動でコピー')
    expect(vi.getTimerCount()).toBe(0)
    if (settle === 'resolve') resolve()
    else reject(new Error('late failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(responses).toBe(1)
    expect(await operation).toBe(result)
  })
  it.each(['resolve', 'reject'])('期限前の%sでは待機タイマーを片付ける', async settle => {
    vi.useFakeTimers()
    const writeText = settle === 'resolve' ? vi.fn(async () => {}) : vi.fn(async () => { throw new Error('denied') })
    const result = await copyPreparationPrompt('準備文', () => true, () => ({ writeText }))
    expect(result.ok).toBe(settle === 'resolve')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(PREPARATION_COPY_TIMEOUT_MS)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('Promise成功前にはコピー成功を返さず、全文を変更しない', async () => {
    let resolve!: () => void
    const writeText = vi.fn(() => new Promise<void>(done => { resolve = done }))
    const text = '準備文\n全文\n末尾'
    let settled = false
    const operation = copyPreparationPrompt(text, () => true, () => ({ writeText })).then(result => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(writeText).toHaveBeenCalledWith(text)
    resolve()
    expect(await operation).toMatchObject({ ok: true, cancelled: false })
  })
  it.each(['unsupported', 'denied', 'getter'])('%s では手動コピー案内を返す', async kind => {
    const result = await copyPreparationPrompt('準備文', () => true, () => {
      if (kind === 'getter') throw new Error('denied')
      return kind === 'unsupported' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    expect(result.ok).toBe(false)
    expect(result.cancelled).toBe(false)
    expect(result.message).toContain('手動でコピー')
  })
  it('準備文全体の秘密情報を確認し、拒否ならコピーしない', async () => {
    const writeText = vi.fn()
    const confirmation = vi.fn(() => false)
    expect(await copyPreparationPrompt('設定\n基準コード\npassword="private"', confirmation, () => ({ writeText }))).toMatchObject({ ok: false, cancelled: true })
    expect(confirmation).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
  })
  it('UTF-8ファイルへ全文を渡し、安全な名前で保存、Blob URLを解放する', async () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild } })
    const text = '日本語\n準備文の全文'
    const result = downloadPreparationPrompt(text, 'm5nanoc6', 'test.1', () => true)
    expect(result.ok).toBe(true)
    const blob = create.mock.calls[0][0] as Blob
    expect(await blob.text()).toBe(text)
    expect(blob.type).toBe('text/plain;charset=utf-8')
    expect(anchor.download).toBe('MicroPython-m5nanoc6-test-1-AI-preparation.txt')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
  it('秘密情報確認をキャンセルしたファイルは生成しない', () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    expect(downloadPreparationPrompt('api_key="private"', 'm5nanoc6', '1', () => false)).toMatchObject({ ok: false, cancelled: true })
    expect(create).not.toHaveBeenCalled()
  })
  it('保存失敗時も作成済みURLと要素を後始末する', () => {
    vi.useFakeTimers()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: () => { throw new Error('denied') }, remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
    expect(downloadPreparationPrompt('準備文', 'm5nanoc6', '1', () => true).ok).toBe(false)
    expect(anchor.remove).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
  it('ファイル名にパス・制御文字・クエリ文字を使わない', () => {
    expect(preparationFileName('../007\n', 'v1/?unsafe')).toMatch(/^MicroPython-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+-AI-preparation\.txt$/)
  })
})
