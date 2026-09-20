import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

export const LICENSE_METADATA = 'third-party-licenses.json'
export const LICENSE_INVENTORY = 'license-inventory.json'
export const LICENSE_TEXT = 'third-party-licenses.txt'
export const MANUAL_NOTICES = 'licenses/manual-notices.txt'

export interface LicenseEntry { name: string; version: string; identifier: string; text: string }
export interface LicensePackage { name: string; version: string; directory: string; kind: 'dependency' | 'runtime'; modules: string[] }
export interface LicenseInventory { schema: 1; packages: LicensePackage[] }
interface LicenseDocument { file: string; text: string }

const key = (entry: { name: string; version: string }) => `${entry.name}@${entry.version}`
const slash = (path: string) => path.replace(/\\/g, '/')
const placeholder = /^\s*(?:UNKNOWN|NOASSERTION|TBD|TODO|PLACEHOLDER)[\s.!:]*$|(?:insert|replace with|missing|no|not found|unavailable)\s+(?:the\s+)?license\s+text|license\s+text\s+(?:here|goes|pending)|placeholder\s+(?:license|text)/im
const documentName = /(?:^|[-_.])(?:licen[cs]e|licen[cs]es|copying|notice|notices|copyright)(?:$|[-_.])/i
const licenseName = /(?:^|[-_.])(?:licen[cs]e|licen[cs]es|copying)(?:$|[-_.])/i

function fail(subject: string, reason: string): never { throw new Error(`[licenses] ${subject}: ${reason}`) }
function requiredText(value: unknown, subject: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(subject, `${field} is missing or empty`)
  if (placeholder.test(value)) fail(subject, `${field} contains UNKNOWN or a placeholder`)
  return value
}

/** ViteのJSONを入口で検査する。識別子だけの一覧を全文として扱わない。 */
export function parseLicenseEntries(value: unknown): LicenseEntry[] {
  if (!Array.isArray(value) || value.length === 0) fail(LICENSE_METADATA, 'no bundled licenses')
  const seen = new Set<string>()
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') fail(LICENSE_METADATA, 'invalid package entry')
    const entry = raw as Record<string, unknown>
    const name = requiredText(entry.name, LICENSE_METADATA, 'name')
    const version = requiredText(entry.version, name, 'version')
    const subject = `${name}@${version}`
    const identifier = requiredText(entry.identifier, subject, 'identifier')
    if (/\b(?:UNKNOWN|NOASSERTION|TBD|TODO|PLACEHOLDER)\b/i.test(identifier)) fail(subject, 'identifier contains UNKNOWN or a placeholder')
    if (/\b(?:UNLICENSED|NONE)\b/i.test(identifier)) fail(subject, 'no license grant; maintainer review required')
    const text = requiredText(entry.text, subject, 'license text')
    if (text.trim().length < 200) fail(subject, 'license text is too short; full terms required')
    if (identifier === 'MIT' && (!/copyright/i.test(text) || !/Permission is hereby granted/.test(text) || !/THE SOFTWARE IS PROVIDED/.test(text))) {
      fail(subject, 'MIT copyright, grant or disclaimer is missing')
    }
    if (seen.has(subject)) fail(subject, 'duplicate package entry')
    seen.add(subject)
    return { name, version, identifier, text }
  })
}

function readPackage(directory: string) {
  const info = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>
  return {
    name: requiredText(info.name, directory, 'package name'),
    version: requiredText(info.version, directory, 'package version'),
    identifier: requiredText(info.license, directory, 'package license'),
  }
}

function packageDirectory(modulePath: string): string {
  let directory = dirname(modulePath.replace(/[?#].*$/, ''))
  while (directory !== dirname(directory)) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name) return directory
    directory = dirname(directory)
  }
  return fail(modulePath, 'cannot find owning package.json')
}

/** ネストしたNOTICE/ライセンスも保持する。依存パッケージのnode_modulesは別の所有者。 */
export function readLicenseDocuments(directory: string): LicenseDocument[] {
  const documents: LicenseDocument[] = []
  const visit = (path: string, insideNotices: boolean) => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === 'node_modules' || item.name === '.git') continue
      const full = join(path, item.name)
      const selected = insideNotices || documentName.test(item.name)
      if (item.isDirectory()) visit(full, selected)
      else if (item.isFile() && selected) {
        const text = requiredText(readFileSync(full, 'utf8'), directory, slash(relative(directory, full)))
        documents.push({ file: slash(relative(directory, full)), text })
      }
    }
  }
  visit(directory, false)
  if (!documents.some(document => licenseName.test(document.file))) fail(directory, 'LICENSE/LICENCE/COPYING file is missing')
  return documents
}

function resolveInventoryDirectory(root: string, entry: LicensePackage): string {
  if (typeof entry.directory !== 'string' || isAbsolute(entry.directory) || !entry.directory.startsWith('node_modules/')) fail(key(entry), 'invalid package directory')
  const directory = resolve(root, entry.directory)
  if (relative(resolve(root, 'node_modules'), directory).startsWith('..')) fail(key(entry), 'package directory escapes node_modules')
  return directory
}

/** 全文はインストール済み原本から収録し、Viteの自動一覧・実バンドルの所有者と照合する。 */
export function createLicenseReport(root: string, rawEntries: unknown, inventory: LicenseInventory): string {
  const entries = parseLicenseEntries(rawEntries)
  if (inventory.schema !== 1 || !Array.isArray(inventory.packages) || inventory.packages.length === 0) fail(LICENSE_INVENTORY, 'invalid or empty inventory')
  const native = new Map(entries.map(entry => [key(entry), entry]))
  const matched = new Set<string>()
  const sections = new Map<string, string>()
  for (const item of inventory.packages) {
    if (!['dependency', 'runtime'].includes(item.kind) || !Array.isArray(item.modules) || item.modules.length === 0) fail(key(item), 'invalid inventory entry')
    const directory = resolveInventoryDirectory(root, item)
    const installed = readPackage(directory)
    if (key(installed) !== key(item)) fail(key(item), 'installed package differs from build inventory; rebuild required')
    let documents = readLicenseDocuments(directory)
    if (item.kind === 'dependency') {
      const entry = native.get(key(item))
      if (!entry) fail(key(item), 'bundled package missing from Vite license metadata')
      if (entry.identifier !== installed.identifier || !documents.some(document => document.text.trim() === entry.text)) fail(key(item), 'Vite license does not match installed original')
      matched.add(key(item))
    } else {
      // Viteは仮想モジュールを自動一覧から除外するため、実際に含まれる補助コードだけ補完する。
      if (item.name === 'vite') {
        const core = documents.find(document => document.file === 'LICENSE.md')
        const marker = '\n# Licenses of bundled dependencies'
        if (!core?.text.startsWith('# Vite core license') || !core.text.includes(marker)) fail(key(item), 'Vite core license section changed; review required')
        documents = [{ file: 'LICENSE.md (Vite core license section)', text: core.text.slice(0, core.text.indexOf(marker)) }]
      } else if (item.name !== 'rolldown') fail(key(item), 'unreviewed injected runtime owner')
      parseLicenseEntries([{ ...installed, text: documents[0].text }])
    }
    const scope = item.kind === 'runtime' ? '\nScope: injected browser runtime helpers only; not the build tool as a whole.\n' : ''
    const section = `## ${item.name} - ${item.version} (${installed.identifier})\n${scope}\n` + documents.map(document => `### ${document.file}\n\n${document.text}\n`).join('\n')
    if (sections.has(key(item)) && sections.get(key(item)) !== section) fail(key(item), 'same version has differing license documents')
    sections.set(key(item), section)
  }
  for (const entry of entries) if (!matched.has(key(entry))) fail(key(entry), 'Vite entry has no corresponding bundled package')
  const manual = requiredText(readFileSync(join(root, MANUAL_NOTICES), 'utf8'), MANUAL_NOTICES, 'manual notices')
  return '# Third-party licenses and notices\n\n' +
    'Generated from the production bundle and installed license files. Original license texts are not translated.\n' +
    'This inventory does not establish a new license for the application, teaching materials, or templates.\n\n' +
    [...sections.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, section]) => section).join('\n') +
    '\n# Manually recorded materials\n\n' + manual + '\n'
}

export function checkLicenseArtifacts(root: string, outDir = 'dist'): number {
  const output = resolve(root, outDir)
  const load = (file: string) => {
    try { return requiredText(readFileSync(join(output, file), 'utf8'), file, 'build artifact') }
    catch (error) { return fail(file, `cannot read valid build artifact: ${String(error)}`) }
  }
  const rawEntries: unknown = JSON.parse(load(LICENSE_METADATA))
  const inventory = JSON.parse(load(LICENSE_INVENTORY)) as LicenseInventory
  const expected = createLicenseReport(root, rawEntries, inventory)
  if (load(LICENSE_TEXT) !== expected) fail(LICENSE_TEXT, 'artifact differs from full original licenses/notices; rebuild required')
  return new Set(inventory.packages.map(key)).size
}

/** Vite標準のbuild.licenseを使用し、NOTICE・仮想ランタイム・手動素材だけ補足する。 */
export function licenseNoticesPlugin(): Plugin {
  let root = ''
  return {
    name: 'license-notices',
    apply: 'build',
    configResolved(config) { root = config.root },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const native = bundle[LICENSE_METADATA]
        if (!native || native.type !== 'asset') return fail(LICENSE_METADATA, 'Vite build.license output missing')
        const directories = new Map<string, LicensePackage>()
        const require = createRequire(join(root, 'package.json'))
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue
          for (const moduleId of chunk.moduleIds) {
            let directory: string
            let kind: LicensePackage['kind'] = 'dependency'
            if (moduleId.startsWith('\0')) {
              kind = 'runtime'
              if (moduleId === '\0rolldown/runtime.js') directory = packageDirectory(require.resolve('rolldown'))
              else if (['\0vite/modulepreload-polyfill.js', '\0vite/preload-helper.js'].includes(moduleId)) directory = packageDirectory(require.resolve('vite'))
              else return fail(moduleId.replace(/\0/g, ''), 'unreviewed virtual module; check license provenance')
            } else if (slash(moduleId).includes('/node_modules/')) directory = packageDirectory(moduleId)
            else continue
            const path = slash(relative(root, directory))
            let item = directories.get(path)
            if (!item) {
              const info = readPackage(directory)
              item = { name: info.name, version: info.version, directory: path, kind, modules: [] }
              directories.set(path, item)
            }
            const recorded = moduleId.startsWith('\0') ? moduleId.slice(1) : slash(relative(directory, moduleId))
            if (!item.modules.includes(recorded)) item.modules.push(recorded)
          }
        }
        const inventory: LicenseInventory = { schema: 1, packages: [...directories.values()].sort((a, b) => key(a).localeCompare(key(b))) }
        const rawEntries: unknown = JSON.parse(typeof native.source === 'string' ? native.source : new TextDecoder().decode(native.source))
        const report = createLicenseReport(root, rawEntries, inventory)
        this.emitFile({ type: 'asset', fileName: LICENSE_INVENTORY, source: JSON.stringify(inventory, null, 2) + '\n' })
        this.emitFile({ type: 'asset', fileName: LICENSE_TEXT, source: report })
      },
    },
  }
}
