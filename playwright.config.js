import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'test/e2e/features/**/*.feature',
  steps: 'test/e2e/steps/**/*.js',
});

export default defineConfig({
  testDir,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8080',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'python3 -m http.server 8080 --directory public',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
  },
});
