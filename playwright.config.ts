import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: { baseURL: 'http://localhost:4173/' },
  webServer: { command: 'npm run build && npm run preview', url: 'http://localhost:4173/', reuseExistingServer: true, timeout: 180000 },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'celular', use: { ...devices['Galaxy S9+'], viewport: { width: 412, height: 915 }, browserName: 'chromium' } },
  ],
});
