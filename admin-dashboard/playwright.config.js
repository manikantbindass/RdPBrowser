import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  testMatch: '**/*.spec.js',
  workers: 1,
  timeout: 45000,
  use: {
    headless: true,
    actionTimeout: 10000,
    launchOptions: process.env.ADMIN_CHROME_PATH ? { executablePath: process.env.ADMIN_CHROME_PATH } : {},
    screenshot: 'only-on-failure',
  },
});
