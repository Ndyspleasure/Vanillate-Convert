/**
 * Server-side services for API routes: job store, storage and the job service.
 *
 * Kept on `globalThis` so that route handlers and the optional embedded development worker
 * (started from `instrumentation.ts`, bundled separately) share one instance per process.
 * Returns null when server processing is disabled or not configured; routes then answer
 * `server-processing-disabled`.
 */
import 'server-only';

import { createLogger, type Logger, type LogLevel, type Registry } from '@vanillate/core';
import { inflateHead } from '@vanillate/engines/files';
import { JobService, jobStoreFromEnv, type JobStore } from '@vanillate/jobs';
import { storageFromEnv, type Storage } from '@vanillate/storage';

import { serverProcessingEnabled, siteRegistry } from './site.ts';

export interface Services {
  registry: Registry;
  store: JobStore;
  storage: Storage;
  jobs: JobService;
  logger: Logger;
}

const KEY = Symbol.for('vanillate.services');
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

type Holder = { [KEY]?: Services | null };

export function logger(): Logger {
  const level = LEVELS.find((l) => l === process.env.LOG_LEVEL) ?? 'info';
  return createLogger({ level, fields: { service: 'web' } });
}

export function getServices(): Services | null {
  const holder = globalThis as Holder;
  if (holder[KEY] !== undefined) return holder[KEY];
  if (!serverProcessingEnabled()) return (holder[KEY] = null);
  const log = logger();
  const store = jobStoreFromEnv(process.env);
  const storage = storageFromEnv(process.env);
  if (!store || !storage) {
    log.error('services.unconfigured', {
      message:
        'VANILLATE_SERVER_PROCESSING=enabled needs DATABASE_URL (or JOB_STORE=memory) and STORAGE_DRIVER',
    });
    return (holder[KEY] = null);
  }
  const registry = siteRegistry();
  const jobs = new JobService({
    store,
    storage,
    registry,
    logger: log,
    inflateHead,
    // Without live workers, refuse jobs instead of queuing work nobody will do.
    requireWorkers: process.env.VANILLATE_REQUIRE_WORKERS !== 'false',
  });
  return (holder[KEY] = { registry, store, storage, jobs, logger: log });
}
