/**
 * PostgreSQL job store and queue (one table; `FOR UPDATE SKIP LOCKED` claims).
 *
 * Works with any PostgreSQL 13+ (Supabase, Neon, RDS, self-hosted). With a transaction-mode
 * pooler (PgBouncer, Supavisor) keep `prepare: false`, which is the default here.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JobRecord, JobStatus, WorkerPool } from '@vanillate/core';
import postgres from 'postgres';

import {
  windowStart,
  type JobChanges,
  type JobStore,
  type LeaseRecovery,
  type WorkerInfo,
} from './store.ts';

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

const COLUMN: Record<keyof JobChanges, string> = {
  status: 'status',
  progress: 'progress',
  target: 'target',
  engines: 'engines',
  pool: 'pool',
  options: 'options',
  inputs: 'inputs',
  outputs: 'outputs',
  error: 'error',
  attempts: 'attempts',
  maxAttempts: 'max_attempts',
  priority: 'priority',
  tokenHash: 'token_hash',
  workerId: 'worker_id',
  leaseExpiresAt: 'lease_expires_at',
  runAfter: 'run_after',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  expiresAt: 'expires_at',
};
const JSON_FIELDS = new Set(['target', 'options', 'inputs', 'outputs', 'error']);

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).toISOString();
  return null;
}

function toRecord(row: Row): JobRecord {
  return {
    id: row.id as string,
    status: row.status as JobStatus,
    progress: Number(row.progress),
    target: row.target as JobRecord['target'],
    engines: row.engines as string[],
    pool: row.pool as WorkerPool,
    options: row.options as JobRecord['options'],
    inputs: row.inputs as JobRecord['inputs'],
    outputs: row.outputs as JobRecord['outputs'],
    error: (row.error ?? null) as JobRecord['error'],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    priority: Number(row.priority),
    tokenHash: row.token_hash as string,
    workerId: (row.worker_id ?? null) as string | null,
    leaseExpiresAt: iso(row.lease_expires_at),
    runAfter: iso(row.run_after) ?? new Date(0).toISOString(),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    expiresAt: iso(row.expires_at) ?? new Date(0).toISOString(),
    version: Number(row.version),
  };
}

export class PostgresJobStore implements JobStore {
  readonly kind = 'postgres' as const;
  readonly sql: Sql;

  constructor(url: string, options: { max?: number; ssl?: boolean } = {}) {
    this.sql = postgres(url, {
      max: options.max ?? 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => undefined,
      ...(options.ssl ? { ssl: 'require' as const } : {}),
      types: { bigint: postgres.BigInt },
    });
  }

  private value(field: string, value: unknown): unknown {
    if (JSON_FIELDS.has(field))
      return value === null ? null : this.sql.json(value as postgres.JSONValue);
    return value;
  }

  async insert(job: JobRecord): Promise<void> {
    await this.sql`
      insert into vc_jobs (
        id, status, progress, target, engines, pool, options, inputs, outputs, error, attempts, max_attempts,
        priority, token_hash, worker_id, lease_expires_at, run_after, created_at, updated_at, started_at,
        completed_at, expires_at, version
      ) values (
        ${job.id}, ${job.status}, ${job.progress}, ${this.sql.json(job.target)}, ${job.engines},
        ${job.pool}, ${this.sql.json(job.options)}, ${this.sql.json(job.inputs as unknown as postgres.JSONValue)},
        ${this.sql.json(job.outputs as unknown as postgres.JSONValue)}, ${job.error ? this.sql.json(job.error as unknown as postgres.JSONValue) : null},
        ${job.attempts}, ${job.maxAttempts}, ${job.priority}, ${job.tokenHash}, ${job.workerId}, ${job.leaseExpiresAt},
        ${job.runAfter}, ${job.createdAt}, ${job.updatedAt}, ${job.startedAt}, ${job.completedAt}, ${job.expiresAt}, ${job.version}
      )`;
  }

  async get(id: string): Promise<JobRecord | null> {
    const rows = await this.sql<Row[]>`select * from vc_jobs where id = ${id}`;
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async update(
    id: string,
    expectedVersion: number,
    changes: JobChanges,
    now: Date,
  ): Promise<JobRecord | null> {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    const set: Record<string, unknown> = {};
    for (const [field, value] of entries) {
      const column = COLUMN[field as keyof JobChanges];
      set[column] = this.value(field, value);
    }
    set.updated_at = now.toISOString();
    const rows = await this.sql<Row[]>`
      update vc_jobs set ${this.sql(set)}, version = version + 1
      where id = ${id} and version = ${expectedVersion}
      returning *`;
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async claim(
    workerId: string,
    pools: readonly WorkerPool[],
    leaseSeconds: number,
    now: Date,
  ): Promise<JobRecord | null> {
    const rows = await this.sql<Row[]>`
      with next as (
        select id from vc_jobs
        where status = 'queued' and pool = any(${pools as string[]}) and run_after <= ${now.toISOString()}
        order by priority desc, run_after, created_at
        for update skip locked
        limit 1
      )
      update vc_jobs j set
        status = 'processing',
        worker_id = ${workerId},
        lease_expires_at = ${new Date(now.getTime() + leaseSeconds * 1000).toISOString()},
        attempts = j.attempts + 1,
        started_at = coalesce(j.started_at, ${now.toISOString()}),
        updated_at = ${now.toISOString()},
        version = j.version + 1
      from next where j.id = next.id
      returning j.*`;
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async heartbeat(
    id: string,
    workerId: string,
    leaseSeconds: number,
    progress: number,
    now: Date,
  ): Promise<JobStatus | null> {
    const rows = await this.sql<Row[]>`
      update vc_jobs set
        lease_expires_at = ${new Date(now.getTime() + leaseSeconds * 1000).toISOString()},
        progress = ${Math.max(0, Math.min(100, Math.round(progress)))},
        updated_at = ${now.toISOString()}
      where id = ${id} and worker_id = ${workerId} and status in ('processing', 'finalizing')
      returning status`;
    return rows[0] ? (rows[0].status as JobStatus) : null;
  }

  async recoverLeases(now: Date, failedRetentionSeconds: number): Promise<LeaseRecovery> {
    const rows = await this.sql<Row[]>`
      update vc_jobs set
        status = case when attempts < max_attempts then 'queued' else 'failed' end,
        error = case when attempts < max_attempts then error else '{"code":"conversion-timeout","retryable":false}'::jsonb end,
        completed_at = case when attempts < max_attempts then completed_at else ${now.toISOString()}::timestamptz end,
        expires_at = case when attempts < max_attempts then expires_at
          else ${new Date(now.getTime() + failedRetentionSeconds * 1000).toISOString()}::timestamptz end,
        worker_id = null,
        lease_expires_at = null,
        run_after = ${now.toISOString()},
        updated_at = ${now.toISOString()},
        version = version + 1
      where status in ('processing', 'finalizing') and lease_expires_at < ${now.toISOString()}
      returning id, status`;
    return {
      requeued: rows.filter((r) => r.status === 'queued').map((r) => r.id as string),
      failed: rows.filter((r) => r.status === 'failed').map((r) => r.id as string),
    };
  }

  async findExpired(now: Date, limit: number): Promise<JobRecord[]> {
    const rows = await this.sql<Row[]>`
      select * from vc_jobs where expires_at < ${now.toISOString()} order by expires_at limit ${limit}`;
    return rows.map(toRecord);
  }

  async remove(id: string): Promise<void> {
    await this.sql`delete from vc_jobs where id = ${id}`;
  }

  async upsertWorker(info: WorkerInfo): Promise<void> {
    await this.sql`
      insert into vc_workers (id, pools, engines, version, started_at, last_seen_at)
      values (${info.id}, ${info.pools}, ${this.sql.json(info.engines as unknown as postgres.JSONValue)}, ${info.version},
        ${info.startedAt}, ${info.lastSeenAt})
      on conflict (id) do update set
        pools = excluded.pools, engines = excluded.engines, version = excluded.version, last_seen_at = excluded.last_seen_at`;
  }

  async removeWorker(id: string): Promise<void> {
    await this.sql`delete from vc_workers where id = ${id}`;
  }

  async workersSeenSince(since: Date): Promise<WorkerInfo[]> {
    const rows = await this.sql<
      Row[]
    >`select * from vc_workers where last_seen_at >= ${since.toISOString()}`;
    return rows.map((row) => ({
      id: row.id as string,
      pools: row.pools as WorkerPool[],
      engines: row.engines as WorkerInfo['engines'],
      version: (row.version ?? null) as string | null,
      startedAt: iso(row.started_at) ?? '',
      lastSeenAt: iso(row.last_seen_at) ?? '',
    }));
  }

  async hit(key: string, windowSeconds: number, now: Date): Promise<number> {
    const rows = await this.sql<Row[]>`
      insert into vc_rate_limits (key, window_start, count)
      values (${key}, ${windowStart(now, windowSeconds).toISOString()}, 1)
      on conflict (key, window_start) do update set count = vc_rate_limits.count + 1
      returning count`;
    return Number(rows[0]?.count ?? 1);
  }

  async purgeRateLimits(before: Date): Promise<void> {
    await this.sql`delete from vc_rate_limits where window_start < ${before.toISOString()}`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

/** Applies pending SQL migrations from `migrations/` in order, inside a transaction each. */
export async function migrate(
  url: string,
  directory = join(import.meta.dirname, '..', 'migrations'),
): Promise<string[]> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sql`create table if not exists vc_migrations (id text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set(
      (await sql<{ id: string }[]>`select id from vc_migrations`).map((r) => r.id),
    );
    const files = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const text = await readFile(join(directory, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into vc_migrations (id) values (${file})`;
      });
      ran.push(file);
    }
    return ran;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
