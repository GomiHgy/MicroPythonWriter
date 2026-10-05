/** 通信・実行中にPWA更新を始めず、更新準備中に新たな接続も始めない。 */
export const PWA_UPDATE_BUSY_MESSAGE = 'アプリの更新を準備しています。更新が終わってから、もう一度操作してください。'

export interface PwaActivitySnapshot { readonly active: boolean; readonly updating: boolean }

const owners = new Set<object>()
const listeners = new Set<() => void>()
let snapshot: PwaActivitySnapshot = Object.freeze({ active: false, updating: false })

function publish(active: boolean, updating: boolean): void {
  if (snapshot.active === active && snapshot.updating === updating) return
  snapshot = Object.freeze({ active, updating })
  for (const listener of listeners) listener()
}

export function getPwaActivity(): PwaActivitySnapshot { return snapshot }

export function subscribePwaActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setPwaActivity(owner: object, active: boolean): void {
  if (active) owners.add(owner)
  else owners.delete(owner)
  publish(owners.size > 0, snapshot.updating)
}

/** 同じイベントループ内で確認とロックを行う。失敗時は状態を変えない。 */
export function beginPwaUpdate(): boolean {
  if (snapshot.active || snapshot.updating) return false
  publish(false, true)
  return true
}

export function endPwaUpdate(): void { publish(owners.size > 0, false) }
