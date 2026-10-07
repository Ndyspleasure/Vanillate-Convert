# Worker

The worker (`workers/runtime`, package `@vanillate/worker`) runs server conversions. It claims
jobs from the queue ([QUEUE.md](QUEUE.md)), runs engines in a sandbox
([SECURITY.md](SECURITY.md)), validates and stores outputs ([STORAGE.md](STORAGE.md)), and
sweeps expired data. Workers are stateless; run as many as needed, per pool.

```
pnpm worker          # node workers/runtime/src/main.ts
```

## Startup (`src/main.ts`)

1. Read configuration from the environment (`src/config.ts`, table below).
2. Require a shared PostgreSQL job store (`DATABASE_URL`) and shared storage (S3, or local
   storage on a volume shared with the web app).
3. Create the `ProcessRunner` with the sandbox mode, engine user and memory limit. In production
   (`NODE_ENV=production`) the worker **refuses to start** if engines would run without
   isolation (neither bubblewrap nor a separate engine user), unless
   `VANILLATE_ALLOW_UNISOLATED=1`.
4. **Probe engines**: each server engine of the catalog that is not disabled checks for its
   binaries and version (`probeEngines`). Only available engines are used and advertised; the
   worker exits if none is installed.
5. Register in `vc_workers`, start claiming, start the sweeper, and handle `SIGTERM`/`SIGINT`.

## The loop (`src/worker.ts`)

- Claims jobs for its pools whose engines are all installed here, up to `WORKER_CONCURRENCY` at
  once. When idle it polls every `WORKER_POLL_MS`, backing off up to five times that.
- Each running job has a heartbeat every `lease / 3` that renews the lease and reports progress.
  If the job was cancelled or the lease lost, the engines are aborted at once.
- Re-registers every 30 s and runs the sweeper every `WORKER_SWEEP_SECONDS`.
- **Shutdown**: stops claiming, lets running jobs finish for `WORKER_SHUTDOWN_GRACE_MS`, then
  aborts them and requeues them (`server-unavailable`, retryable) for another worker.

## Processing a job (`src/process.ts`)

```
resolve route ─▶ prepare job directory ─▶ download inputs (exact size) ─▶ re-detect formats
─▶ run engines (deadline) ─▶ validate + name outputs ─▶ upload ─▶ complete ─▶ remove directory
```

1. **Resolve** the job's conversion route or tool route from the registry. A route that is no
   longer offered fails with `conversion-unsupported`.
2. **Job directory** `<WORKER_WORK_DIR>/<jobId>-<attempt>/` with `in/`, `out/`, `tmp/`, `home/`,
   all `0700`. With an engine user, the writable parts are owned by that user and inputs are
   readable to it. Engines get unique scratch directories per run, so batches never mix files.
3. **Download** each input, streaming, refusing anything but the exact declared size.
4. **Re-detect** every input by content; it must belong to the declared format family (tools
   accepting any file skip this). Nothing that crossed the storage boundary is trusted.
5. **Run** the pipeline (`packages/engines/src/pipeline.ts`): multi-step routes chain engines;
   `1:1` conversions run once per file, `n:1` routes (e.g. images → PDF, merge) once for all.
   The whole job has a deadline of the category's `maxJobSeconds` + 120 s (downloads and
   uploads included); each engine process also gets CPU, memory, file-size and open-file
   limits.
6. **Validate outputs** (`src/outputs.ts`): every output must exist, be non-empty, be detected
   by content as the expected format, respect `maxOutputBytes` and the pixel limit. Names are
   derived from the sanitized input name (`report.pdf` → `report-page-1.png`), with labels for
   multi-output engines and archive entry paths kept safe.
7. **Upload** outputs to storage under generated keys, then **complete** the job (which deletes
   the inputs). If the job was cancelled meanwhile, the outputs are deleted instead.
8. The job directory is always removed.

Failures are typed errors ([API.md](API.md#errors)). Retryable failures are requeued with
backoff; others fail the job and delete its files. Unexpected (`system`) errors are logged with
stack traces.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKER_ID` | hostname + random suffix | Unique worker id |
| `WORKER_POOLS` | `all` | Comma-separated pools: `image`, `media`, `document`, `archive`, `data`, `specialized` |
| `WORKER_CONCURRENCY` | `2` | Jobs processed at once (1–64) |
| `WORKER_WORK_DIR` | `<tmp>/vanillate-work` | Job directories (fast local disk) |
| `WORKER_LEASE_SECONDS` | `60` | Lease length, renewed by heartbeats |
| `WORKER_POLL_MS` | `1000` | Idle polling interval |
| `WORKER_SWEEP_SECONDS` | `60` | Sweep interval; `0` disables |
| `WORKER_SHUTDOWN_GRACE_MS` | `25000` | Time running jobs get on shutdown |
| `VANILLATE_SANDBOX` | `auto` | `auto`, `bwrap` (required) or `none` |
| `VANILLATE_ENGINE_USER` | `auto` | `auto` (nobody when running as root), `none`, or `<uid>:<gid>` |
| `VANILLATE_ENGINE_MEMORY_MB` | `4096` | Address-space limit per engine process; `0` disables |
| `VANILLATE_DISABLED_ENGINES` | — | Engine ids this worker must not use |
| `VANILLATE_ALLOW_UNISOLATED` | — | `1` allows production without isolation (unsafe) |
| `VANILLATE_PYTHON` | probed | Python with fontTools for the font engine |
| `VANILLATE_VERSION` | — | Reported in the worker registry |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Plus the job store (`DATABASE_URL`, …) and storage (`STORAGE_*`, `S3_*`) variables.

## Deployment

- One container image contains every engine (`workers/Dockerfile`); pools decide what each
  deployment claims, e.g. a `media` deployment with more CPU and memory, a `document`
  deployment with more instances.
- Give each container memory and CPU limits in addition to the per-process limits, and a work
  directory on fast local disk sized for `concurrency × (inputs + outputs)`.
- Run as root with `VANILLATE_ENGINE_USER=auto` and bubblewrap enabled for two layers of
  isolation. Keep the worker's network limited to the database and storage.
- Scale on queue depth (`select pool, count(*) from vc_jobs where status = 'queued' group by
  pool`).

## Embedded worker (development and tests)

With `VANILLATE_EMBEDDED_WORKER=1` set at build and run time, the Next.js server starts a worker
in its own process (`apps/web/src/instrumentation.ts`, `src/server/embedded-worker.ts`),
sharing the in-memory job store and local storage. It is compiled into the build only when the
variable is set (`apps/web/next.config.ts`), so production builds do not contain engine code.

## Log events

Structured JSON lines (`service: "worker"`), including: `worker.engines` (probe results),
`worker.unisolated`, `worker.draining`, `job.started`, `job.completed`, `job.retry`,
`job.failed`, `job.error`, `job.stopped`, `job.discarded`, `job.heartbeat_failed`,
`sweep.done`, `sweep.failed`, `storage.cleanup_failed`, `workdir.cleanup_failed`.
