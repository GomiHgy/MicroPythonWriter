/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { build } from 'vite'
import {
  checkLicenseArtifacts, createLicenseReport, LICENSE_INVENTORY, LICENSE_METADATA,
  LICENSE_TEXT, MANUAL_NOTICES, parseLicenseEntries, readLicenseDocuments,
} from '../../build/licenses'
import type { LicenseEntry, LicenseInventory } from '../../build/licenses'

const root = fileURLToPath(new URL('../../', import.meta.url))
const packageFile = (name: string, file: string) => join(root, 'node_modules', name, file)
const mitOriginal = readFileSync(packageFile('react', 'LICENSE'), 'utf8')
const validEntry = (): LicenseEntry => ({ name: '@fixture/widget', version: '1.2.3', identifier: 'MIT', text: mitOriginal.trim() })
const temporaryRoots: string[] = []

function writeFixtureFile(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'micropythonwriter-licenses-'))
  temporaryRoots.push(directory)
  const packageDirectory = join(directory, 'node_modules/@fixture/widget')
  const entry = validEntry()
  const inventory: LicenseInventory = {
    schema: 1,
    packages: [{ name: entry.name, version: entry.version, directory: 'node_modules/@fixture/widget', kind: 'dependency', modules: ['index.js'] }],
  }
  writeFixtureFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: entry.name, version: entry.version, license: entry.identifier }))
  writeFixtureFile(join(packageDirectory, 'LICENSE'), mitOriginal)
  writeFixtureFile(join(directory, MANUAL_NOTICES), 'Fixture inventory. This file grants no license for the application.\n')
  return { root: directory, packageDirectory, entry, inventory }
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('ライセンス検証は欠落・仮置きを黙って通さない', () => {
  it.each([undefined, null, {}, [], ''])('空または不正な一覧を拒否する: %j', value => {
    expect(() => parseLicenseEntries(value)).toThrow(LICENSE_METADATA)
  })

  for (const field of ['identifier', 'text'] as const) {
    it.each([undefined, '', ' \r\n ', 'UNKNOWN', 'TODO', 'PLACEHOLDER', 'License text goes here'])(`${field} の欠落・仮置きを依存名付きで拒否する: %j`, value => {
      expect(() => parseLicenseEntries([{ ...validEntry(), [field]: value }])).toThrow('@fixture/widget@1.2.3')
    })
  }

  it.each(['UNLICENSED', 'NONE'])('ライセンス許諾のない識別子を拒否する: %s', identifier => {
    expect(() => parseLicenseEntries([{ ...validEntry(), identifier }])).toThrow('no license grant')
  })

  it.each(['MIT OR UNKNOWN', 'MIT OR NOASSERTION'])('複合識別子中の未確認条件を見逃さない: %s', identifier => {
    expect(() => parseLicenseEntries([{ ...validEntry(), identifier }])).toThrow('@fixture/widget@1.2.3')
  })

  it('識別子のみ・全文の省略・重複を拒否する', () => {
    expect(() => parseLicenseEntries([{ ...validEntry(), text: 'MIT' }])).toThrow('full terms required')
    expect(() => parseLicenseEntries([{ ...validEntry(), text: mitOriginal.replace(/Copyright[^\n]*\n/gi, '') }])).toThrow('copyright')
    expect(() => parseLicenseEntries([validEntry(), validEntry()])).toThrow('duplicate package entry')
  })

  it.each([undefined, '', ' \n ', 'UNKNOWN', 'License text goes here'])('実際のLICENSE原本がない場合も失敗する: %j', text => {
    const value = fixture()
    const license = join(value.packageDirectory, 'LICENSE')
    if (text === undefined) rmSync(license)
    else writeFixtureFile(license, text)
    expect(() => createLicenseReport(value.root, [value.entry], value.inventory)).toThrow(/(?:@fixture[\\/]widget|@fixture\/widget@1\.2\.3)/)
  })

  it('元のLICENSE・複数NOTICEの改行と全文をそのまま収録する', () => {
    const value = fixture()
    const original = mitOriginal.replace(/\r?\n/g, '\r\n') + '\r\n'
    const notice = 'Copyright 2026 Example contributors.\r\n原文の権利表示。\r\n\r\n'
    const nestedNotice = 'Additional attribution from a nested NOTICE file.\n'
    writeFixtureFile(join(value.packageDirectory, 'LICENSE'), original)
    writeFixtureFile(join(value.packageDirectory, 'NOTICE'), notice)
    writeFixtureFile(join(value.packageDirectory, 'third-party/NOTICE.txt'), nestedNotice)
    writeFixtureFile(join(value.packageDirectory, 'node_modules/not-bundled/LICENSE'), 'This belongs to a separate package.')
    const report = createLicenseReport(value.root, [{ ...value.entry, text: original.trim() }], value.inventory)
    expect(report).toContain(original)
    expect(report).toContain(notice)
    expect(report).toContain(nestedNotice)
    expect(report).not.toContain('This belongs to a separate package.')
    expect(readLicenseDocuments(value.packageDirectory).map(document => document.file)).toEqual(['LICENSE', 'NOTICE', 'third-party/NOTICE.txt'])
  })

  it('空NOTICEも未確認のまま配布しない', () => {
    const value = fixture()
    writeFixtureFile(join(value.packageDirectory, 'NOTICE'), '')
    expect(() => createLicenseReport(value.root, [value.entry], value.inventory)).toThrow(/NOTICE.*missing or empty/)
  })

  it('Vite一覧・実際の依存・インストール済み原文の食い違いを拒否する', () => {
    const value = fixture()
    expect(() => createLicenseReport(value.root, [{ ...value.entry, name: '@fixture/other' }], value.inventory)).toThrow('missing from Vite license metadata')
    expect(() => createLicenseReport(value.root, [value.entry, { ...value.entry, name: '@fixture/unbundled' }], value.inventory)).toThrow('@fixture/unbundled@1.2.3')
    expect(() => createLicenseReport(value.root, [{ ...value.entry, text: `${value.entry.text}\nChanged original.` }], value.inventory)).toThrow('does not match installed original')
    value.inventory.packages[0].version = '9.9.9'
    expect(() => createLicenseReport(value.root, [value.entry], value.inventory)).toThrow('installed package differs')
  })

  it.each([LICENSE_TEXT, LICENSE_METADATA, LICENSE_INVENTORY])('配信物 %s の欠落・空ファイルを検出する', file => {
    const value = fixture()
    const output = join(value.root, 'dist')
    writeFixtureFile(join(output, LICENSE_METADATA), JSON.stringify([value.entry]))
    writeFixtureFile(join(output, LICENSE_INVENTORY), JSON.stringify(value.inventory))
    writeFixtureFile(join(output, LICENSE_TEXT), createLicenseReport(value.root, [value.entry], value.inventory))
    expect(checkLicenseArtifacts(value.root)).toBe(1)
    rmSync(join(output, file))
    expect(() => checkLicenseArtifacts(value.root)).toThrow(file)
    writeFixtureFile(join(output, file), '')
    expect(() => checkLicenseArtifacts(value.root)).toThrow(file)
  })

  it('全文の一部削除は非空ファイルでも検出する', () => {
    const value = fixture()
    const output = join(value.root, 'dist')
    writeFixtureFile(join(output, LICENSE_METADATA), JSON.stringify([value.entry]))
    writeFixtureFile(join(output, LICENSE_INVENTORY), JSON.stringify(value.inventory))
    const report = createLicenseReport(value.root, [value.entry], value.inventory)
    writeFixtureFile(join(output, LICENSE_TEXT), report.replace('THE SOFTWARE IS PROVIDED', 'REMOVED DISCLAIMER'))
    expect(() => checkLicenseArtifacts(value.root)).toThrow('artifact differs')
  })
})

describe('実際の本番バンドルの第三者ライセンス', () => {
  const assets = new Map<string, string>()
  let javascript = ''

  // distや依存パッケージは変更せず、実際のVite設定で一度だけ生成する。
  beforeAll(async () => {
    const nodeEnv = process.env.NODE_ENV
    try {
      // VitestのNODE_ENV=testを本番ビルドへ持ち込まない。
      process.env.NODE_ENV = 'production'
      const result = await build({
        root,
        configFile: join(root, 'vite.config.ts'),
        mode: 'production',
        base: '/MicroPythonWriter/',
        logLevel: 'silent',
        build: { write: false },
      })
      for (const bundle of Array.isArray(result) ? result : [result]) {
        if (!('output' in bundle)) throw new Error('Expected a non-watch Vite build')
        for (const item of bundle.output) {
          if (item.type === 'asset') {
            assets.set(item.fileName, typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source))
          } else {
            javascript += item.code
          }
        }
      }
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnv
    }
  }, 60000)

  it('通常のビルドで空でない全文ファイルを生成する', () => {
    const text = assets.get('third-party-licenses.txt')
    expect(text).toBeDefined()
    expect(text!.length).toBeGreaterThan(1000)
    expect(text).toContain('Permission is hereby granted, free of charge')
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  })

  it.each([
    'react', 'react-dom', 'scheduler',
    '@codemirror/autocomplete', '@codemirror/commands', '@codemirror/language', '@codemirror/lang-python', '@codemirror/state',
    '@codemirror/theme-one-dark', '@codemirror/view',
    '@lezer/common', '@lezer/highlight', '@lezer/lr', '@lezer/python',
    '@marijn/find-cluster-break', 'style-mod', 'w3c-keyname', '@xterm/addon-fit', '@xterm/xterm',
  ])('収録された直接・間接依存 %s の実バージョンとLICENSE原文を保持する', name => {
    const metadata = JSON.parse(readFileSync(packageFile(name, 'package.json'), 'utf8')) as { version: string }
    const original = readFileSync(packageFile(name, 'LICENSE'), 'utf8')
    const text = assets.get('third-party-licenses.txt')!
    expect(text).toContain(name)
    expect(text).toContain(metadata.version)
    expect(text).toContain(original)
  })

  it('ブラウザに含まれない開発専用パッケージを同梱一覧に混ぜない', () => {
    const inventory = JSON.parse(assets.get(LICENSE_INVENTORY)!) as LicenseInventory
    const names = inventory.packages.map(item => item.name)
    for (const name of ['typescript', 'vitest', 'eslint', '@vitejs/plugin-react']) {
      expect(names).not.toContain(name)
    }
  })

  it('依存の手書きリストでなくViteの実収録一覧と全文を照合する', () => {
    const entries = parseLicenseEntries(JSON.parse(assets.get(LICENSE_METADATA)!))
    const inventory = JSON.parse(assets.get(LICENSE_INVENTORY)!) as LicenseInventory
    const nativeNames = entries.map(entry => `${entry.name}@${entry.version}`).sort()
    const bundledNames = inventory.packages.filter(item => item.kind === 'dependency').map(item => `${item.name}@${item.version}`).sort()
    expect(bundledNames).toEqual(nativeNames)
    expect(assets.get(LICENSE_TEXT)).toBe(createLicenseReport(root, entries, inventory))
  })

  it('ビルドツール由来でも実際に配信される仮想ランタイムの権利表示を保持する', () => {
    const inventory = JSON.parse(assets.get(LICENSE_INVENTORY)!) as LicenseInventory
    const helpers = inventory.packages.filter(item => item.kind === 'runtime')
    expect(helpers.map(item => item.name).sort()).toEqual(['rolldown', 'vite'])
    const text = assets.get(LICENSE_TEXT)!
    for (const helper of helpers) {
      expect(helper.modules.length).toBeGreaterThan(0)
      expect(text).toContain(`## ${helper.name} - ${helper.version}`)
    }
    expect(text).toContain('injected browser runtime helpers only')
    expect(text).toContain(readFileSync(packageFile('rolldown', 'LICENSE'), 'utf8'))
    expect(text).toContain(readFileSync(packageFile('rolldown', 'THIRD-PARTY-LICENSE'), 'utf8'))
    const viteOriginal = readFileSync(packageFile('vite', 'LICENSE.md'), 'utf8')
    const bundledDependenciesAt = viteOriginal.indexOf('\n# Licenses of bundled dependencies')
    expect(bundledDependenciesAt).toBeGreaterThan(0)
    expect(text).toContain(viteOriginal.slice(0, bundledDependenciesAt))
  })

  it('手動素材の原文全体を収録し、現在の素材ハッシュと記録を一致させる', () => {
    const manual = readFileSync(join(root, MANUAL_NOTICES), 'utf8')
    const record = readFileSync(join(root, 'licenses/README.md'), 'utf8')
    expect(assets.get(LICENSE_TEXT)).toContain(manual)
    const iconHash = createHash('sha256').update(readFileSync(join(root, 'public/icons.svg'))).digest('hex')
    // 素材を変更した場合は出所・ライセンスの記録も再確認する。
    expect(iconHash).toBe('b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a')
    expect(manual).toContain(`素材 SHA-256: ${iconHash}`)
    expect(record).toContain(iconHash)
  })

  it('手動収録したCC0適用宣言・全文のハッシュを原文照合記録と一致させる', () => {
    const manual = readFileSync(join(root, MANUAL_NOTICES), 'utf8').replace(/\r\n/g, '\n')
    const original = manual.match(/----- 原文開始 -----\n([\s\S]*?)\n----- 原文終了 -----/)
    expect(original).not.toBeNull()
    const normalized = original![1].replace(/\n+$/, '') + '\n'
    const hash = createHash('sha256').update(normalized, 'utf8').digest('hex')
    expect(hash).toBe('bddc9f7c49ee36b85680b31d01da646295fda4b00f1e5a412a39f8128e1976ef')
    expect(readFileSync(join(root, 'licenses/README.md'), 'utf8')).toContain(hash)
  })

  it('サブパス配信の本番コードから同梱ファイルへリンクする', () => {
    expect(javascript).toContain('/MicroPythonWriter/third-party-licenses.txt')
    expect(assets.get('index.html')).toContain('/MicroPythonWriter/assets/')
    expect(assets.has('third-party-licenses.txt')).toBe(true)
  })

  it('公開ワークフローが通常ビルド後のdist全体をアップロードする', () => {
    const workflow = readFileSync(join(root, '.github/workflows/deploy-pages.yml'), 'utf8')
    const buildAt = workflow.indexOf('run: npm run build')
    const uploadAt = workflow.indexOf('uses: actions/upload-pages-artifact@')
    expect(buildAt).toBeGreaterThan(-1)
    expect(uploadAt).toBeGreaterThan(buildAt)
    expect(workflow.slice(uploadAt)).toMatch(/path:\s*dist\b/)
  })

  it('通常ビルドに成果物検証を組み込み公開時の実行忘れを防ぐ', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(manifest.scripts['check:licenses']).toBeTruthy()
    expect(manifest.scripts.build).toMatch(/vite build\s*&&\s*npm run check:licenses\b/)
  })
})
