/**
 * End-to-end tests against a production build (`next build` + `next start`).
 *
 * The server runs with server processing enabled, an in-memory job store, local storage and
 * an embedded worker, so server conversions are tested end to end without external services.
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a preinstalled Chromium instead of Playwright's.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3210);
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync(preinstalled) ? preinstalled : undefined);
// The config is loaded again in each test worker; they inherit the runner's environment, so
// only the runner creates a directory.
process.env.VANILLATE_E2E_STORAGE_DIR ??= mkdtempSync(join(tmpdir(), 'vanillate-e2e-storage-'));
const storageDir = process.env.VANILLATE_E2E_STORAGE_DIR;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    // Build and start with the same environment: static pages bake in whether server
    // processing is enabled.
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/en`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      VANILLATE_SERVER_PROCESSING: 'enabled',
      VANILLATE_EMBEDDED_WORKER: '1',
      JOB_STORE: 'memory',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: storageDir,
      STORAGE_SIGNING_SECRET: 'e2e-signing-secret-at-least-32-characters-long',
      WORKER_POLL_MS: '100',
      WORKER_CONCURRENCY: '2',
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
      LOG_LEVEL: 'warn',
    },
  },
});
