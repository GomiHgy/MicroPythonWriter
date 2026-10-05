import { createHash, webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createServiceWorkerSource } from '../../build/pwaServiceWorker.ts'
import type { PwaAsset } from '../../build/pwaServiceWorker.ts'

interface RequestLike { url: string; method: string; mode: string }
interface WindowClient { id: string; url: string }
type WorkerEvent = { waitUntil(promise: Promise<unknown>): void; respondWith?(promise: Promise<Response>): void; request?: RequestLike; source?: WindowClient; data?: { type: string }; ports?: { postMessage(value: unknown): void }[] }

function worker(scope = 'https://example.test/MicroPythonWriter/') {
  const sources = new Map<string, string>([
    ['index.html', 'index'], ['assets/app-a.js', 'javascript'], ['third-party-licenses.txt', 'license'],
    ...['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'provenance.json'].map(file => [`simulation-runtime/${file}`, file] as [string, string]),
  ])
  const assets = (runtime: boolean): PwaAsset[] => [...sources].filter(([path]) => path.startsWith('simulation-runtime/') === runtime).map(([path, body]) => ({ path, sha256: createHash('sha256').update(body).digest('hex') }))
  const config = { shellVersion: 'shell-1', simulatorVersion: 'runtime-1', shell: assets(false), simulator: assets(true) }
  const storage = new Map<string, Map<string, Response>>()
  const handlers = new Map<string, (event: WorkerEvent) => void>()
  const page = { id: 'current', url: scope }
  let windows: WindowClient[] = [page]
  const clients = { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => windows) }
  const caches = {
    has: vi.fn(async (name: string) => storage.has(name)),
    open: vi.fn(async (name: string) => {
      if (!storage.has(name)) storage.set(name, new Map())
      const cache = storage.get(name)!
      return { match: vi.fn(async (url: string) => cache.get(url)?.clone()), put: vi.fn(async (url: string, response: Response) => { cache.set(url, response.clone()) }) }
    }),
    delete: vi.fn(async (name: string) => storage.delete(name)),
  }
  const network = vi.fn(async (input: string | RequestLike) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const path = url.pathname.slice(new URL(scope).pathname.length)
    const body = sources.get(path)
    if (body === undefined) throw new Error('network unavailable')
    return new Response(body, { status: 200 })
  })
  const skipWaiting = vi.fn(async () => undefined)
  runInNewContext(createServiceWorkerSource(config), { URL, Uint8Array, crypto: webcrypto, caches, fetch: network, self: { registration: { scope }, clients, skipWaiting, addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler) } })
  const dispatch = async (name: string, supplied: Partial<WorkerEvent> = {}) => {
    const promises: Promise<unknown>[] = []
    let response: Promise<Response> | undefined
    handlers.get(name)!({ waitUntil: promise => { promises.push(promise) }, respondWith: promise => { response = promise }, ...supplied })
    await Promise.all(promises)
    return response ? await response : undefined
  }
  const message = async (type: string, source = page) => {
    let reply: unknown
    await dispatch('message', { source, data: { type }, ports: [{ postMessage(value) { reply = value } }] })
    return reply
  }
  const request = (path: string, mode = 'cors', method = 'GET') => dispatch('fetch', { request: { url: new URL(path, scope).href, mode, method } })
  return { sources, storage, network, caches, clients, skipWaiting, message, request, dispatch, setWindows: (value: WindowClient[]) => { windows = value }, scope }
}

describe('PWA service worker', () => {
  it('installs only the complete shell and never automatically skips waiting', async () => {
    const app = worker()
    await app.dispatch('install')
    expect(app.network.mock.calls).toHaveLength(3)
    expect(app.network.mock.calls.every(([url]) => !String(url).includes('simulation-runtime'))).toBe(true)
    expect(app.skipWaiting).not.toHaveBeenCalled()
    await app.dispatch('activate')
    expect(app.clients.claim).toHaveBeenCalledOnce()
    expect(app.caches.delete).not.toHaveBeenCalled()
  })
  it('serves the installed shell offline and ignores navigation query keys', async () => {
    const app = worker()
    await app.dispatch('install')
    app.network.mockRejectedValue(new Error('offline'))
    expect(await (await app.request('./?work=abc', 'navigate'))?.text()).toBe('index')
    expect(await (await app.request('index.html?secret=ignored', 'navigate'))?.text()).toBe('index')
    expect(await (await app.request('assets/app-a.js'))?.text()).toBe('javascript')
    expect(app.network).toHaveBeenCalledTimes(3)
  })
  it('does not intercept arbitrary requests, POST, query-bearing assets, external or sibling pages', async () => {
    const app = worker()
    await app.dispatch('install')
    for (const [path, mode, method] of [
      ['assets/app-a.js', 'cors', 'POST'], ['assets/app-a.js?code=user', 'cors', 'GET'], ['api/config', 'cors', 'GET'],
      ['user-code.py', 'cors', 'GET'], ['data:application/json,secret', 'cors', 'GET'],
      ['https://ai.example.test/chat', 'cors', 'GET'], ['../OtherApp/', 'navigate', 'GET'], ['api/data', 'navigate', 'GET'],
    ]) expect(await app.request(path, mode, method)).toBeUndefined()
    expect(app.network).toHaveBeenCalledTimes(3)
  })
  it('does not write ordinary simulator fetches into a cache', async () => {
    const app = worker()
    await app.dispatch('install')
    expect(await (await app.request('simulation-runtime/pyodide.mjs'))?.text()).toBe('pyodide.mjs')
    expect(await app.message('PWA_STATUS')).toEqual({ ok: true, simulatorReady: false })
    expect([...app.storage.keys()].every(name => !name.includes('simulator'))).toBe(true)
  })
  it('explicitly saves all six runtime/provenance files and supports offline simulation only when complete', async () => {
    const app = worker()
    await app.dispatch('install')
    expect(await app.message('PWA_CACHE_SIMULATOR')).toEqual({ ok: true, simulatorReady: true })
    expect(app.network).toHaveBeenCalledTimes(9)
    app.network.mockRejectedValue(new Error('offline'))
    expect(await (await app.request('simulation-runtime/pyodide.asm.wasm'))?.text()).toBe('pyodide.asm.wasm')
    expect(await app.message('PWA_STATUS')).toEqual({ ok: true, simulatorReady: true })
  })
  it('deletes only its own partial optional cache after a failed or mismatched download', async () => {
    for (const bad of [undefined, 'wrong build']) {
      const app = worker()
      await app.dispatch('install')
      app.storage.set('another-app:shell', new Map())
      app.storage.set('micropythonwriter-pwa:%2FOtherApp%2F:simulator:old', new Map())
      if (bad === undefined) app.sources.delete('simulation-runtime/python_stdlib.zip')
      else app.sources.set('simulation-runtime/python_stdlib.zip', bad)
      expect(await app.message('PWA_CACHE_SIMULATOR')).toEqual({ ok: false, error: 'download-failed', simulatorReady: false })
      expect([...app.storage.keys()]).toContain('another-app:shell')
      expect([...app.storage.keys()]).toContain('micropythonwriter-pwa:%2FOtherApp%2F:simulator:old')
      expect([...app.storage.keys()].some(name => name.endsWith('simulator:runtime-1'))).toBe(false)
    }
  })
  it('cleans its failed shell only, retaining prior versions and other apps', async () => {
    const app = worker()
    app.storage.set('micropythonwriter-pwa:%2FMicroPythonWriter%2F:shell:older', new Map())
    app.storage.set('another-app:shell', new Map())
    app.sources.set('index.html', 'wrong deployed build')
    await expect(app.dispatch('install')).rejects.toThrow('download-failed')
    expect([...app.storage.keys()]).toEqual(['micropythonwriter-pwa:%2FMicroPythonWriter%2F:shell:older', 'another-app:shell'])
  })
  it('does not risk deleting an existing complete version if a reinstall is offline', async () => {
    const app = worker()
    await app.dispatch('install')
    app.network.mockRejectedValue(new Error('offline'))
    await app.dispatch('install')
    expect(app.network).toHaveBeenCalledTimes(3)
    expect(app.caches.delete).not.toHaveBeenCalled()
  })
  it('clears only the current optional runtime and not user data or other versions', async () => {
    const app = worker()
    await app.dispatch('install')
    await app.message('PWA_CACHE_SIMULATOR')
    app.storage.set('micropythonwriter-pwa:%2FMicroPythonWriter%2F:simulator:older', new Map())
    expect(await app.message('PWA_CLEAR_SIMULATOR')).toEqual({ ok: true, simulatorReady: false })
    expect([...app.storage.keys()]).toContain('micropythonwriter-pwa:%2FMicroPythonWriter%2F:simulator:older')
    expect([...app.storage.keys()].some(name => name.includes('shell:'))).toBe(true)
  })
  it('accepts explicit activation only from the sole same-scope window including uncontrolled tabs', async () => {
    const app = worker()
    const current = { id: 'current', url: app.scope }
    app.setWindows([current, { id: 'other', url: app.scope + '?another' }])
    expect(await app.message('PWA_ACTIVATE_UPDATE')).toEqual({ ok: false, error: 'multiple-clients' })
    expect(app.skipWaiting).not.toHaveBeenCalled()
    expect(app.clients.matchAll).toHaveBeenLastCalledWith({ type: 'window', includeUncontrolled: true })
    app.setWindows([current, { id: 'unrelated', url: 'https://example.test/OtherApp/' }])
    expect(await app.message('PWA_ACTIVATE_UPDATE')).toEqual({ ok: true })
    expect(app.skipWaiting).toHaveBeenCalledOnce()
  })
  it('rejects messages from sibling apps and handles a custom-domain root scope', async () => {
    const app = worker('https://example.test/')
    await app.dispatch('install')
    expect(await (await app.request('./', 'navigate'))?.text()).toBe('index')
    const scoped = worker()
    expect(await scoped.message('PWA_CACHE_SIMULATOR', { id: 'unrelated', url: 'https://example.test/OtherApp/' })).toEqual({ ok: false, error: 'out-of-scope' })
    expect(scoped.network).not.toHaveBeenCalled()
  })
})
