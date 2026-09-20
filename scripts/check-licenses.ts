import { fileURLToPath } from 'node:url'
import { checkLicenseArtifacts } from '../build/licenses.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
try {
  const count = checkLicenseArtifacts(root)
  console.log(`[licenses] PASS: ${count} bundled packages/runtime owners; original licenses and manual notices are present.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
