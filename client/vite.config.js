import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const VALID_APP_MODES = ['demo', 'private']

export default defineConfig(({ mode }) => {
  // loadEnv reads .env, .env.[mode] etc. from the client root, and -- by
  // Vite's own precedence rules -- an already-set process.env value (a shell
  // export) wins over anything a file defines. Reading process.env directly,
  // as an earlier version of this file did, missed every file-only value.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const rawAppMode = env.VITE_APP_MODE
  if (rawAppMode && !VALID_APP_MODES.includes(rawAppMode)) {
    throw new Error(`Invalid VITE_APP_MODE "${rawAppMode}". Set it to "demo" or "private".`)
  }

  return {
    plugins: [react()],
  }
})
