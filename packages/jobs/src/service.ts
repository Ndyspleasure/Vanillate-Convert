/**
 * Job service: the business rules of server-side processing, shared by the web API and the
 * workers.
 *
 *   create ─▶ upload (direct to storage) ─▶ completeUpload (verify size + content)
 *          ─▶ queued ─▶ claim (worker) ─▶ heartbeat … ─▶ complete | fail (retry/backoff)
 *          ─▶ download (signed URLs) ─▶ sweep (delete files, expire, purge records)
 *
 * Access to a job requires its capability token (returned once at creation, stored hashed).
 */
import {
  checkFileLimits,
  detectFormat,
  errorMessage,
  newId,
  newToken,
  sameFamily,
  sanitizeFilename,
  sha256Hex,
  timingSafeEqual,
  validateOptions,
  VanillateError,
  type CategoryId,
  type JobError,
  type JobOutput,
  type JobRecord,
  type JobStatus,
  type JobTarget,
  type Locale,
  type Logger,
  type OptionDef,
  type PublicError,
  type Registry,
  type Route,
  type ToolRoute,
  type WorkerPool,
} from '@vanillate/core';
import { inputKey, outputKey, type SignedRequest, type Storage } from '@vanillate/storage';

import type { JobStore, WorkerInfo } from './store.ts';

/** How long a worker heartbeat counts as "alive" for availability checks. */
export const WORKER_ALIVE_SECONDS = 120;
const DETECT_BYTES = 65536;
const DEFAULT_MAX_ATTEMPTS = 3;
const ACTIVE_JOB_SAFETY_SECONDS = 24 * 3600;

export type CreateTarget =
  { kind: 'conversion'; from: string; to: string } | { kind: 'tool'; toolId: string };

export interface CreateFile {
  name: string;
  size: number;
  /** Format detected by the client; verified on the server after upload. */
  format: string;
}

export interface CreateJobRequest {
  target: CreateTarget;
  options?: unknown;
  files: CreateFile[];
  /** Opaque, already-hashed client identifier used for rate limiting. */
  clientKey: string;
}

export interface PublicJob {
  id: string;
  status: JobStatus;
  progress: number;
  target: CreateTarget;
  inputs: { id: string; name: string; size: number; format: string; uploaded: boolean }[];
  outputs: {
    id: string;
    name: string;
    size: number;
    format: string;
    download: { url: string; expiresAt: string } | null;
  }[];
  error: PublicError | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string;
}

export interface CreateJobResult {
  job: PublicJob;
  token: string;
  uploads: { inputId: string; request: SignedRequest }[];
}

export interface JobServiceOptions {
  store: JobStore;
  storage: Storage;
  registry: Registry;
  logger: Logger;
  /**
   * Decompresses the beginning of a gzip stream so `.tar.gz` uploads are recognized by content
   * (runtime-specific; omitted where no decompressor is available).
   */
  inflateHead?: (head: Uint8Array) => Promise<Uint8Array | null>;
  now?: () => Date;
  /** Skip the live worker check (tests, or deployments that accept queuing without workers). */
  requireWorkers?: boolean;
}

interface ResolvedTarget {
  target: JobTarget;
  route: Route | ToolRoute;
  category: CategoryId;
  options: readonly OptionDef[];
  engines: string[];
  pool: WorkerPool;
  multiInput: boolean;
  acceptsFormat: (format: string) => boolean;
}

export class JobService {
  private readonly store: JobStore;
  private readonly storage: Storage;
  private readonly registry: Registry;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly requireWorkers: boolean;
  private readonly inflateHead: JobServiceOptions['inflateHead'];

  constructor(options: JobServiceOptions) {
    this.store = options.store;
    this.storage = options.storage;
    this.registry = options.registry;
    this.logger = options.logger;
    this.inflateHead = options.inflateHead;
    this.now = options.now ?? (() => new Date());
    this.requireWorkers = options.requireWorkers ?? true;
  }

  // ---------------------------------------------------------------- helpers

  private seconds(offset: number): string {
    return new Date(this.now().getTime() + offset * 1000).toISOString();
  }

  private resolve(target: CreateTarget): ResolvedTarget {
    if (target.kind === 'conversion') {
      const conversion = this.registry.conversion(target.from, target.to);
      if (!conversion?.offered) throw new VanillateError('conversion-unsupported');
      const route = conversion.routes.find((r) => r.offered && r.mode === 'server');
      if (!route?.pool) {
        throw new VanillateError(
          conversion.modes.includes('browser') ? 'bad-request' : 'server-processing-disabled',
          {
            detail: 'no server route; use browser processing',
          },
        );
      }
      return {
        target: { kind: 'conversion', routeId: route.id, from: route.from, to: route.to },
        route,
        category: this.registry.requireFormat(route.from).category,
        options: route.options,
        engines: route.engines,
        pool: route.pool,
        multiInput: route.cardinality === 'n:1' || route.cardinality === 'n:n',
        acceptsFormat: (format) => sameFamily(format, route.from),
      };
    }
    const tool = this.registry.tool(target.toolId);
    if (!tool?.offered) throw new VanillateError('conversion-unsupported');
    const route = tool.routes.find((r) => r.offered && r.mode === 'server');
    if (!route?.pool) {
      throw new VanillateError(
        tool.routes.some((r) => r.offered) ? 'bad-request' : 'server-processing-disabled',
        {
          detail: 'no server route for tool',
        },
      );
    }
    const serverInputs = new Set(this.registry.engine(route.engine)?.read ?? []);
    return {
      target: { kind: 'tool', routeId: route.id, toolId: tool.id, operation: route.operation },
      route,
      category: tool.category,
      options: route.options,
      engines: [route.engine],
      pool: route.pool,
      multiInput: tool.cardinality === 'n:1' || tool.cardinality === 'n:n',
      acceptsFormat: (format) =>
        route.inputs.includes('*') ||
        (route.inputs.includes(format) && (serverInputs.size === 0 || serverInputs.has(format))),
    };
  }

  private async assertWorkersAvailable(
    pool: WorkerPool,
    engines: readonly string[],
  ): Promise<void> {
    if (!this.requireWorkers) return;
    const since = new Date(this.now().getTime() - WORKER_ALIVE_SECONDS * 1000);
    const workers = await this.store.workersSeenSince(since);
    const capable = workers.some(
      (w: WorkerInfo) =>
        w.pools.includes(pool) && engines.every((engine) => w.engines[engine]?.available === true),
    );
    if (!capable)
      throw new VanillateError('server-unavailable', {
        detail: `no live worker for ${pool}: ${engines.join(',')}`,
      });
  }

  private async rateLimit(clientKey: string): Promise<void> {
    const { jobsPerMinute, jobsPerHour } = this.registry.rateLimits;
    const now = this.now();
    const [minute, hour] = await Promise.all([
      this.store.hit(`jobs:m:${clientKey}`, 60, now),
      this.store.hit(`jobs:h:${clientKey}`, 3600, now),
    ]);
    if (minute > jobsPerMinute || hour > jobsPerHour) throw new VanillateError('rate-limited');
  }

  private async authorize(id: string, token: string): Promise<JobRecord> {
    const job = await this.store.get(id);
    if (!job) throw new VanillateError('job-not-found');
    if (!timingSafeEqual(job.tokenHash, await sha256Hex(token)))
      throw new VanillateError('unauthorized');
    return job;
  }

  private publicTarget(target: JobTarget): CreateTarget {
    return target.kind === 'conversion'
      ? { kind: 'conversion', from: target.from, to: target.to }
      : { kind: 'tool', toolId: target.toolId };
  }

  private publicError(error: JobError | null, locale: Locale): PublicError | null {
    return error
      ? { code: error.code, message: errorMessage(error.code, locale), retryable: error.retryable }
      : null;
  }

  async toPublic(job: JobRecord, locale: Locale = 'en'): Promise<PublicJob> {
    const retention = this.registry.retention;
    const downloadable = job.status === 'completed' && new Date(job.expiresAt) > this.now();
    const remaining = Math.max(
      1,
      Math.floor((new Date(job.expiresAt).getTime() - this.now().getTime()) / 1000),
    );
    const outputs = await Promise.all(
      job.outputs.map(async (output) => {
        let download: PublicJob['outputs'][number]['download'] = null;
        if (downloadable) {
          const request = await this.storage.createDownloadUrl(output.storageKey, {
            filename: output.name,
            contentType: output.mimeType,
            expiresIn: Math.min(retention.signedUrlSeconds, remaining),
          });
          download = { url: request.url, expiresAt: request.expiresAt };
        }
        return {
          id: output.id,
          name: output.name,
          size: output.size,
          format: output.format,
          download,
        };
      }),
    );
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      target: this.publicTarget(job.target),
      inputs: job.inputs.map((i) => ({
        id: i.id,
        name: i.name,
        size: i.size,
        format: i.format,
        uploaded: i.uploaded,
      })),
      outputs,
      error: this.publicError(job.error, locale),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
    };
  }

  // ------------------------------------------------------------- client API

  async createJob(request: CreateJobRequest, locale: Locale = 'en'): Promise<CreateJobResult> {
    const resolved = this.resolve(request.target);
    if (request.files.length === 0) throw new VanillateError('bad-request', { detail: 'no files' });
    if (!resolved.multiInput && request.files.length > 1) {
      throw new VanillateError('bad-request', { detail: 'this conversion takes one file per job' });
    }
    for (const file of request.files) {
      if (!Number.isSafeInteger(file.size) || file.size < 0)
        throw new VanillateError('bad-request', { detail: 'invalid size' });
      if (!resolved.acceptsFormat(file.format))
        throw new VanillateError('format-mismatch', { detail: file.format });
    }
    const limitViolation = checkFileLimits(
      request.files,
      this.registry.limitsFor('server', resolved.category),
    );
    if (limitViolation) throw new VanillateError(limitViolation);
    const validation = validateOptions(resolved.options, request.options);
    if (!validation.ok) {
      throw new VanillateError('invalid-options', {
        fields: Object.fromEntries(validation.errors.map((e) => [e.id, e.code])),
      });
    }
    await this.assertWorkersAvailable(resolved.pool, resolved.engines);
    await this.rateLimit(request.clientKey);

    const id = newId('job');
    const token = newToken();
    const now = this.now().toISOString();
    const inputs = request.files.map((file) => {
      const inputId = newId('in');
      return {
        id: inputId,
        name: sanitizeFilename(file.name),
        size: file.size,
        format: file.format,
        storageKey: inputKey(id, inputId),
        uploaded: false,
      };
    });
    const job: JobRecord = {
      id,
      status: 'pending',
      progress: 0,
      target: resolved.target,
      engines: resolved.engines,
      pool: resolved.pool,
      options: validation.values,
      inputs,
      outputs: [],
      error: null,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      priority: 0,
      tokenHash: await sha256Hex(token),
      workerId: null,
      leaseExpiresAt: null,
      runAfter: now,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      expiresAt: this.seconds(this.registry.retention.abandonedUploadSeconds),
      version: 0,
    };
    await this.store.insert(job);
    const uploads = await Promise.all(
      inputs.map(async (input) => ({
        inputId: input.id,
        request: await this.storage.createUploadUrl(input.storageKey, {
          contentType:
            this.registry.format(input.format)?.mimeTypes[0] ?? 'application/octet-stream',
          size: input.size,
          expiresIn: this.registry.retention.signedUrlSeconds,
        }),
      })),
    );
    this.logger.info('job.created', {
      jobId: id,
      route: resolved.route.id,
      files: inputs.length,
      bytes: inputs.reduce((n, i) => n + i.size, 0),
    });
    return { job: await this.toPublic(job, locale), token, uploads };
  }

  /** Verifies an uploaded input (exact size, content matches the declared format). */
  async completeUpload(
    id: string,
    token: string,
    inputId: string,
    locale: Locale = 'en',
  ): Promise<PublicJob> {
    let job = await this.authorize(id, token);
    if (job.status !== 'pending' && job.status !== 'uploading') {
      if (job.status === 'expired') throw new VanillateError('job-expired');
      return this.toPublic(job, locale);
    }
    const input = job.inputs.find((i) => i.id === inputId);
    if (!input) throw new VanillateError('bad-request', { detail: 'unknown input' });
    if (!input.uploaded) {
      const stored = await this.storage.head(input.storageKey);
      if (!stored || stored.size !== input.size) throw new VanillateError('upload-incomplete');
      const head = await this.storage.readRange(input.storageKey, 0, DETECT_BYTES - 1);
      const tail =
        input.size > DETECT_BYTES
          ? await this.storage.readRange(
              input.storageKey,
              Math.max(0, input.size - DETECT_BYTES),
              input.size - 1,
            )
          : head;
      const inflatedHead = this.inflateHead ? await this.inflateHead(head) : null;
      const detection = detectFormat(
        { name: input.name, size: input.size, head, tail, inflatedHead },
        this.registry,
      );
      const resolved = this.resolve(this.publicTarget(job.target));
      const acceptsAny =
        job.target.kind === 'tool' &&
        this.registry.tool(job.target.toolId)?.inputs.includes('*') === true;
      if (
        !acceptsAny &&
        (!detection.format ||
          !sameFamily(detection.format.id, input.format) ||
          !resolved.acceptsFormat(input.format))
      ) {
        await this.storage.delete(input.storageKey);
        await this.fail(
          job,
          null,
          new VanillateError('format-mismatch', {
            detail: `declared ${input.format}, detected ${detection.format?.id ?? 'unknown'}`,
          }),
        );
        throw new VanillateError('format-mismatch');
      }
      const inputs = job.inputs.map((i) => (i.id === inputId ? { ...i, uploaded: true } : i));
      const all = inputs.every((i) => i.uploaded);
      const next = await this.store.update(
        job.id,
        job.version,
        all
          ? {
              inputs,
              status: 'queued',
              runAfter: this.now().toISOString(),
              expiresAt: this.seconds(ACTIVE_JOB_SAFETY_SECONDS),
            }
          : { inputs, status: 'uploading' },
        this.now(),
      );
      if (!next) return this.completeUpload(id, token, inputId, locale); // concurrent update: retry
      job = next;
      if (all) this.logger.info('job.queued', { jobId: job.id, pool: job.pool });
    }
    return this.toPublic(job, locale);
  }

  async getJob(id: string, token: string, locale: Locale = 'en'): Promise<PublicJob> {
    return this.toPublic(await this.authorize(id, token), locale);
  }

  async cancelJob(id: string, token: string, locale: Locale = 'en'): Promise<PublicJob> {
    const job = await this.authorize(id, token);
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'expired'
    ) {
      return this.toPublic(job, locale);
    }
    const next = await this.store.update(
      job.id,
      job.version,
      {
        status: 'cancelled',
        error: { code: 'job-cancelled', retryable: false },
        completedAt: this.now().toISOString(),
        expiresAt: this.seconds(this.registry.retention.failedSeconds),
        workerId: null,
        leaseExpiresAt: null,
      },
      this.now(),
    );
    if (!next) return this.cancelJob(id, token, locale);
    await this.deleteFiles(next);
    this.logger.info('job.cancelled', { jobId: id });
    return this.toPublic(next, locale);
  }

  // ------------------------------------------------------------- worker API

  claim(
    workerId: string,
    pools: readonly WorkerPool[],
    leaseSeconds: number,
    engines?: readonly string[],
  ): Promise<JobRecord | null> {
    return this.store.claim(workerId, pools, leaseSeconds, this.now(), engines);
  }

  /** Extends the lease. Returns false when the worker must stop (cancelled or lease lost). */
  async heartbeat(
    job: JobRecord,
    workerId: string,
    leaseSeconds: number,
    progress: number,
  ): Promise<boolean> {
    const status = await this.store.heartbeat(job.id, workerId, leaseSeconds, progress, this.now());
    return status === 'processing' || status === 'finalizing';
  }

  /** Records outputs after the worker stored them, then deletes the inputs. */
  async complete(
    job: JobRecord,
    workerId: string,
    outputs: JobOutput[],
  ): Promise<JobRecord | null> {
    const current = await this.store.get(job.id);
    if (
      !current ||
      current.workerId !== workerId ||
      (current.status !== 'processing' && current.status !== 'finalizing')
    ) {
      await this.storage.deleteMany(outputs.map((o) => o.storageKey));
      return null;
    }
    const next = await this.store.update(
      current.id,
      current.version,
      {
        status: 'completed',
        progress: 100,
        outputs,
        error: null,
        completedAt: this.now().toISOString(),
        expiresAt: this.seconds(this.registry.retention.outputSeconds),
        workerId: null,
        leaseExpiresAt: null,
      },
      this.now(),
    );
    if (!next) return this.complete(job, workerId, outputs);
    await this.storage.deleteMany(next.inputs.map((i) => i.storageKey));
    this.logger.info('job.completed', {
      jobId: job.id,
      outputs: outputs.length,
      bytes: outputs.reduce((n, o) => n + o.size, 0),
    });
    return next;
  }

  /**
   * Fails a job, or requeues it with exponential backoff when the error is retryable and
   * attempts remain. `workerId` null means the failure is not tied to a lease (e.g. upload).
   */
  async fail(
    job: JobRecord,
    workerId: string | null,
    error: VanillateError,
  ): Promise<JobRecord | null> {
    const current = await this.store.get(job.id);
    if (
      !current ||
      current.status === 'completed' ||
      current.status === 'cancelled' ||
      current.status === 'expired'
    )
      return current;
    if (workerId !== null && current.workerId !== workerId) return current;
    const retry = error.retryable && current.attempts < current.maxAttempts && workerId !== null;
    const next = await this.store.update(
      current.id,
      current.version,
      retry
        ? {
            status: 'queued',
            workerId: null,
            leaseExpiresAt: null,
            runAfter: this.seconds(30 * 2 ** (current.attempts - 1)),
          }
        : {
            status: 'failed',
            error: { code: error.code, retryable: false },
            workerId: null,
            leaseExpiresAt: null,
            completedAt: this.now().toISOString(),
            expiresAt: this.seconds(this.registry.retention.failedSeconds),
          },
      this.now(),
    );
    if (!next) return this.fail(job, workerId, error);
    this.logger[retry ? 'warn' : 'info'](retry ? 'job.retry' : 'job.failed', {
      jobId: job.id,
      code: error.code,
      kind: error.kind,
      attempt: current.attempts,
      detail: error.detail,
    });
    if (!retry) await this.deleteFiles(next);
    return next;
  }

  async registerWorker(info: Omit<WorkerInfo, 'lastSeenAt'>): Promise<void> {
    await this.store.upsertWorker({ ...info, lastSeenAt: this.now().toISOString() });
  }

  // ------------------------------------------------------------- retention

  private async deleteFiles(job: JobRecord): Promise<void> {
    try {
      await this.storage.deleteMany([
        ...job.inputs.map((i) => i.storageKey),
        ...job.outputs.map((o) => o.storageKey),
      ]);
    } catch (error) {
      // The sweeper retries later; never fail the request because of cleanup.
      this.logger.warn('storage.cleanup_failed', { jobId: job.id, error });
    }
  }

  /**
   * Recovers expired leases, deletes files of expired jobs, removes old records and purges old
   * rate-limit counters. Safe to run concurrently from several workers.
   */
  async sweep(limit = 200): Promise<{ recovered: number; expired: number; removed: number }> {
    const now = this.now();
    const retention = this.registry.retention;
    const recovery = await this.store.recoverLeases(now, retention.failedSeconds);
    let expired = 0;
    let removed = 0;
    for (const job of await this.store.findExpired(now, limit)) {
      if (job.status === 'expired') {
        await this.store.remove(job.id);
        removed++;
        continue;
      }
      if (job.status === 'processing' || job.status === 'finalizing') continue; // lease recovery handles these
      await this.deleteFiles(job);
      const next = await this.store.update(
        job.id,
        job.version,
        {
          status: 'expired',
          outputs: job.outputs,
          expiresAt: new Date(now.getTime() + retention.jobRecordSeconds * 1000).toISOString(),
          ...(job.status === 'pending' || job.status === 'uploading' || job.status === 'queued'
            ? { error: { code: 'job-expired' as const, retryable: false } }
            : {}),
        },
        now,
      );
      if (next) expired++;
    }
    await this.store.purgeRateLimits(new Date(now.getTime() - 2 * 3600 * 1000));
    if (recovery.requeued.length + recovery.failed.length + expired + removed > 0) {
      this.logger.info('sweep.done', {
        requeued: recovery.requeued.length,
        failedLeases: recovery.failed.length,
        expired,
        removed,
      });
    }
    return { recovered: recovery.requeued.length + recovery.failed.length, expired, removed };
  }

  /** Engines available on live workers, for health checks and the UI. */
  async liveCapabilities(): Promise<{ workers: number; pools: WorkerPool[]; engines: string[] }> {
    const since = new Date(this.now().getTime() - WORKER_ALIVE_SECONDS * 1000);
    const workers = await this.store.workersSeenSince(since);
    const pools = new Set<WorkerPool>();
    const engines = new Set<string>();
    for (const worker of workers) {
      worker.pools.forEach((p) => pools.add(p));
      for (const [engine, state] of Object.entries(worker.engines))
        if (state.available) engines.add(engine);
    }
    return { workers: workers.length, pools: [...pools].sort(), engines: [...engines].sort() };
  }
}

export function outputRecord(
  jobId: string,
  name: string,
  format: string,
  mimeType: string,
  size: number,
): JobOutput {
  const id = newId('out');
  return { id, name, format, mimeType, size, storageKey: outputKey(jobId, id) };
}
