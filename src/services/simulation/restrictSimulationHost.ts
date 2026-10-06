/**
 * 実行エンジンの読込み後、このWorkerだけの通信・永続ストレージ・機器通信入口を閉じる。
 * Python互換レイヤと併せた多層防御であり、悪意あるコードの完全なsandboxではない。
 * メイン画面のfetch/Web Serial/Web Bluetooth/作品保存には触れない。
 */
export function restrictSimulationHost(host: object): string[] {
  const unavailable: string[] = []
  const functions = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'WebTransport']
  const storage = ['indexedDB', 'caches']
  for (const name of [...functions, ...storage]) {
    const reject = () => { throw new Error(`Simulation does not support host access: ${name}`) }
    try {
      const existing = Object.getOwnPropertyDescriptor(host, name)
      if (existing && !existing.configurable) {
        if ('value' in existing && existing.writable) Object.defineProperty(host, name, { value: reject, writable: false })
        else if (name in host) unavailable.push(name)
      } else {
        Object.defineProperty(host, name, storage.includes(name)
          ? { get: reject, configurable: false }
          : { value: reject, writable: false, configurable: false })
      }
    } catch { unavailable.push(name) }
  }
  // WorkerNavigatorのWebUSB等は、許可済み機器ならユーザー操作なしで触れる場合がある。
  // own propertyによる隠蔽だけではprototypeのnative getterを直接呼べるため、実体も閉じる。
  // この関数は専用WorkerのglobalThisにだけ適用する。main realmのnavigatorは渡さない。
  let navigator: unknown
  try { navigator = Reflect.get(host, 'navigator') }
  catch { unavailable.push('navigator'); return unavailable }
  if (navigator === undefined || navigator === null) return unavailable
  if (typeof navigator !== 'object' && typeof navigator !== 'function') {
    unavailable.push('navigator')
    return unavailable
  }
  const prototypes: object[] = []
  try {
    for (let prototype = Object.getPrototypeOf(navigator); prototype; prototype = Object.getPrototypeOf(prototype)) {
      prototypes.push(prototype)
    }
  } catch { unavailable.push('navigator'); return unavailable }
  const navigatorTargets: object[] = [navigator, ...prototypes]
  for (const name of ['usb', 'serial', 'hid', 'bluetooth']) {
    const reject = () => { throw new Error(`Simulation does not support host access: navigator.${name}`) }
    // 元getterを呼んだり、機器参照を取り出したりせずdescriptorだけを調べる。
    for (const target of navigatorTargets) {
      try {
        const existing = Object.getOwnPropertyDescriptor(target, name)
        if (target !== navigator && !existing) continue
        Object.defineProperty(target, name, { get: reject, set: undefined, configurable: false, enumerable: existing?.enumerable ?? false })
      } catch {
        if (!unavailable.includes(`navigator.${name}`)) unavailable.push(`navigator.${name}`)
      }
    }
  }
  return unavailable
}
