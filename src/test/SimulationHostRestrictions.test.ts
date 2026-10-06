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
  it('blocks own and inherited device APIs without evaluating their getters', () => {
    const usb = { getDevices: vi.fn(), requestDevice: vi.fn() }
    const usbGetter = vi.fn(() => usb)
    const hidGetter = vi.fn(() => ({ getDevices: vi.fn() }))
    const ancestor = {}
    Object.defineProperty(ancestor, 'usb', { get: usbGetter, configurable: true })
    const prototype = Object.create(ancestor) as object
    Object.defineProperty(prototype, 'hid', { get: hidGetter, configurable: true })
    Object.defineProperty(prototype, 'serial', { value: { getPorts: vi.fn() }, configurable: true })
    const navigator = Object.create(prototype) as Record<string, unknown>
    navigator.bluetooth = { getDevices: vi.fn() }
    navigator.userAgent = 'Android test browser'
    expect(restrictSimulationHost({ navigator })).toEqual([])
    for (const name of ['usb', 'serial', 'hid', 'bluetooth']) {
      expect(() => navigator[name]).toThrow(`navigator.${name}`)
      expect(Object.getOwnPropertyDescriptor(navigator, name)?.configurable).toBe(false)
    }
    // 隠蔽したown propertyを避けてprototypeのgetterを直接呼んでも接続先を取得できない。
    expect(() => Object.getOwnPropertyDescriptor(ancestor, 'usb')?.get?.call(navigator)).toThrow('navigator.usb')
    expect(() => Object.getOwnPropertyDescriptor(prototype, 'hid')?.get?.call(navigator)).toThrow('navigator.hid')
    expect(() => Reflect.get(prototype, 'serial', navigator)).toThrow('navigator.serial')
    expect(usbGetter).not.toHaveBeenCalled()
    expect(hidGetter).not.toHaveBeenCalled()
    expect(usb.getDevices).not.toHaveBeenCalled()
    expect(usb.requestDevice).not.toHaveBeenCalled()
    expect(navigator.userAgent).toBe('Android test browser')
  })
  it('closes every exposed getter in the prototype chain, not just the nearest one', () => {
    const farGetter = vi.fn(() => 'far USB')
    const nearGetter = vi.fn(() => 'near USB')
    const far = {}
    Object.defineProperty(far, 'usb', { get: farGetter, configurable: true })
    const near = Object.create(far) as object
    Object.defineProperty(near, 'usb', { get: nearGetter, configurable: true })
    const navigator = Object.create(near) as Record<string, unknown>
    expect(restrictSimulationHost({ navigator })).toEqual([])
    for (const target of [navigator, near, far]) {
      expect(() => Object.getOwnPropertyDescriptor(target, 'usb')?.get?.call(navigator)).toThrow('navigator.usb')
    }
    expect(farGetter).not.toHaveBeenCalled()
    expect(nearGetter).not.toHaveBeenCalled()
  })
  it('reports locked native getters even when an own shadow can be installed', () => {
    const nativeGetter = vi.fn(() => ({ getDevices: vi.fn() }))
    const prototype = {}
    Object.defineProperty(prototype, 'usb', { get: nativeGetter, configurable: false })
    const navigator = Object.create(prototype) as Record<string, unknown>
    expect(restrictSimulationHost({ navigator })).toContain('navigator.usb')
    expect(() => navigator.usb).toThrow('navigator.usb')
    expect(nativeGetter).not.toHaveBeenCalled()
  })
  it('reports locked own device properties and non-extensible navigators as unrestrictable', () => {
    const locked = {}
    Object.defineProperty(locked, 'usb', { value: { getDevices: vi.fn() }, configurable: false, writable: true })
    expect(restrictSimulationHost({ navigator: locked })).toContain('navigator.usb')
    const frozen = Object.freeze({ userAgent: 'test browser' })
    expect(restrictSimulationHost({ navigator: frozen })).toEqual(['navigator.usb', 'navigator.serial', 'navigator.hid', 'navigator.bluetooth'])
    expect(frozen.userAgent).toBe('test browser')
  })
  it('handles absent device APIs and absent navigators without granting any capability', () => {
    const navigator = { userAgent: 'test browser' } as Record<string, unknown>
    expect(restrictSimulationHost({ navigator })).toEqual([])
    for (const name of ['usb', 'serial', 'hid', 'bluetooth']) expect(() => navigator[name]).toThrow(`navigator.${name}`)
    expect(navigator.userAgent).toBe('test browser')
    const absent = {}
    expect(restrictSimulationHost(absent)).toEqual([])
    expect(Object.hasOwn(absent, 'navigator')).toBe(false)
  })
  it('fails closed if navigator or its prototypes cannot be inspected', () => {
    const unreadable = {}
    Object.defineProperty(unreadable, 'navigator', { get: () => { throw new Error('unreadable') } })
    expect(restrictSimulationHost(unreadable)).toContain('navigator')
    expect(restrictSimulationHost({ navigator: new Proxy({}, { getPrototypeOf: () => { throw new Error('uninspectable') } }) })).toContain('navigator')
  })
  it('does not mutate a separate main-realm navigator or unrelated WorkerNavigator properties', () => {
    const mainUsb = { getDevices: vi.fn() }
    const mainNavigator = { usb: mainUsb, userAgent: 'main browser' }
    const workerPrototype = { usb: { getDevices: vi.fn() } }
    const workerNavigator = Object.create(workerPrototype) as Record<string, unknown>
    workerNavigator.userAgent = 'worker browser'
    expect(restrictSimulationHost({ navigator: workerNavigator })).toEqual([])
    expect(() => workerNavigator.usb).toThrow('navigator.usb')
    expect(mainNavigator.usb).toBe(mainUsb)
    expect(mainNavigator.userAgent).toBe('main browser')
    expect(workerNavigator.userAgent).toBe('worker browser')
  })
  it('closes host capabilities only after bootstrapping the locally served runtime, before user code', () => {
    expect(workerSource.indexOf('await pyodide.runPythonAsync(bootstrap')).toBeLessThan(workerSource.indexOf('restrictSimulationHost(scope)'))
    expect(workerSource.indexOf('restrictSimulationHost(scope)')).toBeLessThan(workerSource.indexOf("await pyodide.runPythonAsync('_sim_execute(_sim_source)'"))
    expect(workerSource).toContain("if (unrestricted.length) throw new Error('このブラウザではシミュレーション用の通信制限を設定できません。')")
    expect(workerSource).not.toContain('loadPackagesFromImports')
    expect(workerSource).not.toContain('requestPort')
    expect(workerSource).not.toContain('requestDevice')
  })
})
