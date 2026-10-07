# Vanillate Convert

A scalable, secure file conversion and processing platform by Vanillate Studio. Formats,
engines and conversions are defined as data; one registry drives the website, the API and the
processing workers.

- **182 formats, 1554 conversions, 24 tools** — the full list is
  [docs/CONVERSION-MATRIX.md](docs/CONVERSION-MATRIX.md).
- **Browser first**: about 200 conversions run entirely in the visitor's browser; files never
  leave the device.
- **Server workers** for office documents, PDF, audio/video, archives and specialized formats —
  each engine sandboxed, every file deleted automatically.
- **Bilingual**: Bahasa Indonesia and English, with localized URLs
  (`/id/convert/jpg-ke-png`, `/en/convert/jpg-to-png`).
- Honest statuses: stable, supported, limited, experimental — experimental conversions are
  labeled and never presented as stable.

> 🇮🇩 **Ringkasan.** Vanillate Convert adalah platform konversi dan pemrosesan file. Format,
> engine, dan konversi didefinisikan sebagai data (registry) yang menggerakkan website, API, dan
> worker. Konversi ringan berjalan langsung di browser (file tidak diunggah); konversi berat
> diproses oleh worker yang terisolasi, dan semua file dihapus otomatis. Dokumentasi teknis ada
> di folder [`docs/`](docs/).

## Architecture in one picture

```
Browser ──▶ Next.js (Vercel): pages from the registry, /api/v1 job API
   │             │ create job, signed upload URLs, status
   │             ▼
   │        PostgreSQL (queue)  ◀──── Workers (pools, sandboxed engines)
   │                                      │
   └──── direct upload/download ────▶ Object storage (temporary)
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Repository

| Path | |
| --- | --- |
| `catalog/` | Source-of-truth data: formats, engines, conversion rules, tools, options, limits |
| `packages/core` | Registry compiler, detection, routing, options, errors, job model |
| `packages/browser-engines` | Engines that run in the browser |
| `packages/engines` | Server engine adapters and the sandboxed process runner |
| `packages/storage` | Local, S3-compatible and memory storage with signed requests |
| `packages/jobs` | PostgreSQL job queue and job service |
| `workers/runtime` | The processing worker (and `workers/Dockerfile`) |
| `apps/web` | Next.js website and API |
| `docs/` | Documentation and [decision records](docs/decisions/) |

## Getting started

Requirements: Node.js ≥ 22.18 (runs TypeScript directly), pnpm 10. Optional for server processing: PostgreSQL and the
engines (or Docker).

```bash
pnpm install
pnpm dev                       # http://localhost:3000 — browser conversions work immediately
```

**With server processing, locally in one process** (in-memory queue, local storage, embedded
worker; needs the engines installed):

```bash
cp .env.example apps/web/.env.local
# in apps/web/.env.local set:
#   VANILLATE_SERVER_PROCESSING=enabled  JOB_STORE=memory  VANILLATE_EMBEDDED_WORKER=1
#   STORAGE_DRIVER=local  STORAGE_LOCAL_DIR=/tmp/vanillate  STORAGE_SIGNING_SECRET=<32+ chars>
pnpm dev
```

**Full stack with Docker** (PostgreSQL, web app, worker with every engine):

```bash
docker compose up --build      # http://localhost:3000
```

## Commands

| Command | |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Web app |
| `pnpm worker` | Run a worker (needs `DATABASE_URL` and storage) |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm test` | Unit, integration and conversion tests |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Code quality |
| `pnpm catalog:check` | Validate the catalog and generated files |
| `pnpm docs:matrix` | Regenerate the conversion matrix |
| `pnpm validate` | Everything CI checks |

## Deployment

- **Web app** on Vercel (root directory `apps/web`), served at https://convert.vanillate.id;
  `*.vercel.app` hosts redirect there in production. Set `NEXT_PUBLIC_SITE_URL`; for server
  processing also `VANILLATE_SERVER_PROCESSING=enabled`, `DATABASE_URL`, `STORAGE_DRIVER=s3`
  and the `S3_*` variables, and `RATE_LIMIT_SALT`.
- **Workers** from `workers/Dockerfile` on any container platform, close to the database and
  storage. See [docs/WORKER.md](docs/WORKER.md) and [docs/SECURITY.md](docs/SECURITY.md).
- All variables are documented in [.env.example](.env.example).

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Format registry](docs/FORMAT-REGISTRY.md) ·
[Conversion matrix](docs/CONVERSION-MATRIX.md) · [Engines & licensing](docs/ENGINE-MAPPING.md) ·
[API](docs/API.md) · [Storage](docs/STORAGE.md) · [Worker](docs/WORKER.md) ·
[Queue](docs/QUEUE.md) · [Security](docs/SECURITY.md) · [Privacy](docs/PRIVACY.md) ·
[SEO](docs/SEO.md) · [Limits](docs/LIMITS.md) · [Testing](docs/TESTING.md) ·
[Project](PROJECT.md) · [Roadmap](ROADMAP.md)

## License

Proprietary — © Vanillate Studio. Conversion engines keep their own licenses; see
[docs/ENGINE-MAPPING.md](docs/ENGINE-MAPPING.md#licensing).
