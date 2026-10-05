import type { JobRecord, JobStatus, WorkerPool } from '@vanillate/core';

import {
  windowStart,
  type JobChanges,
  type JobStore,
  type LeaseRecovery,
  type WorkerInfo,
} from './store.ts';

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory job store with the same semantics as the PostgreSQL store. */
export class MemoryJobStore implements JobStore {
  readonly kind = 'memory' as const;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly workers = new Map<string, WorkerInfo>();
  private readonly counters = new Map<string, number>();

  insert(job: JobRecord): Promise<void> {
    if (this.jobs.has(job.id)) return Promise.reject(new Error(`duplicate job ${job.id}`));
    this.jobs.set(job.id, clone(job));
    return Promise.resolve();
  }

  get(id: string): Promise<JobRecord | null> {
    const job = this.jobs.get(id);
    return Promise.resolve(job ? clone(job) : null);
  }

  update(
    id: string,
    expectedVersion: number,
    changes: JobChanges,
    now: Date,
  ): Promise<JobRecord | null> {
    const job = this.jobs.get(id);
    if (!job || job.version !== expectedVersion) return Promise.resolve(null);
    const next: JobRecord = {
      ...job,
      ...clone(changes),
      version: job.version + 1,
      updatedAt: now.toISOString(),
    };
    this.jobs.set(id, next);
    return Promise.resolve(clone(next));
  }

  claim(
    workerId: string,
    pools: readonly WorkerPool[],
    leaseSeconds: number,
    now: Date,
  ): Promise<JobRecord | null> {
    const candidates = [...this.jobs.values()]
      .filter((j) => j.status === 'queued' && pools.includes(j.pool) && new Date(j.runAfter) <= now)
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.runAfter.localeCompare(b.runAfter) ||
          a.createdAt.localeCompare(b.createdAt),
      );
    const job = candidates[0];
    if (!job) return Promise.resolve(null);
    const claimed: JobRecord = {
      ...job,
      status: 'processing',
      workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
      attempts: job.attempts + 1,
      startedAt: job.startedAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      version: job.version + 1,
    };
    this.jobs.set(job.id, claimed);
    return Promise.resolve(clone(claimed));
  }

  heartbeat(
    id: string,
    workerId: string,
    leaseSeconds: number,
    progress: number,
    now: Date,
  ): Promise<JobStatus | null> {
    const job = this.jobs.get(id);
    if (
      !job ||
      job.workerId !== workerId ||
      (job.status !== 'processing' && job.status !== 'finalizing')
    ) {
      return Promise.resolve(null);
    }
    job.leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    job.progress = Math.max(0, Math.min(100, Math.round(progress)));
    job.updatedAt = now.toISOString();
    return Promise.resolve(job.status);
  }

  recoverLeases(now: Date, failedRetentionSeconds: number): Promise<LeaseRecovery> {
    const result: LeaseRecovery = { requeued: [], failed: [] };
    for (const job of this.jobs.values()) {
      if ((job.status !== 'processing' && job.status !== 'finalizing') || !job.leaseExpiresAt)
        continue;
      if (new Date(job.leaseExpiresAt) >= now) continue;
      const exhausted = job.attempts >= job.maxAttempts;
      job.status = exhausted ? 'failed' : 'queued';
      job.workerId = null;
      job.leaseExpiresAt = null;
      job.runAfter = now.toISOString();
      job.updatedAt = now.toISOString();
      job.version += 1;
      if (exhausted) {
        job.error = { code: 'conversion-timeout', retryable: false };
        job.completedAt = now.toISOString();
        job.expiresAt = new Date(now.getTime() + failedRetentionSeconds * 1000).toISOString();
        result.failed.push(job.id);
      } else {
        result.requeued.push(job.id);
      }
    }
    return Promise.resolve(result);
  }

  findExpired(now: Date, limit: number): Promise<JobRecord[]> {
    return Promise.resolve(
      [...this.jobs.values()]
        .filter((j) => new Date(j.expiresAt) < now)
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
        .slice(0, limit)
        .map(clone),
    );
  }

  remove(id: string): Promise<void> {
    this.jobs.delete(id);
    return Promise.resolve();
  }

  upsertWorker(info: WorkerInfo): Promise<void> {
    this.workers.set(info.id, clone(info));
    return Promise.resolve();
  }

  removeWorker(id: string): Promise<void> {
    this.workers.delete(id);
    return Promise.resolve();
  }

  workersSeenSince(since: Date): Promise<WorkerInfo[]> {
    return Promise.resolve(
      [...this.workers.values()].filter((w) => new Date(w.lastSeenAt) >= since).map(clone),
    );
  }

  hit(key: string, windowSeconds: number, now: Date): Promise<number> {
    const bucket = `${key}@${windowStart(now, windowSeconds).toISOString()}`;
    const count = (this.counters.get(bucket) ?? 0) + 1;
    this.counters.set(bucket, count);
    return Promise.resolve(count);
  }

  purgeRateLimits(before: Date): Promise<void> {
    for (const bucket of this.counters.keys()) {
      const at = bucket.slice(bucket.lastIndexOf('@') + 1);
      if (new Date(at) < before) this.counters.delete(bucket);
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
