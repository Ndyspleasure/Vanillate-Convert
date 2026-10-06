import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // The web app's `@/…` path alias (apps/web/tsconfig.json).
      { find: /^@\//, replacement: `${fromRoot('./apps/web/src')}/` },
      { find: /^server-only$/, replacement: fromRoot('./test/stubs/server-only.ts') },
    ],
  },
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
