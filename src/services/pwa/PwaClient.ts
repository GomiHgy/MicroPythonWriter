export interface PwaSnapshot {
  supported: boolean
  installed: boolean
  installAvailable: boolean
  offline: boolean
  ready: boolean
  updateAvailable: boolean
  simulatorReady: boolean
  busy: boolean
  error: string
}

export const INITIAL_PWA_SNAPSHOT: PwaSnapshot = {
  supported: false, installed: false, installAvailable: false, offline: false,
  ready: false, updateAvailable: false, simulatorReady: false, busy: false, error: '',
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface WorkerReply { ok: boolean; error?: string; simulatorReady?: boolean }
type WorkerCommand = 'PWA_STATUS' | 'PWA_CACHE_SIMULATOR' | 'PWA_CLEAR_SIMULATOR' | 'PWA_ACTIVATE_UPDATE'

export interface PwaClientOptions {
  enabled?: boolean
  baseUrl?: string
  window?: Window
  navigator?: Navigator
  document?: Document
  requestTimeoutMs?: number
  reload?: () => void
  createMessageChannel?: () => MessageChannel
}

/** 更新は明示操作だけで適用する。別タブの更新や接続中の操作で自動再読み込みしない。 */
export class PwaClient {
  private snapshot: PwaSnapshot
  private readonly onChange: (snapshot: PwaSnapshot) => void
  private readonly options: PwaClientOptions
  private readonly browserWindow: Window | undefined
  private readonly browserNavigator: Navigator | undefined
  private readonly browserDocument: Document | undefined
  private registration: ServiceWorkerRegistration | undefined
  private installPrompt: InstallPromptEvent | undefined
  private startPromise: Promise<void> | undefined
  private disposed = false
  private lastUpdateCheck = 0
  private cleanup: (() => void)[] = []
  private cancellations = new Set<() => void>()
  private watchedWorkers = new Set<ServiceWorker>()

  constructor(onChange: (snapshot: PwaSnapshot) => void, options: PwaClientOptions = {}) {
    this.onChange = onChange
    this.options = options
    this.browserWindow = options.window ?? (typeof window === 'undefined' ? undefined : window)
    this.browserNavigator = options.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator)
    this.browserDocument = options.document ?? (typeof document === 'undefined' ? undefined : document)
    const enabled = options.enabled ?? import.meta.env.PROD
    this.snapshot = {
      ...INITIAL_PWA_SNAPSHOT,
      supported: enabled && this.browserWindow?.isSecureContext === true
        && typeof this.browserNavigator?.serviceWorker?.register === 'function',
      installed: this.isInstalled(),
      offline: this.browserNavigator?.onLine === false,
      error: enabled && this.browserWindow && !this.browserWindow.isSecureContext ? 'insecure-context' : '',
    }
  }

  get state(): PwaSnapshot { return { ...this.snapshot } }

  start(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (!this.startPromise) this.startPromise = this.startRegistration()
    return this.startPromise
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const cancel of this.cancellations) cancel()
    for (const cleanup of this.cleanup) cleanup()
    this.cleanup = []
    this.cancellations.clear()
    this.watchedWorkers.clear()
    this.installPrompt = undefined
  }

  install(): Promise<boolean> {
    return this.operation(async () => {
      const prompt = this.installPrompt
      if (!prompt) throw new Error('unsupported')
      this.installPrompt = undefined
      this.change({ installAvailable: false })
      await prompt.prompt()
      const choice = await prompt.userChoice
      // 承認しても OS へのインストール完了は別。appinstalled または表示モードで確認する。
      return choice.outcome === 'accepted'
    }, 'install-failed')
  }

  checkForUpdate(): Promise<boolean> {
    return this.operation(async () => {
      if (this.snapshot.offline) throw new Error('offline')
      if (!this.registration) throw new Error('not-ready')
      this.lastUpdateCheck = Date.now()
      await this.registration.update()
      this.syncRegistration()
      return true
    }, 'update-failed')
  }

  cacheSimulator(): Promise<boolean> {
    return this.simulatorOperation('PWA_CACHE_SIMULATOR')
  }

  clearSimulator(): Promise<boolean> {
    return this.simulatorOperation('PWA_CLEAR_SIMULATOR')
  }

  applyUpdate(): Promise<boolean> {
    return this.operation(async () => {
      const worker = this.registration?.waiting
      if (!worker || worker.state === 'redundant') throw new Error('no-update')
      // 返信より先に statechange が来ても取りこぼさない。拒否されたら監視も即解除する。
      const activation = this.waitForActivation(worker)
      try {
        const reply = await this.request(worker, 'PWA_ACTIVATE_UPDATE')
        if (!reply.ok) throw new Error(reply.error || 'request-failed')
        await activation.promise
        if (this.disposed) throw new Error('disposed')
        ;(this.options.reload ?? (() => this.browserWindow?.location.reload()))()
        return true
      } finally {
        activation.cancel()
      }
    }, 'request-failed')
  }

  private async startRegistration(): Promise<void> {
    this.change({})
    if (!this.snapshot.supported) return
    const browserWindow = this.browserWindow!
    const browserNavigator = this.browserNavigator!
    const browserDocument = this.browserDocument!
    this.listen(browserWindow, 'beforeinstallprompt', (event) => {
      if (this.snapshot.installed || this.installPrompt) return
      event.preventDefault()
      this.installPrompt = event as InstallPromptEvent
      this.change({ installAvailable: true })
    })
    this.listen(browserWindow, 'appinstalled', () => {
      this.installPrompt = undefined
      this.change({ installed: true, installAvailable: false })
    })
    this.listen(browserWindow, 'offline', () => this.change({ offline: true }))
    this.listen(browserWindow, 'online', () => {
      this.change({ offline: false })
      this.checkOnForeground()
    })
    this.listen(browserDocument, 'visibilitychange', () => {
      if (browserDocument.visibilityState === 'visible') this.checkOnForeground()
    })
    const displayMode = browserWindow.matchMedia?.('(display-mode: standalone)')
    if (typeof displayMode?.addEventListener === 'function') {
      this.listen(displayMode, 'change', () => this.change({ installed: this.isInstalled() }))
    }
    this.listen(browserNavigator.serviceWorker, 'controllerchange', () => {
      // 他のタブによる更新は状態の再取得だけにする。ページは再読み込みしない。
      this.syncRegistration()
      void this.readStatus()
    })
    this.change({ busy: true })
    try {
      const base = new URL(this.options.baseUrl ?? import.meta.env.BASE_URL, browserDocument.baseURI)
      const script = new URL('sw.js', base)
      const registration = await browserNavigator.serviceWorker.register(script.href, {
        scope: new URL('./', script).href, updateViaCache: 'none',
      })
      if (this.disposed) return
      this.registration = registration
      this.listen(registration, 'updatefound', () => this.syncRegistration())
      this.syncRegistration()
      await this.readStatus()
    } catch {
      this.change({ error: 'registration-failed' })
    } finally {
      this.change({ busy: false })
    }
  }

  private isInstalled(): boolean {
    return this.browserWindow?.matchMedia?.('(display-mode: standalone)').matches === true
      || (this.browserNavigator as (Navigator & { standalone?: boolean }) | undefined)?.standalone === true
  }

  private change(patch: Partial<PwaSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.onChange({ ...this.snapshot })
  }

  private listen(target: EventTarget, type: string, callback: EventListener): void {
    target.addEventListener(type, callback)
    this.cleanup.push(() => target.removeEventListener(type, callback))
  }

  private syncRegistration(): void {
    const registration = this.registration
    if (!registration || this.disposed) return
    this.change({
      ready: registration.active?.state === 'activated',
      updateAvailable: !!registration.waiting && registration.waiting.state !== 'redundant',
    })
    for (const worker of [registration.installing, registration.waiting, registration.active]) {
      if (!worker || this.watchedWorkers.has(worker)) continue
      this.watchedWorkers.add(worker)
      this.listen(worker, 'statechange', () => {
        this.syncRegistration()
        if (worker.state === 'activated') void this.readStatus()
      })
    }
  }

  private checkOnForeground(): void {
    if (this.snapshot.busy || this.snapshot.offline || !this.registration) return
    // 前景化の連打や回線の揺れで更新確認を連発しない。
    if (Date.now() - this.lastUpdateCheck < 60_000) return
    void this.checkForUpdate()
  }

  private async readStatus(): Promise<void> {
    const active = this.registration?.active
    if (!active || active.state !== 'activated' || this.disposed) return
    try {
      const reply = await this.request(active, 'PWA_STATUS')
      if (!reply.ok) throw new Error(reply.error || 'request-failed')
      this.change({ simulatorReady: reply.simulatorReady === true })
    } catch (error) {
      this.change({ simulatorReady: false, error: this.errorCode(error, 'request-failed') })
    }
  }

  private simulatorOperation(command: WorkerCommand): Promise<boolean> {
    return this.operation(async () => {
      if (command === 'PWA_CACHE_SIMULATOR' && this.snapshot.offline) throw new Error('offline')
      let active = this.registration?.active ?? this.registration?.installing
      if (!active) throw new Error('not-ready')
      if (active.state !== 'activated') await this.waitForActivation(active).promise
      active = this.registration?.active ?? active
      const reply = await this.request(active, command)
      if (!reply.ok) throw new Error(reply.error || 'request-failed')
      this.change({ simulatorReady: reply.simulatorReady === true })
      return true
    }, 'request-failed')
  }

  private async operation(run: () => Promise<boolean>, fallback: string): Promise<boolean> {
    if (this.disposed || this.snapshot.busy) return false
    this.change({ busy: true, error: '' })
    try { return await run() }
    catch (error) {
      this.change({ error: this.errorCode(error, fallback) })
      return false
    } finally { this.change({ busy: false }) }
  }

  private errorCode(error: unknown, fallback: string): string {
    const codes = ['unsupported', 'offline', 'not-ready', 'no-update', 'multiple-clients', 'timeout', 'disposed',
      'request-failed', 'cache-failed', 'quota-exceeded', 'network-error']
    return error instanceof Error && codes.includes(error.message) ? error.message : fallback
  }

  private request(worker: ServiceWorker, type: WorkerCommand): Promise<WorkerReply> {
    if (this.disposed) return Promise.reject(new Error('disposed'))
    return new Promise((resolve, reject) => {
      const channel = (this.options.createMessageChannel ?? (() => new MessageChannel()))()
      let settled = false
      const finish = (reply?: WorkerReply, error?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        channel.port1.onmessage = null
        channel.port1.close()
        channel.port2.close()
        this.cancellations.delete(cancel)
        if (error) reject(new Error(error))
        else resolve(reply!)
      }
      const cancel = () => finish(undefined, 'disposed')
      const timeout = this.options.requestTimeoutMs ?? (type === 'PWA_CACHE_SIMULATOR' ? 120_000 : 15_000)
      const timer = setTimeout(() => finish(undefined, 'timeout'), timeout)
      this.cancellations.add(cancel)
      channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data
        if (!reply || typeof reply.ok !== 'boolean') finish(undefined, 'request-failed')
        else finish(reply)
      }
      try { worker.postMessage({ type }, [channel.port2]) }
      catch { finish(undefined, 'request-failed') }
    })
  }

  private waitForActivation(worker: ServiceWorker): { promise: Promise<void>; cancel: () => void } {
    let cancel = () => {}
    const promise = new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.removeEventListener('statechange', check)
        this.cancellations.delete(cancel)
        if (error) reject(new Error(error))
        else resolve()
      }
      const check = () => {
        if (worker.state === 'activated') finish()
        else if (worker.state === 'redundant') finish('no-update')
      }
      cancel = () => finish('disposed')
      const timer = setTimeout(() => finish('timeout'), this.options.requestTimeoutMs ?? 15_000)
      this.cancellations.add(cancel)
      worker.addEventListener('statechange', check)
      check()
    })
    // 返信待ち中に先に失敗しても未処理の rejection を作らない。
    void promise.catch(() => {})
    return { promise, cancel }
  }
}
