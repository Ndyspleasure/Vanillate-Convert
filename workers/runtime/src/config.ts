/**
 * Worker configuration from environment variables.
 *
 *   WORKER_ID                  unique id (default: hostname + random suffix)
 *   WORKER_POOLS               comma-separated pools, or "all" (default)
 *   WORKER_CONCURRENCY         jobs processed at once (default 2)
 *   WORKER_WORK_DIR            scratch directory for job files (default: <tmp>/vanillate-work)
 *   WORKER_LEASE_SECONDS       job lease, renewed by heartbeats (default 60)
 *   WORKER_POLL_MS             idle polling interval (default 1000)
 *   WORKER_SWEEP_SECONDS       retention sweep interval, 0 disables (default 60)
 *   WORKER_SHUTDOWN_GRACE_MS   time running jobs get to finish on SIGTERM (default 25000)
 *   VANILLATE_SANDBOX          auto | bwrap | none (default auto)
 *   VANILLATE_ENGINE_USER      auto | none | <uid>:<gid> (auto: 65534:65534 when running as root)
 *   VANILLATE_DISABLED_ENGINES comma-separated engine ids not to use on this worker
 *   VANILLATE_ALLOW_UNISOLATED "1" allows production without sandbox or engine user (unsafe)
 */
import { randomBytes } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORKER_POOLS, type WorkerPool } from '@vanillate/core';
import { resolveSandbox, type EngineUser, type SandboxMode } from '@vanillate/engines';

export interface WorkerConfig {
  id: string;
  pools: WorkerPool[];
  concurrency: number;
  workRoot: string;
  leaseSeconds: number;
  pollMs: number;
  sweepSeconds: number;
  registerSeconds: number;
  shutdownGraceMs: number;
  sandbox: SandboxMode;
  engineUser: EngineUser | null;
  disabledEngines: string[];
  allowUnisolated: boolean;
  production: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function parsePools(value: string | undefined): WorkerPool[] {
  const items = list(value);
  if (items.length === 0 || items.includes('all')) return [...WORKER_POOLS];
  for (const item of items) {
    if (!(WORKER_POOLS as readonly string[]).includes(item)) {
      throw new Error(`WORKER_POOLS: unknown pool "${item}" (known: ${WORKER_POOLS.join(', ')})`);
    }
  }
  return [...new Set(items)] as WorkerPool[];
}

export function parseEngineUser(value: string | undefined, uid: number | null): EngineUser | null {
  const setting = (value ?? 'auto').trim().toLowerCase();
  if (setting === 'none') return null;
  if (setting === 'auto') return uid === 0 ? { uid: 65534, gid: 65534 } : null;
  const match = /^(\d+):(\d+)$/.exec(setting);
  if (!match) throw new Error('VANILLATE_ENGINE_USER must be auto, none or <uid>:<gid>');
  const user = { uid: Number(match[1]), gid: Number(match[2]) };
  if (user.uid === 0) throw new Error('VANILLATE_ENGINE_USER must not be root');
  if (uid !== 0 && uid !== user.uid) {
    throw new Error('VANILLATE_ENGINE_USER needs the worker to run as root to switch users');
  }
  return user;
}

export function workerConfigFromEnv(env: Env = process.env): WorkerConfig {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  return {
    id: env.WORKER_ID?.trim() || `${hostname()}-${randomBytes(3).toString('hex')}`,
    pools: parsePools(env.WORKER_POOLS),
    concurrency: integer(env, 'WORKER_CONCURRENCY', 2, 1, 64),
    workRoot: env.WORKER_WORK_DIR?.trim() || join(tmpdir(), 'vanillate-work'),
    leaseSeconds: integer(env, 'WORKER_LEASE_SECONDS', 60, 15, 3600),
    pollMs: integer(env, 'WORKER_POLL_MS', 1000, 50, 60_000),
    sweepSeconds: integer(env, 'WORKER_SWEEP_SECONDS', 60, 0, 86_400),
    registerSeconds: 30,
    shutdownGraceMs: integer(env, 'WORKER_SHUTDOWN_GRACE_MS', 25_000, 0, 3_600_000),
    sandbox: resolveSandbox(env.VANILLATE_SANDBOX),
    engineUser: parseEngineUser(env.VANILLATE_ENGINE_USER, uid),
    disabledEngines: list(env.VANILLATE_DISABLED_ENGINES),
    allowUnisolated: env.VANILLATE_ALLOW_UNISOLATED === '1',
    production: env.NODE_ENV === 'production',
  };
}
