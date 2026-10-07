/**
 * Job model and lifecycle state machine for server-side processing.
 *
 *   pending ─▶ uploading ─▶ queued ─▶ processing ─▶ finalizing ─▶ completed ─▶ expired
 *      │           │           │      ▲   │              │
 *      │           │           │      └───┘ (retry)       │
 *      └───────────┴───────────┴──────────┴──────────────┴─▶ failed / cancelled ─▶ expired
 *
 * pending     job created; upload targets issued; nothing uploaded yet
 * uploading   at least one input uploaded and verified
 * queued      all inputs verified; waiting for a worker
 * processing  a worker holds the lease and runs the engines
 * finalizing  outputs are validated and stored
 * completed   outputs are downloadable until `expiresAt`
 * failed      terminal failure (error code recorded)
 * cancelled   cancelled by the user
 * expired     files deleted by the retention sweeper; only the record remains
 */
import type { WorkerPool } from '../catalog/constants.ts';
import type { ErrorCode } from '../errors/codes.ts';
import type { OptionValues } from '../options/validate.ts';

export const JOB_STATUSES = [
  'pending',
  'uploading',
  'queued',
  'processing',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'expired',
];
export const ACTIVE_STATUSES: readonly JobStatus[] = [
  'pending',
  'uploading',
  'queued',
  'processing',
  'finalizing',
];

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['uploading', 'queued', 'failed', 'cancelled', 'expired'],
  uploading: ['queued', 'failed', 'cancelled', 'expired'],
  queued: ['processing', 'failed', 'cancelled', 'expired'],
  processing: ['queued', 'finalizing', 'completed', 'failed', 'cancelled'],
  finalizing: ['queued', 'completed', 'failed', 'cancelled'],
  completed: ['expired'],
  failed: ['expired'],
  cancelled: ['expired'],
  expired: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
  readonly from: JobStatus;
  readonly to: JobStatus;

  constructor(from: JobStatus, to: JobStatus) {
    super(`invalid job transition ${from} → ${to}`);
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export type JobTarget =
  | { kind: 'conversion'; routeId: string; from: string; to: string }
  | { kind: 'tool'; routeId: string; toolId: string; operation: string };

export interface JobInput {
  id: string;
  /** Sanitized original name, for display and output naming only. */
  name: string;
  /** Declared size; verified against storage before queueing. */
  size: number;
  /** Declared input format; verified by content detection before queueing. */
  format: string;
  storageKey: string;
  uploaded: boolean;
}

export interface JobOutput {
  id: string;
  name: string;
  size: number;
  format: string;
  mimeType: string;
  storageKey: string;
}

export interface JobError {
  code: ErrorCode;
  retryable: boolean;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  /** 0–100 */
  progress: number;
  target: JobTarget;
  engines: string[];
  pool: WorkerPool;
  options: OptionValues;
  inputs: JobInput[];
  outputs: JobOutput[];
  error: JobError | null;
  attempts: number;
  maxAttempts: number;
  priority: number;
  /** SHA-256 of the access token. */
  tokenHash: string;
  workerId: string | null;
  leaseExpiresAt: string | null;
  runAfter: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** When files (or, for terminal jobs, the record) are removed. */
  expiresAt: string;
  version: number;
}
