import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: '*.spec.ts', workers: 1, timeout: 120000, expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:5175', channel: process.env.LANJIAN_TEST_BROWSER || undefined, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 15000 },
  webServer: [
    { command: 'npx tsx e2e/server.ts', url: 'http://127.0.0.1:5175/health', reuseExistingServer: false, timeout: 45000 }
  ]
})
