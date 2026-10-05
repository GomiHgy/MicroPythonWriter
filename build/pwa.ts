import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import type { Plugin } from 'vite'
import { createServiceWorkerSource } from './pwaServiceWorker.ts'
import type { PwaAsset, PwaWorkerOptions } from './pwaServiceWorker.ts'
import { LICENSE_INVENTORY, LICENSE_METADATA, LICENSE_TEXT } from './licenses.ts'
import { simulationRuntimeFiles } from './simulationRuntime.ts'

export interface PwaBuildAsset { path: string; source: string | Uint8Array }
const slash = (path: string) => path.replace(/\\/g, '/')
const hash = (source: string | Uint8Array) => createHash('sha256').update(source).digest('hex')
const safePath = (path: string) => path.length > 0 && !/[\\:?#]/.test(path) && !Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
function fail(reason: string): never { throw new Error(`[pwa] ${reason}`) }

/** publicも含め、実際のファイル内容が変われば必ず別版になる。 */
export function createPwaBuildOptions(assets: PwaBuildAsset[]): PwaWorkerOptions {
  const ordered = assets.filter(asset => asset.path !== 'sw.js').sort((a, b) => a.path.localeCompare(b.path))
  const manifest = (selected: PwaBuildAsset[]): PwaAsset[] => selected.map(asset => ({ path: asset.path, sha256: hash(asset.source) }))
  const simulator = manifest(ordered.filter(asset => asset.path.startsWith('simulation-runtime/')))
  const shell = manifest(ordered.filter(asset => !asset.path.startsWith('simulation-runtime/')))
  if (!shell.some(asset => asset.path === 'index.html')) throw new Error('[pwa] index.html is missing')
  if (new Set(ordered.map(asset => asset.path)).size !== ordered.length) throw new Error('[pwa] duplicate asset path')
  if (ordered.some(asset => !safePath(asset.path))) throw new Error('[pwa] unsafe asset path')
  const version = (files: PwaAsset[]) => hash(JSON.stringify(files)).slice(0, 20)
  // SWの方針変更も別のシェルとして扱い、稼働中の旧版を消さない。
  const policy = createServiceWorkerSource({ shellVersion: '', simulatorVersion: '', shell: [], simulator: [] })
  return { shellVersion: hash(JSON.stringify(shell) + policy).slice(0, 20), simulatorVersion: version(simulator), shell, simulator }
}

function object(value: unknown, subject: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${subject}: invalid object`)
  return value as Record<string, unknown>
}

function pngDimensions(png: Buffer, subject: string): [number, number] {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail(`${subject}: invalid PNG signature`)
  let width = 0
  let height = 0
  let ended = false
  const image: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) fail(`${subject}: truncated PNG`)
    const length = png.readUInt32BE(offset)
    if (offset + length + 12 > png.length) fail(`${subject}: truncated PNG chunk`)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    let crc = 0xffffffff
    for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    if (((crc ^ 0xffffffff) >>> 0) !== png.readUInt32BE(offset + 8 + length)) fail(`${subject}: PNG checksum mismatch`)
    if (offset === 8 && type !== 'IHDR') fail(`${subject}: PNG header is missing`)
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13 || data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) fail(`${subject}: unsupported PNG header; expected non-interlaced 8-bit RGBA`)
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (![192, 512].includes(width) || width !== height) fail(`${subject}: unexpected PNG dimensions`)
    }
    if (type === 'IDAT') image.push(data)
    offset += length + 12
    if (type === 'IEND') {
      if (length !== 0 || offset !== png.length) fail(`${subject}: invalid PNG end`)
      ended = true
      break
    }
  }
  if (!ended || !image.length) fail(`${subject}: PNG image data is missing`)
  let pixels: Buffer
  try { pixels = inflateSync(Buffer.concat(image), { maxOutputLength: height * (width * 4 + 1) }) }
  catch { return fail(`${subject}: invalid PNG image data`) }
  if (pixels.length !== height * (width * 4 + 1)) fail(`${subject}: PNG pixel length mismatch`)
  for (let row = 0; row < height; row++) if (pixels[row * (width * 4 + 1)] > 4) fail(`${subject}: invalid PNG filter`)
  return [width, height]
}

/** 公開前の実成果物を検査する。SW記述を実行せず、内容・版・相対配置を照合する。 */
export function checkPwaArtifacts(root: string, outDir = 'dist'): number {
  const output = resolve(root, outDir)
  const read = (path: string): Buffer => {
    if (!safePath(path)) fail(`unsafe artifact path: ${path}`)
    const target = resolve(output, path)
    const inside = relative(output, target)
    if (inside.startsWith('..') || isAbsolute(inside)) fail(`artifact escapes output: ${path}`)
    try { return readFileSync(target) }
    catch { return fail(`missing artifact: ${path}`) }
  }
  const source = read('sw.js').toString('utf8')
  const match = source.match(/^const BUILD = ([^\n]+);$/m)
  if (!match) fail('sw.js: generated BUILD metadata is missing')
  let raw: Record<string, unknown>
  try { raw = object(JSON.parse(match[1]), 'BUILD') }
  catch { return fail('sw.js: invalid BUILD metadata') }
  const manifest = (name: 'shell' | 'simulator'): PwaAsset[] => {
    if (!Array.isArray(raw[name])) fail(`${name}: missing asset list`)
    return raw[name].map((value: unknown) => {
      const item = object(value, name)
      if (typeof item.path !== 'string' || !safePath(item.path) || item.path === 'sw.js') fail(`${name}: unsafe asset path`)
      if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) fail(`${item.path}: invalid SHA-256`)
      return { path: item.path, sha256: item.sha256 }
    })
  }
  const shell = manifest('shell')
  const simulator = manifest('simulator')
  const all = [...shell, ...simulator]
  const paths = new Set(all.map(asset => asset.path))
  if (paths.size !== all.length) fail('duplicate asset path')
  if (!shell.some(asset => asset.path === 'index.html')) fail('index.html is missing from the shell')
  if (shell.some(asset => asset.path.startsWith('simulation-runtime/'))) fail('simulator files must not be in the initial shell')
  const expectedRuntime = [...simulationRuntimeFiles.map(file => `simulation-runtime/${file}`), 'simulation-runtime/provenance.json']
  if (simulator.length !== expectedRuntime.length || expectedRuntime.some(path => !simulator.some(asset => asset.path === path))) fail('optional simulator must contain all five runtime files and provenance.json')
  for (const path of [LICENSE_INVENTORY, LICENSE_METADATA, LICENSE_TEXT, 'manifest.webmanifest']) if (!shell.some(asset => asset.path === path)) fail(`${path}: missing from the shell`)
  const assets = all.map(asset => {
    const bytes = read(asset.path)
    if (hash(bytes) !== asset.sha256) fail(`${asset.path}: SHA-256 mismatch; rebuild required`)
    return { path: asset.path, source: bytes }
  })
  const expected = createPwaBuildOptions(assets)
  if (raw.shellVersion !== expected.shellVersion || raw.simulatorVersion !== expected.simulatorVersion) fail('BUILD version mismatch; rebuild required')
  if (JSON.stringify(shell) !== JSON.stringify(expected.shell) || JSON.stringify(simulator) !== JSON.stringify(expected.simulator)) fail('BUILD asset ordering/classification mismatch')
  if (source !== createServiceWorkerSource(expected)) fail('sw.js differs from the generated worker; rebuild required')
  const visit = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, item.name)
      const path = slash(relative(output, full))
      if (item.isDirectory()) visit(full)
      else if (item.isFile()) {
        if (path !== 'sw.js' && !paths.has(path)) fail(`${path}: artifact is absent from BUILD metadata`)
      } else fail(`${path}: unsupported artifact type`)
    }
  }
  visit(output)
  let appManifest: Record<string, unknown>
  try { appManifest = object(JSON.parse(read('manifest.webmanifest').toString('utf8')), 'manifest') }
  catch { return fail('manifest.webmanifest: invalid JSON') }
  for (const name of ['start_url', 'id', 'scope']) if (appManifest[name] !== './') fail(`manifest.${name}: expected ./ for root and repository-path hosting`)
  if (appManifest.display !== 'standalone') fail('manifest.display: expected standalone')
  if (!Array.isArray(appManifest.icons)) fail('manifest.icons: missing icons')
  const required = new Set(['192x192:any', '512x512:any', '512x512:maskable'])
  for (const value of appManifest.icons) {
    const icon = object(value, 'manifest icon')
    if (typeof icon.src !== 'string' || !icon.src.startsWith('./') || icon.type !== 'image/png') fail('manifest icon: expected relative PNG source')
    const path = icon.src.slice(2)
    if (!safePath(path) || !shell.some(asset => asset.path === path)) fail('manifest icon: missing safe shell asset')
    const [width, height] = pngDimensions(read(path), path)
    if (icon.sizes !== `${width}x${height}`) fail(`${path}: PNG dimensions do not match manifest.sizes`)
    required.delete(`${String(icon.sizes)}:${String(icon.purpose)}`)
  }
  if (required.size) fail('manifest.icons: 192/512 any and 512 maskable icons are required')
  return all.length
}

export function pwaPlugin(): Plugin {
  let publicDirectory = ''
  return {
    name: 'micropythonwriter-pwa',
    apply: 'build',
    configResolved(config) { publicDirectory = config.publicDir },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const assets: PwaBuildAsset[] = Object.values(bundle).map(asset => ({ path: asset.fileName, source: asset.type === 'chunk' ? asset.code : asset.source }))
        const visit = (directory: string) => {
          for (const item of readdirSync(directory, { withFileTypes: true })) {
            const full = join(directory, item.name)
            if (item.isDirectory()) visit(full)
            else if (item.isFile()) assets.push({ path: slash(relative(publicDirectory, full)), source: readFileSync(full) })
          }
        }
        if (publicDirectory) visit(publicDirectory)
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: createServiceWorkerSource(createPwaBuildOptions(assets)) })
      },
    },
  }
}
