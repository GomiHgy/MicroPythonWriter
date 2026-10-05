import { afterEach, describe, expect, it, vi } from 'vitest'
import { PwaClient, type PwaSnapshot } from '../services/pwa/PwaClient'

type Reply = { ok: boolean; error?: string; simulatorReady?: boolean }

class FakePort {
  onmessage: ((event: { data: Reply }) => void) | null = null
  close = vi.fn()
  peer?: FakePort
  postMessage(reply: Reply) { this.peer?.onmessage?.({ data: reply }) }
}

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'activated'
  messages: string[] = []
  reply: (type: string, port: FakePort) => void = (type, port) => port.postMessage({
    ok: true, simulatorReady: type === 'PWA_CACHE_SIMULATOR',
  })
  postMessage(message: { type: string }, ports: FakePort[]) {
    this.messages.push(message.type)
    this.reply(message.type, ports[0])
  }
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')) }
}

class FakeRegistration extends EventTarget {
  active: FakeWorker | null = new FakeWorker()
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  update = vi.fn(async () => undefined)
}

async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve() }
const clients: PwaClient[] = []

function fixture(settings: { secure?: boolean; enabled?: boolean; standalone?: boolean; active?: boolean } = {}) {
  const win = Object.assign(new EventTarget(), {
    isSecureContext: settings.secure ?? true,
    location: { reload: vi.fn() },
    matchMedia: vi.fn(() => Object.assign(new EventTarget(), { matches: !!settings.standalone })),
  })
  const doc = Object.assign(new EventTarget(), {
    baseURI: 'https://gomihgy.github.io/MicroPythonWriter/', visibilityState: 'visible',
  })
  const registration = new FakeRegistration()
  if (settings.active === false) registration.active = null
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: registration.active,
    register: vi.fn(async () => registration as unknown as ServiceWorkerRegistration),
  })
  const nav = { onLine: true, serviceWorker, standalone: false }
  const states: PwaSnapshot[] = []
  const channels: { port1: FakePort; port2: FakePort }[] = []
  const client = new PwaClient(snapshot => states.push(snapshot), {
    enabled: settings.enabled ?? true,
    window: win as unknown as Window, navigator: nav as unknown as Navigator, document: doc as unknown as Document,
    baseUrl: './', requestTimeoutMs: 200,
    createMessageChannel: () => {
      const port1 = new FakePort(), port2 = new FakePort()
      port1.peer = port2; port2.peer = port1
      const channel = { port1, port2 }
      channels.push(channel)
      return channel as unknown as MessageChannel
    },
  })
  clients.push(client)
  return { client, win, doc, nav, registration, serviceWorker, states, channels }
}

afterEach(() => {
  for (const client of clients) client.dispose()
  clients.length = 0
  vi.useRealTimers()
})

describe('PWA の登録と状態', () => {
  it('GitHub Pages の配下だけを登録し、開発時には登録しない', async () => {
    const enabled = fixture()
    await Promise.all([enabled.client.start(), enabled.client.start()])
    expect(enabled.serviceWorker.register).toHaveBeenCalledTimes(1)
    expect(enabled.serviceWorker.register).toHaveBeenCalledWith(
      'https://gomihgy.github.io/MicroPythonWriter/sw.js',
      { scope: 'https://gomihgy.github.io/MicroPythonWriter/', updateViaCache: 'none' },
    )
    expect(enabled.client.state).toMatchObject({ supported: true, ready: true, busy: false, error: '' })
    const development = fixture({ enabled: false })
    await development.client.start()
    expect(development.serviceWorker.register).not.toHaveBeenCalled()
    expect(development.client.state.supported).toBe(false)
  })

  it('安全でない接続では登録せず理由を返す', async () => {
    const { client, serviceWorker } = fixture({ secure: false })
    await client.start()
    expect(serviceWorker.register).not.toHaveBeenCalled()
    expect(client.state.error).toBe('insecure-context')
  })

  it('Service Worker API がないブラウザでも例外を出さない', async () => {
    const { client, nav } = fixture()
    nav.serviceWorker.register = undefined as unknown as typeof nav.serviceWorker.register
    // 能力判定は構築時なので、欠けた API の環境を再構築する。
    const withoutApi = new PwaClient(() => {}, {
      enabled: true, window: { isSecureContext: true } as Window, navigator: {} as Navigator,
    })
    clients.push(withoutApi)
    await withoutApi.start()
    expect(withoutApi.state.supported).toBe(false)
    client.dispose()
  })

  it('登録エラーは画面状態だけに残す', async () => {
    const { client, serviceWorker } = fixture()
    serviceWorker.register.mockRejectedValue(new Error('network unavailable'))
    await client.start()
    expect(client.state).toMatchObject({ ready: false, busy: false, error: 'registration-failed' })
  })

  it('ready の無期限待ちはせず、新規インストールの活性化後に状態を受け取る', async () => {
    const { client, registration, nav } = fixture({ active: false })
    Object.defineProperty(nav.serviceWorker, 'ready', { get: () => { throw new Error('must not await ready') } })
    const installing = new FakeWorker()
    installing.state = 'installing'
    registration.installing = installing
    await client.start()
    expect(client.state.ready).toBe(false)
    registration.installing = null
    registration.active = installing
    installing.change('activated')
    await flush()
    expect(client.state.ready).toBe(true)
    expect(installing.messages).toContain('PWA_STATUS')
  })

  it('オフラインとオンラインを追跡し、前景化の連打で更新確認を連発しない', async () => {
    const { client, registration, win, doc } = fixture()
    await client.start()
    win.dispatchEvent(new Event('offline'))
    expect(client.state.offline).toBe(true)
    expect(await client.checkForUpdate()).toBe(false)
    expect(client.state.error).toBe('offline')
    win.dispatchEvent(new Event('online'))
    await flush()
    doc.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(client.state.offline).toBe(false)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('インストール済みは standalone と iOS standalone の両方で判定する', () => {
    expect(fixture({ standalone: true }).client.state.installed).toBe(true)
    const { win, nav, doc } = fixture()
    nav.standalone = true
    const ios = new PwaClient(() => {}, {
      enabled: true, window: win as unknown as Window,
      navigator: nav as unknown as Navigator, document: doc as unknown as Document,
    })
    clients.push(ios)
    expect(ios.state.installed).toBe(true)
  })

  it('install prompt は一回だけ利用し、ユーザーのキャンセルは失敗表示しない', async () => {
    const { client, win } = fixture()
    await client.start()
    const prompt = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => undefined), userChoice: Promise.resolve({ outcome: 'dismissed' }),
    })
    win.dispatchEvent(prompt)
    expect(prompt.defaultPrevented).toBe(true)
    expect(client.state.installAvailable).toBe(true)
    expect(await client.install()).toBe(false)
    expect(prompt.prompt).toHaveBeenCalledTimes(1)
    expect(client.state).toMatchObject({ installAvailable: false, installed: false, error: '' })
    win.dispatchEvent(new Event('appinstalled'))
    expect(client.state.installed).toBe(true)
  })

  it('accepted だけではインストール済みと誤認しない', async () => {
    const { client, win } = fixture()
    await client.start()
    const prompt = Object.assign(new Event('beforeinstallprompt'), {
      prompt: vi.fn(async () => undefined), userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    win.dispatchEvent(prompt)
    expect(await client.install()).toBe(true)
    expect(client.state.installed).toBe(false)
    expect(client.state.installAvailable).toBe(false)
  })

  it('更新が待機していることだけを通知し、自動で適用しない', async () => {
    const { client, registration, win } = fixture()
    await client.start()
    const worker = new FakeWorker()
    worker.state = 'installed'
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    registration.installing = null
    registration.waiting = worker
    worker.change('installed')
    expect(client.state.updateAvailable).toBe(true)
    expect(worker.messages).not.toContain('PWA_ACTIVATE_UPDATE')
    expect(win.location.reload).not.toHaveBeenCalled()
  })
})

describe('PWA の更新の明示適用', () => {
  it('返信と活性化の両方を待って初めて再読み込みする', async () => {
    const { client, registration, win } = fixture()
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    registration.waiting = waiting
    let port!: FakePort
    waiting.reply = (_, transferred) => { port = transferred }
    await client.start()
    const applying = client.applyUpdate()
    await flush()
    port.postMessage({ ok: true })
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
    waiting.change('activated')
    expect(await applying).toBe(true)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('活性化が返信より先でも再読み込みを失わない', async () => {
    const { client, registration, win } = fixture()
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    registration.waiting = waiting
    waiting.reply = (_, port) => { waiting.change('activated'); port.postMessage({ ok: true }) }
    await client.start()
    expect(await client.applyUpdate()).toBe(true)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('別タブが開いている拒否時には再読み込みも監視タイマーの残留もない', async () => {
    vi.useFakeTimers()
    const { client, registration, win } = fixture()
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    waiting.reply = (_, port) => port.postMessage({ ok: false, error: 'multiple-clients' })
    registration.waiting = waiting
    await client.start()
    expect(await client.applyUpdate()).toBe(false)
    expect(client.state.error).toBe('multiple-clients')
    expect(win.location.reload).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('別タブによる controllerchange は状態確認のみで再読み込みしない', async () => {
    const { client, win, serviceWorker, registration } = fixture()
    await client.start()
    const next = new FakeWorker()
    registration.active = next
    serviceWorker.controller = next
    serviceWorker.dispatchEvent(new Event('controllerchange'))
    await flush()
    expect(next.messages).toEqual(['PWA_STATUS'])
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('待機 worker が消えたときと update が失敗したときはエラーだけを通知する', async () => {
    const { client, registration, win } = fixture()
    await client.start()
    expect(await client.applyUpdate()).toBe(false)
    expect(client.state.error).toBe('no-update')
    registration.update.mockRejectedValue(new Error('network'))
    expect(await client.checkForUpdate()).toBe(false)
    expect(client.state.error).toBe('update-failed')
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('活性化が完了しないときはタイムアウトして再読み込みしない', async () => {
    vi.useFakeTimers()
    const { client, registration, win } = fixture()
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    registration.waiting = waiting
    await client.start()
    const updating = client.applyUpdate()
    await vi.advanceTimersByTimeAsync(201)
    expect(await updating).toBe(false)
    expect(client.state.error).toBe('timeout')
    expect(win.location.reload).not.toHaveBeenCalled()
  })
})

describe('シミュレーター用キャッシュと破棄', () => {
  it('明示ダウンロードと削除の状態を機器通信に関係なく追跡する', async () => {
    const { client, registration, channels } = fixture()
    await client.start()
    expect(client.state.simulatorReady).toBe(false)
    expect(await client.cacheSimulator()).toBe(true)
    expect(client.state.simulatorReady).toBe(true)
    expect(await client.clearSimulator()).toBe(true)
    expect(client.state.simulatorReady).toBe(false)
    expect(registration.active?.messages).toEqual(['PWA_STATUS', 'PWA_CACHE_SIMULATOR', 'PWA_CLEAR_SIMULATOR'])
    for (const { port1, port2 } of channels) {
      expect(port1.close).toHaveBeenCalledTimes(1)
      expect(port2.close).toHaveBeenCalledTimes(1)
    }
  })

  it('オフラインでは保存開始せず、保存済みキャッシュの削除はできる', async () => {
    const { client, registration, win } = fixture()
    await client.start()
    win.dispatchEvent(new Event('offline'))
    expect(await client.cacheSimulator()).toBe(false)
    expect(client.state.error).toBe('offline')
    expect(registration.active?.messages).not.toContain('PWA_CACHE_SIMULATOR')
    expect(await client.clearSimulator()).toBe(true)
  })

  it('容量不足と不正な返信を処理し、通信ポートを閉じる', async () => {
    const { client, registration, channels } = fixture()
    await client.start()
    registration.active!.reply = (_, port) => port.postMessage({ ok: false, error: 'quota-exceeded' })
    expect(await client.cacheSimulator()).toBe(false)
    expect(client.state.error).toBe('quota-exceeded')
    registration.active!.reply = (_, port) => port.postMessage({ invalid: true } as unknown as Reply)
    expect(await client.cacheSimulator()).toBe(false)
    expect(client.state.error).toBe('request-failed')
    expect(channels.at(-1)?.port1.close).toHaveBeenCalledTimes(1)
  })

  it('返信がない場合も待ち続けず、タイムアウト後に再試行できる', async () => {
    vi.useFakeTimers()
    const { client, registration, channels } = fixture()
    await client.start()
    registration.active!.reply = () => {}
    const downloading = client.cacheSimulator()
    expect(client.state.busy).toBe(true)
    expect(await client.clearSimulator()).toBe(false)
    await vi.advanceTimersByTimeAsync(201)
    expect(await downloading).toBe(false)
    expect(client.state).toMatchObject({ busy: false, error: 'timeout' })
    expect(channels.at(-1)?.port1.close).toHaveBeenCalledTimes(1)
    registration.active!.reply = (_, port) => port.postMessage({ ok: true, simulatorReady: true })
    expect(await client.cacheSimulator()).toBe(true)
  })

  it('dispose は未完了のポートと監視を解除し、StrictMode の重複通知を避ける', async () => {
    vi.useFakeTimers()
    const { client, registration, channels, win, states } = fixture()
    await client.start()
    registration.active!.reply = () => {}
    const downloading = client.cacheSimulator()
    await flush()
    client.dispose()
    client.dispose()
    expect(await downloading).toBe(false)
    const count = states.length
    win.dispatchEvent(new Event('offline'))
    registration.dispatchEvent(new Event('updatefound'))
    expect(states.length).toBe(count)
    expect(channels.at(-1)?.port1.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('登録の完了より先に dispose されても監視を追加しない', async () => {
    const { client, serviceWorker, registration, win, states } = fixture()
    let resolve!: (value: ServiceWorkerRegistration) => void
    serviceWorker.register.mockImplementation(() => new Promise(done => { resolve = done }))
    const start = client.start()
    client.dispose()
    resolve(registration as unknown as ServiceWorkerRegistration)
    await start
    const count = states.length
    win.dispatchEvent(new Event('appinstalled'))
    expect(states.length).toBe(count)
    expect(registration.active?.messages).toEqual([])
  })
})
