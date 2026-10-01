import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// npmの固定版から同一オリジンへ配信。再生するまで約12MBのVMは読み込まない。
export const simulationRuntimeFiles = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'] as const
export const simulationRuntimeVersion = '0.29.3'
export function simulationLicenseReport(root: string): string {
  // ライセンス単体テストの仮プロジェクトにはVMがない。
  if (!existsSync(join(root, 'node_modules/pyodide/package.json'))) return ''
  const directory = join(root, 'licenses/simulation')
  const sources = JSON.parse(readFileSync(join(directory, 'sources.json'), 'utf8')) as { file: string; url: string; sha256: string }[]
  if (sources.length !== 16) throw new Error('Review the complete simulation license inventory before changing it.')
  return '\n# Browser simulation runtime\n\n' + readFileSync(join(directory, 'PROVENANCE.txt'), 'utf8') + '\n' + sources.map(({ file, url, sha256 }) => {
    const text = readFileSync(join(directory, file), 'utf8')
    if (text.length < 200) throw new Error(`Simulation license is missing: ${file}`)
    if (createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex') !== sha256) throw new Error(`Simulation original license changed: ${file}`)
    return `\n## ${file}\nSource: ${url}\n\n${text}\n`
  }).join('')
}
export function checkSimulationRuntime(root: string, output: string): number {
  if (!existsSync(join(root, 'node_modules/pyodide/package.json'))) return 0
  simulationLicenseReport(root)
  const manifest = JSON.parse(readFileSync(join(output, 'simulation-runtime/provenance.json'), 'utf8')) as { package: string; sha256: Record<string, string> }
  if (manifest.package !== `pyodide@${simulationRuntimeVersion}`) throw new Error('Simulation runtime provenance mismatch')
  for (const file of simulationRuntimeFiles) {
    const original = readFileSync(join(root, 'node_modules/pyodide', file))
    const artifact = readFileSync(join(output, 'simulation-runtime', file))
    if (!original.equals(artifact) || manifest.sha256[file] !== createHash('sha256').update(artifact).digest('hex')) throw new Error(`Simulation runtime artifact mismatch: ${file}`)
  }
  return 1
}
export function simulationRuntimePlugin(): Plugin {
  let root = ''
  const read = (file: string) => readFileSync(join(root, 'node_modules/pyodide', file))
  return {
    name: 'local-simulation-runtime',
    configResolved(config) { root = config.root },
    buildStart() {
      const installed = JSON.parse(read('package.json').toString()) as { version: string }
      if (installed.version !== simulationRuntimeVersion) throw new Error('Pyodide version changed: review simulation runtime and licenses.')
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? ''
        const file = path.slice(path.lastIndexOf('/') + 1)
        if (!path.startsWith('/simulation-runtime/') || !simulationRuntimeFiles.some(name => name === file)) return next()
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.json') ? 'application/json' : file.endsWith('.zip') ? 'application/zip' : 'text/javascript')
        response.end(read(file))
      })
    },
    generateBundle() {
      const hashes: Record<string, string> = {}
      for (const file of simulationRuntimeFiles) {
        const source = read(file)
        hashes[file] = createHash('sha256').update(source).digest('hex')
        this.emitFile({ type: 'asset', fileName: `simulation-runtime/${file}`, source })
      }
      this.emitFile({ type: 'asset', fileName: 'simulation-runtime/provenance.json', source: JSON.stringify({ package: `pyodide@${simulationRuntimeVersion}`, source: `https://github.com/pyodide/pyodide/tree/${simulationRuntimeVersion}`, modified: false, sha256: hashes }, null, 2) + '\n' })
    },
  }
}
