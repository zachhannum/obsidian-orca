import { defineConfig } from '@playwright/test';

/** The port the built site is served on while the suite reads it. */
const PORT = 4329;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  reporter: 'list',
  use: { baseURL: `http://localhost:${String(PORT)}` },
  // The suite reads what `npm run build` wrote, so it runs after a build.
  webServer: {
    command: `node scripts/serve.mjs ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}/start/anatomy/`,
    reuseExistingServer: process.env['CI'] === undefined,
  },
});
