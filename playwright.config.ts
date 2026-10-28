import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const E2E_DB = 'file:' + path.resolve(import.meta.dirname, 'data/e2e.db');

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5173', locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
  webServer: {
    command: 'node scripts/e2e-db.mjs && pnpm dev',
    url: 'http://localhost:5173',
    timeout: 120_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: E2E_DB, NO_OPEN: '1' },
  },
});
