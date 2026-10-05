import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPwaArtifacts, createPwaBuildOptions } from '../../build/pwa.ts'
import type { PwaBuildAsset } from '../../build/pwa.ts'
import { createServiceWorkerSource } from '../../build/pwaServiceWorker.ts'

describe('PWA build manifest', () => {
  const assets = [{ path: 'index.html', source: '<html>app</html>' }, { path: 'assets/app-123.js', source: 'app' }, { path: 'simulation-runtime/pyodide.mjs', source: 'runtime' }, { path: 'simulation-runtime/provenance.json', source: 'provenance' }]
  it('keeps simulator bulk out of the initial shell and includes provenance in optional storage', () => {
    const config = createPwaBuildOptions(assets)
    expect(config.shell.map(asset => asset.path)).toEqual(['assets/app-123.js', 'index.html'])
    expect(config.simulator.map(asset => asset.path)).toEqual(['simulation-runtime/provenance.json', 'simulation-runtime/pyodide.mjs'])
  })
  it('is deterministic and changes version for license/public bytes, independently of simulator content', () => {
    const original = createPwaBuildOptions(assets)
    expect(createPwaBuildOptions([...assets].reverse())).toEqual(original)
    const shell = createPwaBuildOptions([...assets, { path: 'third-party-licenses.txt', source: 'license text' }])
    expect(shell.shellVersion).not.toBe(original.shellVersion)
    expect(shell.simulatorVersion).toBe(original.simulatorVersion)
    const runtime = createPwaBuildOptions(assets.map(asset => asset.path.includes('pyodide') ? { ...asset, source: 'new runtime' } : asset))
    expect(runtime.shellVersion).toBe(original.shellVersion)
    expect(runtime.simulatorVersion).not.toBe(original.simulatorVersion)
    const publicAssets = createPwaBuildOptions([...assets, { path: 'icons/led-192.png', source: new Uint8Array([1, 2]) }])
    expect(publicAssets.shellVersion).not.toBe(original.shellVersion)
  })
  it('rejects missing entry point, unsafe paths and duplicate files', () => {
    expect(() => createPwaBuildOptions([])).toThrow('index.html')
    for (const path of ['../secret', '/root', 'data?code=secret', 'assets/app#hash', 'C:/secret', 'folder\\secret', 'folder/./file', 'folder//file']) expect(() => createPwaBuildOptions([...assets, { path, source: '' }])).toThrow('unsafe')
    expect(() => createPwaBuildOptions([...assets, assets[0]])).toThrow('duplicate')
  })
  it('uses relative URLs under a repository path and a custom-domain root', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/manifest.webmanifest', import.meta.url)), 'utf8'))
    expect(manifest.display).toBe('standalone')
    for (const base of ['https://example.test/MicroPythonWriter/', 'https://example.test/']) {
      for (const name of ['start_url', 'scope', 'id']) expect(new URL(manifest[name], base).href).toBe(base)
      for (const icon of manifest.icons) expect(new URL(icon.src, base).href.startsWith(base)).toBe(true)
    }
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true)
  })
  it('ships actual PNG icons with the declared dimensions', () => {
    for (const [file, size] of [['led-192.png', 192], ['led-512.png', 512], ['led-maskable-512.png', 512]] as const) {
      const png = readFileSync(fileURLToPath(new URL(`../../public/icons/${file}`, import.meta.url)))
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(png.readUInt32BE(16)).toBe(size)
      expect(png.readUInt32BE(20)).toBe(size)
    }
  })
})

describe('PWA production artifact guard', () => {
  const temporaryRoots: string[] = []
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      const target = resolve(root)
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('micropythonwriter-pwa-test-')) throw new Error('Unsafe fixture cleanup target')
      rmSync(target, { recursive: true, force: true })
    }
  })
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'micropythonwriter-pwa-test-'))
    temporaryRoots.push(root)
    const output = join(root, 'dist')
    const assets: PwaBuildAsset[] = [
      { path: 'index.html', source: '<html>app</html>' },
      { path: 'assets/app.js', source: 'app' },
      ...['license-inventory.json', 'third-party-licenses.json', 'third-party-licenses.txt'].map(path => ({ path, source: 'notice' })),
      ...['manifest.webmanifest', 'icons/led-192.png', 'icons/led-512.png', 'icons/led-maskable-512.png'].map(path => ({ path, source: readFileSync(fileURLToPath(new URL(`../../public/${path}`, import.meta.url))) })),
      ...['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'provenance.json'].map(file => ({ path: `simulation-runtime/${file}`, source: file })),
    ]
    const writeBuild = () => {
      for (const asset of assets) {
        const target = join(output, asset.path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, asset.source)
      }
      const config = createPwaBuildOptions(assets)
      writeFileSync(join(output, 'sw.js'), createServiceWorkerSource(config))
      return config
    }
    writeBuild()
    return { root, output, assets, writeBuild }
  }
  it('accepts complete byte-verified shell/runtime inventories, relative manifest and real PNGs', () => {
    const app = fixture()
    expect(checkPwaArtifacts(app.root)).toBe(app.assets.length)
  })
  it('rejects actual bytes changed by a late build step', () => {
    const app = fixture()
    for (const path of ['assets/app.js', 'simulation-runtime/pyodide.asm.wasm']) {
      writeFileSync(join(app.output, path), 'changed after SW generation')
      expect(() => checkPwaArtifacts(app.root)).toThrow('SHA-256 mismatch')
      app.writeBuild()
    }
  })
  it('rejects files emitted too late to enter the SW inventory', () => {
    const app = fixture()
    writeFileSync(join(app.output, 'late-plugin.json'), '{}')
    expect(() => checkPwaArtifacts(app.root)).toThrow('absent from BUILD')
  })
  it('rejects unsafe paths before reading outside the output directory', () => {
    const app = fixture()
    for (const path of ['../secret', 'C:/secret', 'icons\\secret', '/secret', 'secret?code=x', 'icons/./secret']) {
      const config = createPwaBuildOptions(app.assets)
      config.shell.push({ path, sha256: 'a'.repeat(64) })
      writeFileSync(join(app.output, 'sw.js'), createServiceWorkerSource(config))
      expect(() => checkPwaArtifacts(app.root)).toThrow('unsafe asset path')
    }
  })
  it('rejects duplicate paths, a missing entry point, missing license and incomplete optional runtime', () => {
    const app = fixture()
    const errors = [
      { mutate: (config: ReturnType<typeof createPwaBuildOptions>) => { config.shell.push(config.shell[0]) }, expected: 'duplicate asset path' },
      { mutate: (config: ReturnType<typeof createPwaBuildOptions>) => { config.shell = config.shell.filter(asset => asset.path !== 'index.html') }, expected: 'index.html' },
      { mutate: (config: ReturnType<typeof createPwaBuildOptions>) => { config.shell = config.shell.filter(asset => asset.path !== 'third-party-licenses.txt') }, expected: 'missing from the shell' },
      { mutate: (config: ReturnType<typeof createPwaBuildOptions>) => { config.simulator.pop() }, expected: 'all five runtime files' },
      { mutate: (config: ReturnType<typeof createPwaBuildOptions>) => { config.shell.push(config.simulator.pop()!) }, expected: 'must not be in the initial shell' },
    ]
    for (const { mutate, expected } of errors) {
      const config = createPwaBuildOptions(app.assets)
      mutate(config)
      writeFileSync(join(app.output, 'sw.js'), createServiceWorkerSource(config))
      expect(() => checkPwaArtifacts(app.root)).toThrow(expected)
    }
  })
  it('rejects inconsistent versions and modified worker behavior even when BUILD assets stay intact', () => {
    const app = fixture()
    const config = createPwaBuildOptions(app.assets)
    config.shellVersion = '0'.repeat(20)
    writeFileSync(join(app.output, 'sw.js'), createServiceWorkerSource(config))
    expect(() => checkPwaArtifacts(app.root)).toThrow('BUILD version mismatch')
    app.writeBuild()
    writeFileSync(join(app.output, 'sw.js'), readFileSync(join(app.output, 'sw.js'), 'utf8') + '\nself.skipWaiting();\n')
    expect(() => checkPwaArtifacts(app.root)).toThrow('differs from the generated worker')
  })
  it('rejects absolute manifest navigation/icon paths and incorrect icon declarations', () => {
    const app = fixture()
    const original = readFileSync(fileURLToPath(new URL('../../public/manifest.webmanifest', import.meta.url)), 'utf8')
    for (const mutation of [
      (manifest: { start_url: string }) => { manifest.start_url = '/MicroPythonWriter/' },
      (manifest: { scope: string }) => { manifest.scope = '/' },
      (manifest: { id: string }) => { manifest.id = 'https://example.test/app' },
      (manifest: { icons: { src: string }[] }) => { manifest.icons[0].src = '/icons/led-192.png' },
      (manifest: { icons: { sizes: string }[] }) => { manifest.icons[0].sizes = '512x512' },
      (manifest: { icons: { purpose: string }[] }) => { manifest.icons[2].purpose = 'any' },
    ]) {
      const manifest = JSON.parse(original)
      mutation(manifest)
      app.assets.find(asset => asset.path === 'manifest.webmanifest')!.source = JSON.stringify(manifest)
      app.writeBuild()
      expect(() => checkPwaArtifacts(app.root)).toThrow(/manifest|PNG dimensions/)
    }
  })
  it('rejects a falsely labelled or corrupt PNG even when its BUILD hash was generated from it', () => {
    const app = fixture()
    app.assets.find(asset => asset.path === 'icons/led-192.png')!.source = 'not really a PNG'
    app.writeBuild()
    expect(() => checkPwaArtifacts(app.root)).toThrow('invalid PNG signature')
    const corrupt = Buffer.from(readFileSync(fileURLToPath(new URL('../../public/icons/led-192.png', import.meta.url))))
    corrupt[40] ^= 1
    app.assets.find(asset => asset.path === 'icons/led-192.png')!.source = corrupt
    app.writeBuild()
    expect(() => checkPwaArtifacts(app.root)).toThrow('PNG checksum mismatch')
  })
})
