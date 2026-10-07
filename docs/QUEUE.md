# Queue and job lifecycle

Server conversions are **jobs** stored in PostgreSQL. The database is the queue: workers claim
jobs with `FOR UPDATE SKIP LOCKED`, hold them with renewable leases, and a sweeper recovers
anything a crashed worker leaves behind. No separate message broker is needed at the current
scale ([decisions/0003-postgres-queue.md](decisions/0003-postgres-queue.md)).

Code: `packages/core/src/jobs/model.ts` (states), `packages/jobs/src/service.ts` (all
transitions), `packages/jobs/src/postgres.ts` and `memory.ts` (stores),
`packages/jobs/migrations/` (schema), `packages/jobs/src/cli/migrate.ts`.

## States

```
pending ─▶ uploading ─▶ queued ─▶ processing ─▶ finalizing ─▶ completed ─▶ expired
   │           │           │        ▲    │            │
   │           │           │        └────┘ retry      │
   └───────────┴───────────┴─────────┴───────────────┴──▶ failed / cancelled ─▶ expired
```

| State | Meaning | Entered by |
| --- | --- | --- |
| `pending` | Created; upload requests issued | API `createJob` |
| `uploading` | Some inputs uploaded and verified | API `completeUpload` |
| `queued` | All inputs verified; waiting for a worker (`run_after` may delay it) | API `completeUpload`; retry; lease recovery |
| `processing` | A worker holds the lease and runs engines | worker `claim` |
| `finalizing` | Reserved for a separate output-finalization step; the current worker validates and stores outputs while `processing` and completes directly | — |
| `completed` | Outputs downloadable until `expires_at` | worker `complete` |
| `failed` | Terminal failure with an error code | API (upload mismatch), worker, lease recovery |
| `cancelled` | Cancelled by the user | API `cancelJob` |
| `expired` | Files deleted; only the record remains until removal | sweeper |

Every change goes through one method of the job service that checks the transition against
the model (`canTransition`; an invalid one throws `InvalidTransitionError`). Every update uses
**optimistic concurrency**: it applies only if the row's `version` is unchanged, otherwise the
operation re-reads and retries, so concurrent API calls, heartbeats and sweeps never overwrite
each other.

## Schema

`packages/jobs/migrations/001_init.sql`:

- `vc_jobs` — one row per job: status, progress, target, engines, pool, options, inputs and
  outputs (JSON metadata with storage keys), error, attempts / max_attempts (3), priority,
  `token_hash`, `worker_id`, `lease_expires_at`, `run_after`, timestamps, `expires_at`,
  `version`. File contents are never stored.
- Partial index `vc_jobs_queue_idx (pool, priority desc, run_after, created_at) where
  status = 'queued'` — the claim query.
- Partial index on `lease_expires_at` for `processing`/`finalizing` — lease recovery.
- Index on `expires_at` — retention.
- `vc_workers` — worker registry: pools, engines (with versions), version, last seen.
- `vc_rate_limits` — per-key counters per time window.

Migrations run with `pnpm db:migrate` (`DATABASE_URL` required). Each file runs once in its own
transaction, recorded in `vc_migrations`, under a PostgreSQL advisory lock so concurrent
deploys cannot apply the same migration twice.

## Claiming

```sql
with next as (
  select id from vc_jobs
  where status = 'queued' and pool = any($pools) and run_after <= now
    and engines <@ $installed_engines          -- only jobs this worker can run
  order by priority desc, run_after, created_at
  for update skip locked
  limit 1
)
update vc_jobs … set status = 'processing', worker_id = $worker, lease_expires_at = now + lease,
                     attempts = attempts + 1, version = version + 1
```

- **Pools** (`image`, `media`, `document`, `archive`, `data`, `specialized`) let operators scale
  and size workers per workload; a job's pool comes from its route.
- **Engine-aware**: a worker only claims jobs whose engines it has installed, so a partially
  equipped worker never takes work it would fail.
- `SKIP LOCKED` lets many workers poll concurrently without blocking each other.

## Leases, heartbeats and recovery

- A claim sets a lease of `WORKER_LEASE_SECONDS` (default 60 s). The worker renews it every
  third of that period; heartbeats also carry progress (0–99).
- A heartbeat that finds the job no longer belongs to the worker (cancelled, or the lease was
  taken over) makes the worker abort the engines immediately.
- The **sweeper** finds `processing`/`finalizing` jobs whose lease expired (worker crashed or was
  killed): they go back to `queued` if attempts remain, otherwise they fail with
  `conversion-timeout`.

## Retries

When processing fails with a **retryable** error (e.g. storage or infrastructure trouble, a
worker shutting down) and attempts remain, the job is requeued with exponential backoff:
`run_after = now + 30 s × 2^(attempt − 1)`. User errors (corrupt input, limits, unsupported
content) are not retried. A failed job's files are deleted immediately.

## Expiry and cleanup

`JobService.sweep()` runs on every worker every `WORKER_SWEEP_SECONDS` (default 60; 0 disables)
and is safe to run concurrently:

1. recover expired leases (above);
2. for jobs past `expires_at` that are not running: delete their files and mark them `expired`
   (unstarted jobs get the error `job-expired`), keeping the record for `jobRecordSeconds`;
3. remove `expired` records whose time is up;
4. purge rate-limit counters older than two hours.

`expires_at` by state: `pending` → creation + `abandonedUploadSeconds`; `queued` → a 24-hour
safety limit; `completed` → completion + `outputSeconds`; `failed`/`cancelled` → +
`failedSeconds`. Values: [LIMITS.md](LIMITS.md#retention).

## Worker registry

Each worker upserts its record every 30 seconds with its pools and probed engines. The API
treats workers seen in the last 120 seconds as live: `liveCapabilities()` powers
`GET /api/v1/health`, and job creation refuses jobs no live worker can run
(`VANILLATE_REQUIRE_WORKERS`, default on).

## In-memory store

`JOB_STORE=memory` keeps jobs in process memory with the same semantics. It works only when the
API and the worker share one process (local development with the embedded worker, tests); the
standalone worker refuses to start with it.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `DATABASE_SSL` | `false` | `true` to require TLS |
| `DATABASE_POOL_MAX` | `5` | Connections per process |
| `JOB_STORE` | — | `memory` for single-process development and tests |
| `VANILLATE_REQUIRE_WORKERS` | `true` | Refuse jobs without a capable live worker |

## Planned

- Per-client priorities and fair scheduling.
- A dead-letter view for operators (failed jobs are currently visible only in the table and
  logs).
