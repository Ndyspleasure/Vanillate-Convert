# Testing

A conversion is not done until it is validated. The test suite runs real engines inside the real
sandbox, a real PostgreSQL, and a real browser against a production build.

```
pnpm test            # unit, integration and conversion tests (Vitest)
pnpm test:e2e        # end-to-end tests (Playwright, production build)
pnpm validate        # format:check, lint, typecheck, catalog:check, test, build
```

## Layers

| Layer | Where | What |
| --- | --- | --- |
| Unit | `packages/core/src/**/*.test.ts` | Catalog validation, registry compilation (statuses, offered/indexable, deployment views), detection, routing and slugs, options, errors, job state machine, utilities |
| Unit | `packages/browser-engines/test/` | Data, subtitle, archive, text engines and encoders (TIFF, ICO, PDF) |
| Unit | `apps/web/src/**/*.test.ts` | i18n dictionary parity, locale negotiation, `localizePath`, proxy redirects and matcher, SEO metadata, JSON-LD escaping |
| Integration | `packages/jobs/test/` | Job service and both stores (memory and PostgreSQL): creation checks, upload verification, claims, leases, retries, cancellation, sweeps, rate limits |
| Integration | `packages/storage/test/` | Local and memory drivers, signed tokens, S3 presigning |
| Integration | `workers/runtime/test/` | The worker end to end with real engines: claims, processing, output validation, naming, cancellation, shutdown requeue, engine-user isolation |
| Integration | `apps/web/src/app/api/v1/api.test.ts` | Route handlers called directly: the full create → upload → confirm → status → cancel flow, token checks, request validation, error shapes |
| Conversion | `packages/engines/test/engines.integration.test.ts` | Every server engine converting generated fixtures inside the sandbox, with outputs checked by content |
| Engine runner | `packages/engines/test/runner.test.ts`, `parsers.test.ts` | Timeouts, cancellation, output caps, file-size and memory limits, sandbox (no network, no host files), engine output parsers, the ImageMagick policy |
| End-to-end | `apps/web/e2e/` | Browser conversions (CSV → JSON, PNG → JPG, JSON formatter, home-page detection), a server conversion through the embedded worker (PDF → PNG), API access control, locale routing, canonical/hreflang/JSON-LD, redirects and 404s, noindex for experimental pages, sitemap, search, accessibility (axe) |

About 280 Vitest cases in 24 files (counted with `grep -cE "^\s*(it|test)…\("`; `it.each`
expands to more at runtime — the last full run executed 340 tests) and 19 Playwright tests.

### Security tests

Security behaviour is tested, not assumed:

- archive bombs (size, entry count, ratio), path traversal, links and encrypted entries
  (7-Zip and browser archive engines);
- ImageMagick policy (blocked coders and delegates), LibreOffice forced filters and CSV
  formula injection, Pandoc sandbox requirement;
- sandbox: no network interfaces, no access to host files outside the job;
- runner limits: timeouts, cancellation, file size, memory;
- content mismatches at upload completion and in the worker (`format-mismatch`);
- job tokens (missing, wrong), malformed IDs, tampered and wrong-method storage tokens,
  oversized and short uploads, unknown request fields, oversized bodies;
- JSON-LD escaping; error responses without internal details;
- platform errors recognized across duplicated module copies (a regression found in e2e).

## PostgreSQL

`test/global-setup.ts` provides a database to tests via `inject('databaseUrl')`:

1. `TEST_DATABASE_URL` when set (CI uses a service container);
2. otherwise a throwaway cluster started with the local `initdb`/`pg_ctl`, removed afterwards;
3. otherwise `null`, and PostgreSQL tests are skipped.

`VANILLATE_TEST_POSTGRES=0` skips starting a local cluster.

## Engines

Conversion tests skip engines that are not installed (`describe.skipIf(!has('…'))`), so the
suite runs anywhere; CI installs all of them. The tests use the bubblewrap sandbox when it
works (`VANILLATE_SANDBOX`, default `auto`) and the worker's default memory limit.

Binaries used: `magick`/`convert`, `ffmpeg`, `ffprobe`, `soffice`, `pdftoppm`, `pdftocairo`,
`pdfinfo`, `gs`, `qpdf`, `pandoc`, `7zz`/`7z`, `rsvg-convert`, `assimp`, `exiftool`,
`python3` with `fontTools` and `brotli`, plus `bwrap` and `prlimit`. On Debian/Ubuntu:

```
apt-get install imagemagick ffmpeg libreoffice-writer libreoffice-calc libreoffice-impress \
  libreoffice-draw poppler-utils ghostscript qpdf pandoc 7zip librsvg2-bin assimp-utils \
  libimage-exiftool-perl python3-fonttools python3-brotli bubblewrap util-linux
```

## End-to-end

`apps/web/playwright.config.ts` builds and starts the app (`next build && next start`, port
`E2E_PORT`, default 3210) with server processing enabled, an in-memory job store, local storage
in a temporary directory and the embedded worker. Server tests are skipped when the worker has
no Poppler. Chromium comes from `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, a preinstalled
`/opt/pw-browsers/chromium`, or `npx playwright install chromium`.

## Conventions

- **No binary fixtures.** Inputs are generated in code (`packages/engines/test/helpers.ts`,
  `apps/web/e2e/fixtures.ts`), or produced by one engine and consumed by another.
- Outputs are checked by **content** (detection, magic bytes, dimensions, parsed data), not
  just by "the command succeeded".
- Each bug fix gets a regression test.
- A new format needs a detection test; a new server conversion needs a conversion test; a new
  tool needs an engine test and, for user-visible flows, an e2e test.

## Definition of done

Implement → build → lint → test → validate → review → document. `pnpm validate` must pass,
and engine or UI changes must also pass the relevant conversion and e2e tests. CI runs all of
these on every push and pull request (`.github/workflows/ci.yml`).
