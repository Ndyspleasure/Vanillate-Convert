/**
 * Worker entrypoint (`pnpm worker`).
 *
 * Needs a shared job store (DATABASE_URL) and shared storage (S3, or local storage on a volume
 * shared with the web app). Engines are probed at startup; only installed engines are used and
 * advertised, so the API never queues work no worker can run.
 */
import { createLogger, getRegistry, type LogLevel } from '@vanillate/core';
import { inflateHead, probeEngines, ProcessRunner, SERVER_ENGINES } from '@vanillate/engines';
import { JobService, jobStoreFromEnv } from '@vanillate/jobs';
import { storageFromEnv } from '@vanillate/storage';

import { workerConfigFromEnv } from './config.ts';
import { Worker } from './worker.ts';

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

async function main(): Promise<void> {
  const level = LEVELS.find((l) => l === process.env.LOG_LEVEL) ?? 'info';
  const logger = createLogger({ level, fields: { service: 'worker' } });
  const config = workerConfigFromEnv();

  const store = jobStoreFromEnv(process.env);
  if (!store || store.kind === 'memory') {
    throw new Error(
      'The worker needs DATABASE_URL: a PostgreSQL job store shared with the web app.',
    );
  }
  const storage = storageFromEnv(process.env);
  if (!storage || storage.driver === 'memory') {
    throw new Error(
      'The worker needs shared storage: STORAGE_DRIVER=s3, or local on a shared volume.',
    );
  }

  const runner = new ProcessRunner({ sandbox: config.sandbox, user: config.engineUser });
  if (!runner.isolated) {
    if (config.production && !config.allowUnisolated) {
      throw new Error(
        'Engines would run without isolation. Enable bubblewrap (VANILLATE_SANDBOX=bwrap) or run ' +
          'the worker as root with VANILLATE_ENGINE_USER, or set VANILLATE_ALLOW_UNISOLATED=1 ' +
          'to accept the risk.',
      );
    }
    logger.warn('worker.unisolated', {
      message: 'engine processes are not isolated from the worker (development only)',
    });
  }

  const registry = getRegistry();
  const wanted = registry.engines
    .filter((engine) => engine.mode === 'server' && engine.status !== 'disabled')
    .map((engine) => engine.id)
    .filter((id) => !config.disabledEngines.includes(id));
  const probes = await probeEngines(runner, wanted);
  const engines = Object.fromEntries(
    Object.entries(SERVER_ENGINES).filter(([id]) => probes[id]?.available === true),
  );
  logger.info('worker.engines', {
    available: Object.fromEntries(
      Object.entries(probes).map(([id, probe]) => [id, probe.available ? probe.version : null]),
    ),
  });
  if (Object.keys(engines).length === 0) throw new Error('No conversion engine is installed.');

  const service = new JobService({ store, storage, registry, logger, inflateHead });
  const worker = new Worker({
    config,
    service,
    storage,
    registry,
    runner,
    engines,
    probes,
    logger,
    version: process.env.VANILLATE_VERSION ?? null,
  });
  await worker.start();

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    logger.info('worker.signal', { signal });
    worker
      .stop()
      .then(() => store.close())
      .catch((error: unknown) => logger.error('worker.shutdown_failed', { error }))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      t: new Date().toISOString(),
      level: 'error',
      event: 'worker.fatal',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
