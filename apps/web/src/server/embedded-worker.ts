/**
 * A worker inside the web server process (development and end-to-end tests). It shares the
 * job service with the API routes through the services container.
 */
import 'server-only';

import { probeEngines, ProcessRunner, SERVER_ENGINES } from '@vanillate/engines';
import { Worker, workerConfigFromEnv } from '@vanillate/worker';

import { getServices } from './services.ts';

const KEY = Symbol.for('vanillate.embedded-worker');

export async function startEmbeddedWorker(): Promise<void> {
  const holder = globalThis as { [KEY]?: Worker };
  if (holder[KEY]) return;
  const services = getServices();
  if (!services) {
    console.warn('[vanillate] embedded worker not started: server processing is not configured');
    return;
  }
  const config = workerConfigFromEnv();
  const runner = new ProcessRunner({
    sandbox: config.sandbox,
    user: config.engineUser,
    memoryBytes: config.engineMemoryBytes,
  });
  if (process.env.NODE_ENV === 'production') {
    services.logger.warn('worker.embedded_in_production', {
      message: 'run workers separately in production (pnpm worker)',
    });
  }
  const ids = services.registry.engines
    .filter(
      (engine) =>
        engine.mode === 'server' &&
        engine.status !== 'disabled' &&
        !config.disabledEngines.includes(engine.id),
    )
    .map((engine) => engine.id);
  const probes = await probeEngines(runner, ids);
  const engines = Object.fromEntries(
    Object.entries(SERVER_ENGINES).filter(([id]) => probes[id]?.available === true),
  );
  const worker = new Worker({
    config: { ...config, id: `embedded-${config.id}` },
    service: services.jobs,
    storage: services.storage,
    registry: services.registry,
    runner,
    engines,
    probes,
    logger: services.logger.child({ component: 'embedded-worker' }),
  });
  await worker.start();
  holder[KEY] = worker;
}
