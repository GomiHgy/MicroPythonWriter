import { describe, expect, it, vi } from 'vitest'
import { restrictSimulationHost } from '../services/simulation/restrictSimulationHost'
import workerSource from '../services/simulation/worker.ts?raw'

describe('simulation Worker host capability restrictions', () => {
  it('blocks network, nested workers and cross-tab channels without calling the originals', () => {
    const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'WebTransport']
    const original = vi.fn()
    const target = Object.fromEntries(names.map(name => [name, original]))
    expect(restrictSimulationHost(target)).toEqual([])
    for (const name of names) {
      expect(() => target[name]()).toThrow(`Simulation does not support host access: ${name}`)
      expect(Object.getOwnPropertyDescriptor(target, name)?.writable).toBe(false)
      expect(Object.getOwnPropertyDescriptor(target, name)?.configurable).toBe(false)
    }
    expect(original).not.toHaveBeenCalled()
  })
  it('denies persistent storage access but leaves local scheduling and rendering interfaces alone', () => {
    const timer = vi.fn()
    const message = vi.fn()
    const target = { setTimeout: timer, postMessage: message, indexedDB: {}, caches: {} }
    expect(restrictSimulationHost(target)).toEqual([])
    expect(() => target.indexedDB).toThrow('indexedDB')
    expect(() => target.caches).toThrow('caches')
    expect(target.setTimeout).toBe(timer)
    expect(target.postMessage).toBe(message)
  })
  it('shadows inherited browser capabilities and reports unrestrictable own properties', () => {
    const target = Object.create({ fetch: () => 'network' }) as { fetch: () => unknown }
    expect(restrictSimulationHost(target)).toEqual([])
    expect(() => target.fetch()).toThrow('fetch')
    const locked = {}
    Object.defineProperty(locked, 'fetch', { value: () => 'network', configurable: false, writable: false })
    expect(restrictSimulationHost(locked)).toContain('fetch')
  })
  it('closes host capabilities only after bootstrapping the locally served runtime, before user code', () => {
    expect(workerSource.indexOf('await pyodide.runPythonAsync(bootstrap')).toBeLessThan(workerSource.indexOf('restrictSimulationHost(scope)'))
    expect(workerSource.indexOf('restrictSimulationHost(scope)')).toBeLessThan(workerSource.indexOf("await pyodide.runPythonAsync('_sim_execute(_sim_source)'"))
    expect(workerSource).not.toContain('loadPackagesFromImports')
    expect(workerSource).not.toContain('requestPort')
    expect(workerSource).not.toContain('requestDevice')
  })
})
