import { defineConfig } from '@playwright/test';

const PORT = process.env.CI ? 5173 : 5199;

export default defineConfig({
  testDir: './e2e',
  timeout: 15000,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/test.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
