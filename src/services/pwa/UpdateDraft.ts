/** 再読み込み前に、編集中コードと設定の保存・読戻しを同期的に確認する。 */
export function persistUpdateDraft(entries: readonly (readonly [string, string])[], storage: Pick<Storage, 'setItem' | 'getItem'> = localStorage): boolean {
  try {
    for (const [key, value] of entries) {
      storage.setItem(key, value)
      if (storage.getItem(key) !== value) return false
    }
    return true
  } catch { return false }
}
