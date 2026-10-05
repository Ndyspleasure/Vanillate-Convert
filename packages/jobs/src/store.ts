/**
 * Persistence and queue contract. The PostgreSQL implementation uses one table as both job
 * store and queue (`FOR UPDATE SKIP LOCKED`); the memory implementation mirrors its
 * semantics for tests and single-process development.
 */
import type { JobRecord, JobStatus, WorkerPool } from '@vanillate/core';

export type JobChanges = Partial<Omit<JobRecord, 'id' | 'version' | 'createdAt' | 'updatedAt'>>;

export interface EngineAvailability {
  available: boolean;
  version: string | null;
}

export interface WorkerInfo {
  id: string;
  pools: WorkerPool[];
  engines: Record<string, EngineAvailability>;
  version: string | null;
  startedAt: string;
  lastSeenAt: string;
}

export interface LeaseRecovery {
  requeued: string[];
  failed: string[];
}

export interface JobStore {
  readonly kind: 'memory' | 'postgres';
  insert(job: JobRecord): Promise<void>;
  get(id: string): Promise<JobRecord | null>;
  /** Applies changes only when `expectedVersion` matches; returns null on conflict. */
  update(
    id: string,
    expectedVersion: number,
    changes: JobChanges,
    now: Date,
  ): Promise<JobRecord | null>;
  /** Atomically claims the next runnable queued job of the given pools. */
  claim(
    workerId: string,
    pools: readonly WorkerPool[],
    leaseSeconds: number,
    now: Date,
  ): Promise<JobRecord | null>;
  /** Extends the lease. Returns the job status while the lease is held, null when it was lost. */
  heartbeat(
    id: string,
    workerId: string,
    leaseSeconds: number,
    progress: number,
    now: Date,
  ): Promise<JobStatus | null>;
  /** Requeues (or fails, when attempts are exhausted) jobs whose lease expired. */
  recoverLeases(now: Date, failedRetentionSeconds: number): Promise<LeaseRecovery>;
  /** Jobs whose `expiresAt` has passed (any status), oldest first. */
  findExpired(now: Date, limit: number): Promise<JobRecord[]>;
  remove(id: string): Promise<void>;
  upsertWorker(info: WorkerInfo): Promise<void>;
  removeWorker(id: string): Promise<void>;
  workersSeenSince(since: Date): Promise<WorkerInfo[]>;
  /** Increments a fixed-window counter and returns the new count. */
  hit(key: string, windowSeconds: number, now: Date): Promise<number>;
  purgeRateLimits(before: Date): Promise<void>;
  close(): Promise<void>;
}

export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}
