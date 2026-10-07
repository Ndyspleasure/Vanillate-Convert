/**
 * Creates the job store from environment variables.
 *
 *   DATABASE_URL     PostgreSQL connection string (required for production)
 *   DATABASE_SSL     "true" to require TLS (most managed providers)
 *   JOB_STORE=memory use the in-memory store (tests and single-process development only)
 */
import { MemoryJobStore } from './memory.ts';
import { PostgresJobStore } from './postgres.ts';
import type { JobStore } from './store.ts';

export function jobStoreFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): JobStore | null {
  if (env.JOB_STORE === 'memory') return new MemoryJobStore();
  const url = env.DATABASE_URL;
  if (!url) return null;
  return new PostgresJobStore(url, {
    ssl: env.DATABASE_SSL === 'true',
    max: Number(env.DATABASE_POOL_MAX ?? 5),
  });
}
