# Architecture

Vanillate Convert is a **registry-driven** conversion platform. Formats, engines, conversion
rules, tools, options, limits and limitations are data (`catalog/`); code turns that data into
pages, routes, API validation and worker jobs. Adding a conversion that an existing engine can
perform is a catalog change, not a code change.

```
User
 │
 ▼
Web application (Next.js on Vercel) ── pages, SEO, registry, job API
 │
 ├─ Format detection (bytes, not extensions)            packages/core/src/detection
 ├─ Conversion validation (registry, limits, options)   packages/core
 ▼
Processing router (selectRoute)                          packages/core/src/routing
 ├── Browser ── Web Worker + browser engines             packages/browser-engines
 └── Server
       │  signed upload → storage                        packages/storage
       ▼
     Queue (PostgreSQL, SKIP LOCKED leases)              packages/jobs
       ▼
     Worker (pools, sandboxed engines)                   workers/runtime, packages/engines
       ▼
     Output validation (content detection, size, pixels)
       ▼
     Storage (temporary, signed downloads)
       ▼
     Download → automatic cleanup
```

## Repository layout

| Path | Package | Responsibility |
| --- | --- | --- |
| `catalog/` | `@vanillate/catalog` | Source-of-truth JSON: formats, engines, conversion rules, tools, options, limitations, limits, categories, popular lists; JSON Schemas for editors |
| `packages/core/` | `@vanillate/core` | Isomorphic domain core: catalog schema and validation, registry compiler, detection, routing and slugs, options validation, limits, typed errors, job model, logger, utilities |
| `packages/browser-engines/` | `@vanillate/browser-engines` | Engines that run in the browser (images via canvas, data formats, subtitles, archives, text tools, PDF/ICO writers) |
| `packages/engines/` | `@vanillate/engines` | Server engine adapters and the sandboxed `ProcessRunner`; content detection of files on disk |
| `packages/storage/` | `@vanillate/storage` | Storage interface with local, S3-compatible and memory drivers; signed requests |
| `packages/jobs/` | `@vanillate/jobs` | Job store (PostgreSQL, memory), job service (creation, upload verification, leases, retries, retention, rate limits), SQL migrations |
| `workers/runtime/` | `@vanillate/worker` | The processing worker: claims jobs, runs engines, validates and stores outputs, sweeps expired data |
| `apps/web/` | `@vanillate/web` | Next.js app: localized pages generated from the registry, the converter widget, the `/api/v1` job API |
| `scripts/` | — | Catalog checks, schema and matrix generation, database migrations |
| `docs/` | — | This documentation |

TypeScript everywhere (strict, ESM, erasable syntax only). Node.js ≥ 22 runs the TypeScript
sources directly for scripts and the worker; Next.js compiles the workspace packages for the
web app.

## The registry

`catalog/` is validated with zod schemas and compiled once per process into a `Registry`
(`packages/core/src/registry/`). Compilation expands rules into concrete routes
(`from → to` via one or more engine steps), applies engine capabilities and statuses, derives
quality notes and limitations, and decides for each conversion whether it is **offered** and
**indexable**. Deployment options produce different registries from the same data — a
browser-only deployment compiles with `disabledModes: ['server']` and simply offers fewer
conversions. Details: [FORMAT-REGISTRY.md](FORMAT-REGISTRY.md); the generated list of every
offered conversion: [CONVERSION-MATRIX.md](CONVERSION-MATRIX.md).

The same registry drives:

- page generation and the sitemap ([SEO.md](SEO.md));
- the converter widget (targets, options, limits, warnings);
- API validation of jobs ([API.md](API.md));
- the worker's choice of engines and output checks ([WORKER.md](WORKER.md)).

## Processing modes

**Browser first.** `selectRoute` prefers a browser route when one exists, the files are within
browser limits and the browser supports the APIs the engine needs (probed at runtime, e.g. which
image formats canvas can decode and encode). This keeps files on the user's device and costs no
server resources. Browser engines run in a module Web Worker
(`apps/web/src/components/converter/engine.worker.ts`), so the page stays responsive and large
files never block the UI thread.

**Server when needed** — office documents, PDF rendering, audio/video, archives, specialized
formats, or files too large for the browser. Server processing is optional: without it the site
is browser-only and never offers or indexes server conversions.

## Server processing

1. **Create** — the browser posts the target and file metadata to `POST /api/v1/jobs`. The API
   validates format, limits, options and rate limits, checks that a live worker can run the
   job, and returns a job token and one signed upload request per file.
2. **Upload** — the browser uploads directly to storage (presigned S3 URL, or the HMAC-signed
   local storage route). Vercel functions never carry file bytes when S3 is used.
3. **Verify** — `POST …/inputs/{id}/complete` checks the stored size and detects the format from
   the stored bytes. When every input is verified the job is `queued`.
4. **Process** — a worker of the right pool, with the needed engines, claims the job with a
   lease, re-checks the inputs, runs the engines in a sandbox under a whole-job deadline,
   validates and names the outputs, uploads them and completes the job.
5. **Download** — the browser polls `GET /api/v1/jobs/{id}` and receives short-lived signed
   download links.
6. **Cleanup** — inputs are deleted on completion, outputs after the retention period;
   sweepers recover lost leases and delete expired data ([PRIVACY.md](PRIVACY.md)).

Queue and job lifecycle: [QUEUE.md](QUEUE.md). Storage: [STORAGE.md](STORAGE.md). Worker:
[WORKER.md](WORKER.md). Isolation: [SECURITY.md](SECURITY.md).

## Deployment

| Component | Where | Notes |
| --- | --- | --- |
| Web app | Vercel (or any Node host) | Static pages per locale and conversion; API routes for job orchestration only |
| PostgreSQL | Managed Postgres | Job queue, worker registry, rate limits (`pnpm db:migrate`) |
| Storage | S3-compatible (R2, S3, MinIO) | Private bucket, CORS for the site origin, lifecycle backstop |
| Workers | Containers/VMs near storage | One image with all engines; scale by pool (`WORKER_POOLS`); bubblewrap + engine user isolation |

The web tier never runs engines in production. For local development and end-to-end tests,
`VANILLATE_EMBEDDED_WORKER=1` runs a worker inside the Next.js server (compiled in only when set
at build time). All configuration is environment-based; see `.env.example`.

## Cross-cutting concerns

- **Errors** — one typed catalog of error codes with kinds (user, developer, engine,
  infrastructure, system), HTTP statuses and localized messages
  (`packages/core/src/errors/codes.ts`). Users see actionable messages; details go to logs.
- **Internationalization** — Indonesian and English. UI text lives in
  `apps/web/src/i18n/messages/{id,en}.json` (a test enforces identical keys and placeholders);
  catalog names, descriptions, options and limitations carry both languages. URLs are
  localized (`/en/convert/jpg-to-png`, `/id/convert/jpg-ke-png`).
- **Logging** — structured JSON logs with event names and job IDs, no file contents.
- **Statuses** — `stable`, `supported`, `limited`, `experimental`, `deprecated`, `unsupported`.
  The UI labels non-stable conversions; experimental ones are not indexed.

## Decision records

Significant decisions and their trade-offs are recorded in [decisions/](decisions/).
