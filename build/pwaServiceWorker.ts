export interface PwaAsset { path: string; sha256: string }
export interface PwaWorkerOptions {
  shellVersion: string
  simulatorVersion: string
  shell: PwaAsset[]
  simulator: PwaAsset[]
}

/** ビルドした版だけを保存する。作品データや通信要求は扱わない。 */
export function createServiceWorkerSource(options: PwaWorkerOptions): string {
  return `/* MicroPythonWriter: generated offline application shell. */
'use strict';
const BUILD = ${JSON.stringify(options)};
const SCOPE = new URL(self.registration.scope);
const PREFIX = 'micropythonwriter-pwa:' + encodeURIComponent(SCOPE.pathname) + ':';
const SHELL_CACHE = PREFIX + 'shell:' + BUILD.shellVersion;
const SIMULATOR_CACHE = PREFIX + 'simulator:' + BUILD.simulatorVersion;
const shellAssets = new Map(BUILD.shell.map(asset => [new URL(asset.path, SCOPE).href, asset]));
const simulatorAssets = new Map(BUILD.simulator.map(asset => [new URL(asset.path, SCOPE).href, asset]));
const indexURL = new URL('index.html', SCOPE).href;
let simulatorTask = null;
function inScope(url) { return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname); }
async function checkedResponse(url, asset) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok || (response.url && response.url !== url)) throw new Error('download-failed');
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw new Error('download-failed');
  return response;
}
async function cacheComplete(name, assets) {
  // 先に全ファイルを取得・照合し、一部だけの保存を利用可能にしない。
  if (await caches.has(name)) {
    const existing = await caches.open(name);
    if ((await Promise.all(Array.from(assets.keys(), url => existing.match(url)))).every(Boolean)) return;
  }
  try {
    const responses = await Promise.all(Array.from(assets, async ([url, asset]) => [url, await checkedResponse(url, asset)]));
    const cache = await caches.open(name);
    await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}
async function simulatorReady() {
  if (!(await caches.has(SIMULATOR_CACHE))) return false;
  const cache = await caches.open(SIMULATOR_CACHE);
  const matches = await Promise.all(Array.from(simulatorAssets.keys(), url => cache.match(url)));
  return simulatorAssets.size > 0 && matches.every(Boolean);
}
self.addEventListener('install', event => {
  event.waitUntil(cacheComplete(SHELL_CACHE, shellAssets));
  // 更新版を勝手に有効化しない。操作中のUSB/BLE/シミュレーターを保護する。
});
self.addEventListener('activate', event => {
  // 旧版を開いているページの有無を確実に判断できないため、旧版キャッシュは残す。
  // 初回だけでも現在のページから任意のシミュレーター保存を利用できる。
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!inScope(url)) return;
  // このアプリはルート/index.html以外のSPAルートを持たない。
  // API・任意のパスへの要求をアプリ画面で置き換えない。
  if (request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname === new URL(indexURL).pathname)) {
    event.respondWith(caches.open(SHELL_CACHE).then(cache => cache.match(indexURL)).then(response => response || fetch(request)));
    return;
  }
  if (shellAssets.has(url.href)) {
    event.respondWith(caches.open(SHELL_CACHE).then(cache => cache.match(url.href)).then(response => response || fetch(request)));
    return;
  }
  if (simulatorAssets.has(url.href)) {
    event.respondWith(simulatorReady().then(async ready => ready && (await (await caches.open(SIMULATOR_CACHE)).match(url.href)) || fetch(request)));
  }
});
self.addEventListener('message', event => {
  const port = event.ports && event.ports[0];
  const answer = result => { if (port) port.postMessage(result); };
  const operation = async () => {
    if (!event.source || !inScope(new URL(event.source.url))) { answer({ ok: false, error: 'out-of-scope' }); return; }
    switch (event.data && event.data.type) {
      case 'PWA_STATUS': answer({ ok: true, simulatorReady: await simulatorReady() }); return;
      case 'PWA_CACHE_SIMULATOR':
        if (!simulatorTask) simulatorTask = cacheComplete(SIMULATOR_CACHE, simulatorAssets).finally(() => { simulatorTask = null; });
        await simulatorTask;
        answer({ ok: true, simulatorReady: await simulatorReady() }); return;
      case 'PWA_CLEAR_SIMULATOR':
        if (simulatorTask) { try { await simulatorTask; } catch { /* 不完全な保存も削除する。 */ } }
        await caches.delete(SIMULATOR_CACHE);
        answer({ ok: true, simulatorReady: false }); return;
      case 'PWA_ACTIVATE_UPDATE': {
        const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => inScope(new URL(client.url)));
        if (windows.length !== 1 || windows[0].id !== event.source.id) { answer({ ok: false, error: 'multiple-clients' }); return; }
        await self.skipWaiting();
        answer({ ok: true }); return;
      }
      default: answer({ ok: false, error: 'unknown-message' });
    }
  };
  event.waitUntil(operation().catch(() => answer({ ok: false, error: 'download-failed', simulatorReady: false })));
});
`;
}
