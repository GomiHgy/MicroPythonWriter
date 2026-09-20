import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { getBuildInfo } from './build/buildInfo.ts'
import { LICENSE_METADATA, licenseNoticesPlugin } from './build/licenses.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), licenseNoticesPlugin()],
  base: './',
  build: { license: { fileName: LICENSE_METADATA } },
  define: { __APP_BUILD__: JSON.stringify(getBuildInfo(fileURLToPath(new URL('.', import.meta.url)))) },
})
