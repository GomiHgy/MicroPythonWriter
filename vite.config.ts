import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { getBuildInfo } from './build/buildInfo.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { __APP_BUILD__: JSON.stringify(getBuildInfo(fileURLToPath(new URL('.', import.meta.url)))) },
})
