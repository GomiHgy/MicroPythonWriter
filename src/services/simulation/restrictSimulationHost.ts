/**
 * 実行エンジンの読込み後、このWorkerだけの通信・永続ストレージ入口を閉じる。
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
  return unavailable
}
