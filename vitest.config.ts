import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'catalog/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'workers/*/src/**/*.test.ts',
      'workers/*/test/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/.next/**', 'apps/web/e2e/**'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
