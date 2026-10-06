/**
 * The worker loop.
 *
 * - Claims jobs for its pools, only those whose engines are installed here, up to the
 *   configured concurrency.
 * - Renews each job's lease with heartbeats (carrying progress); a heartbeat that reports the
 *   job is no longer ours (cancelled, or the lease was lost) aborts the engines at once.
 * - Registers itself periodically so the API knows which conversions can run, and sweeps
 *   expired jobs (lease recovery, file retention).
 * - On shutdown it stops claiming, lets running jobs finish within a grace period, then aborts
 *   and requeues them.
 */
import { chmod, mkdir } from 'node:fs/promises';

import {
  toVanillateError,
  VanillateError,
  type JobRecord,
  type Logger,
  type Registry,
} from '@vanillate/core';
import type { EngineProbe, EngineSet, ProcessRunner } from '@vanillate/engines';
import type { JobService } from '@vanillate/jobs';
import type { Storage } from '@vanillate/storage';

import type { WorkerConfig } from './config.ts';
import { processJob } from './process.ts';

export interface WorkerDeps {
  config: WorkerConfig;
  service: JobService;
  storage: Storage;
  registry: Registry;
  runner: ProcessRunner;
  /** Installed engine adapters (unavailable engines already removed). */
  engines: EngineSet;
  probes: Readonly<Record<string, EngineProbe>>;
  logger: Logger;
  version?: string | null;
}

type StopReason = 'cancelled' | 'shutdown';

interface ActiveJob {
  controller: AbortController;
  done: Promise<void>;
  reason: StopReason | null;
}

/** Resolves after `ms`, or as soon as `signal` aborts (listeners are always removed). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export class Worker {
  private readonly deps: WorkerDeps;
  private readonly active = new Map<string, ActiveJob>();
  private readonly stopping = new AbortController();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly startedAt = new Date().toISOString();
  private loop: Promise<void> | null = null;
  private slotFreed: (() => void) | null = null;
  private rootReady: Promise<void> | null = null;

  constructor(deps: WorkerDeps) {
    this.deps = deps;
  }

  get id(): string {
    return this.deps.config.id;
  }

  /** Engine ids this worker can run. */
  get engineIds(): string[] {
    return Object.keys(this.deps.engines).sort();
  }

  get activeJobs(): number {
    return this.active.size;
  }

  async register(): Promise<void> {
    const engines: Record<string, { available: boolean; version: string | null }> = {};
    for (const [id, probe] of Object.entries(this.deps.probes)) {
      engines[id] = {
        available: probe.available && id in this.deps.engines,
        version: probe.version,
      };
    }
    await this.deps.service.registerWorker({
      id: this.id,
      pools: this.deps.config.pools,
      engines,
      version: this.deps.version ?? null,
      startedAt: this.startedAt,
    });
  }

  /**
   * The work root can be entered but not listed by the engine user (0711): each job directory
   * is reachable only by its unguessable name.
   */
  private prepareRoot(): Promise<void> {
    this.rootReady ??= (async () => {
      await mkdir(this.deps.config.workRoot, { recursive: true });
      await chmod(this.deps.config.workRoot, 0o711);
    })();
    return this.rootReady;
  }

  async start(): Promise<void> {
    const { config, logger } = this.deps;
    await this.prepareRoot();
    await this.register();
    this.timers.push(
      setInterval(() => {
        this.register().catch((error: unknown) => logger.warn('worker.register_failed', { error }));
      }, config.registerSeconds * 1000),
    );
    if (config.sweepSeconds > 0) {
      this.timers.push(
        setInterval(() => {
          this.deps.service
            .sweep()
            .catch((error: unknown) => logger.warn('sweep.failed', { error }));
        }, config.sweepSeconds * 1000),
      );
    }
    for (const timer of this.timers) timer.unref();
    logger.info('worker.started', {
      workerId: this.id,
      pools: config.pools,
      engines: this.engineIds,
      concurrency: config.concurrency,
      sandbox: this.deps.runner.sandbox,
      engineUser: this.deps.runner.user !== null,
    });
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    const { config, logger, service } = this.deps;
    let idle = config.pollMs;
    while (!this.stopping.signal.aborted) {
      if (this.active.size >= config.concurrency) {
        await new Promise<void>((resolve) => {
          const signal = this.stopping.signal;
          const done = (): void => {
            signal.removeEventListener('abort', done);
            this.slotFreed = null;
            resolve();
          };
          this.slotFreed = done;
          signal.addEventListener('abort', done, { once: true });
        });
        continue;
      }
      let job: JobRecord | null;
      try {
        job = await service.claim(this.id, config.pools, config.leaseSeconds, this.engineIds);
      } catch (error) {
        logger.warn('worker.claim_failed', { error });
        await sleep(Math.min(idle * 2, 30_000), this.stopping.signal);
        idle = Math.min(idle * 2, 30_000);
        continue;
      }
      if (!job) {
        await sleep(idle, this.stopping.signal);
        idle = Math.min(Math.round(idle * 1.5), config.pollMs * 5);
        continue;
      }
      idle = config.pollMs;
      this.track(job);
    }
  }

  /** Claims and processes a single job, waiting for it; for tests and one-shot runs. */
  async runOnce(): Promise<boolean> {
    const { config, service } = this.deps;
    await this.prepareRoot();
    const job = await service.claim(this.id, config.pools, config.leaseSeconds, this.engineIds);
    if (!job) return false;
    await this.track(job).done;
    return true;
  }

  private track(job: JobRecord): ActiveJob {
    const controller = new AbortController();
    const entry: ActiveJob = { controller, done: Promise.resolve(), reason: null };
    entry.done = this.execute(job, entry).finally(() => {
      this.active.delete(job.id);
      this.slotFreed?.();
    });
    this.active.set(job.id, entry);
    return entry;
  }

  private async execute(job: JobRecord, entry: ActiveJob): Promise<void> {
    const { config, logger, service } = this.deps;
    const log = logger.child({ jobId: job.id, attempt: job.attempts });
    let progress = 0;
    const started = Date.now();
    const beat = setInterval(
      () => {
        service
          .heartbeat(job, this.id, config.leaseSeconds, Math.min(99, progress * 100))
          .then((ours) => {
            if (!ours && !entry.controller.signal.aborted) {
              entry.reason = 'cancelled';
              entry.controller.abort();
            }
          })
          .catch((error: unknown) => log.warn('job.heartbeat_failed', { error }));
      },
      Math.max(1000, (config.leaseSeconds * 1000) / 3),
    );
    log.info('job.started', { pool: job.pool, target: job.target.routeId });
    try {
      await processJob(
        job,
        {
          service,
          storage: this.deps.storage,
          registry: this.deps.registry,
          runner: this.deps.runner,
          engines: this.deps.engines,
          binaries: this.binaries(),
          logger: log,
          workerId: this.id,
          workRoot: config.workRoot,
        },
        entry.controller.signal,
        (fraction) => {
          progress = Math.max(progress, fraction);
        },
      );
      log.info('job.processed', { ms: Date.now() - started });
    } catch (error) {
      await this.handleFailure(job, entry, error, log);
    } finally {
      clearInterval(beat);
    }
  }

  private async handleFailure(
    job: JobRecord,
    entry: ActiveJob,
    error: unknown,
    log: Logger,
  ): Promise<void> {
    const { service } = this.deps;
    if (entry.reason === 'cancelled') {
      log.info('job.stopped', { reason: 'cancelled or lease lost' });
      return;
    }
    if (entry.reason === 'shutdown') {
      // Not the job's fault: put it back in the queue for another worker.
      await service.fail(
        job,
        this.id,
        new VanillateError('server-unavailable', { detail: 'worker shut down', retryable: true }),
      );
      return;
    }
    const failure = toVanillateError(error);
    if (failure.kind === 'system') {
      log.error('job.error', {
        code: failure.code,
        detail: failure.detail,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
    await service
      .fail(job, this.id, failure)
      .catch((cause: unknown) => log.error('job.fail_record_failed', { error: cause }));
  }

  private binaries(): Record<string, string> {
    const binaries: Record<string, string> = {};
    for (const [id, probe] of Object.entries(this.deps.probes)) {
      if (probe.binary) binaries[id] = probe.binary;
    }
    return binaries;
  }

  /** Stops claiming, waits for running jobs up to the grace period, then aborts them. */
  async stop(): Promise<void> {
    const { config, logger } = this.deps;
    this.stopping.abort();
    for (const timer of this.timers) clearInterval(timer);
    await this.loop;
    const running = [...this.active.values()];
    if (running.length > 0) {
      logger.info('worker.draining', { jobs: running.length, graceMs: config.shutdownGraceMs });
      const drained = Promise.all(running.map((job) => job.done));
      const timedOut = await Promise.race([
        drained.then(() => false),
        sleep(config.shutdownGraceMs).then(() => true),
      ]);
      if (timedOut) {
        for (const job of this.active.values()) {
          job.reason = 'shutdown';
          job.controller.abort();
        }
        await Promise.all([...this.active.values()].map((job) => job.done));
      }
    }
    logger.info('worker.stopped', { workerId: this.id });
  }
}
