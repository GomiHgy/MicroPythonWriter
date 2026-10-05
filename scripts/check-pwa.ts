import { fileURLToPath } from 'node:url'
import { checkPwaArtifacts } from '../build/pwa.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
try {
  const count = checkPwaArtifacts(root)
  console.log(`[pwa] PASS: ${count} shell/optional runtime files; hashes, complete cache inventories, manifest and PNG icons are valid.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
