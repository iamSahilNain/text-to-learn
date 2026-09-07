import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test-only configuration. The production build keeps using vite.config.js.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
})
