# Privacy

Principles: **private by default, temporary processing, automatic cleanup, protected
downloads, minimal retention.** This document states what the implementation actually does.
The public privacy page (`apps/web/src/app/[locale]/privacy/page.tsx`) is generated from the
same retention values, so it cannot drift from the code. Any change to data handling must update
this document and the page texts (`apps/web/src/i18n/messages/*.json`) in the same change.

## Where files are processed

| Mode | What happens to the file |
| --- | --- |
| **Browser** | Read by the page, converted in memory inside a Web Worker, returned as a `blob:` URL. **Nothing is uploaded.** The router prefers the browser whenever a browser route exists, the file is within browser limits and the browser supports the needed APIs. |
| **Server** | Uploaded straight to storage with a signed, single-purpose request (the web server does not see the bytes when S3-compatible storage is used), checked, converted by isolated engine processes ([SECURITY.md](SECURITY.md)), and kept only until the retention times below. |

Every conversion page shows which mode it uses ("Runs in your browser" / "Runs on our
servers"). A browser-only deployment (`VANILLATE_SERVER_PROCESSING` not `enabled`) never
uploads files at all.

## Retention

Values come from `catalog/limits.json` → `retention`, enforced by the job service and the
worker sweeper (`packages/jobs/src/service.ts`).

| Data | Deleted |
| --- | --- |
| Input files of a completed job | Immediately when the job completes |
| Input and output files of a failed or cancelled job | Immediately when it fails or is cancelled (the sweeper retries if storage was unavailable) |
| Outputs of a completed job | `outputSeconds` = **60 minutes** after completion |
| Uploads of a job that never starts | `abandonedUploadSeconds` = **60 minutes** after creation |
| Job record of a failed/cancelled job before it is marked expired | `failedSeconds` = 10 minutes |
| Job record after expiry (metadata only) | `jobRecordSeconds` = **24 hours** later, then removed |
| Rate-limit counters | Purged after 2 hours |

The sweeper runs on every worker (`WORKER_SWEEP_SECONDS`, default every 60 s). Because cleanup
depends on workers running, operators must also configure a **storage lifecycle rule** (e.g.
delete objects under `jobs/` older than 1 day) as a backstop — see [STORAGE.md](STORAGE.md).

## What is stored

**Job records** (PostgreSQL table `vc_jobs`): job ID, status, progress, target conversion or
tool, options, input/output metadata (sanitized file name, size, format, storage key), error
code, timestamps, attempts, the worker ID, and a **SHA-256 hash** of the job token. Never file
contents, never IP addresses, never the token itself.

**Worker registry** (`vc_workers`): worker IDs, pools, engine versions, last-seen time.

**Rate limits** (`vc_rate_limits`): a salted SHA-256 of the client IP truncated to 128 bits
(`RATE_LIMIT_SALT`), a time window and a counter. The IP itself is not stored.

## Access

- No accounts and no personal profile.
- A job is reachable only with its token, which only the uploading browser receives (held in
  memory by the page; not stored in cookies or local storage).
- Download links are signed and expire after 15 minutes (`signedUrlSeconds`), and are issued
  only while the job's outputs exist.

## Logs

Structured JSON logs (`packages/core` logger) contain event names, job IDs, routes, formats,
counts, byte sizes, error codes, and internal error details for debugging (which can include
engine messages). The job service does not log file names or contents. Request logs of the
hosting platform (e.g. Vercel) are outside this application and follow that platform's policy.

## Cookies and tracking

- One cookie, `vc-locale`, stores the chosen language for one year (set only when the visitor
  switches language). It is used for redirects to the visitor's language.
- No analytics, advertising or tracking scripts are included.

## Metadata

Conversions declare a metadata policy (`preserve`, `strip`, `transform`, `unsupported`) in the
catalog, shown in the conversion's quality notes. The metadata tools (e.g. viewing or removing
EXIF data) are explicit user actions; see [FORMAT-REGISTRY.md](FORMAT-REGISTRY.md).

## Claims we do not make

- We do not claim end-to-end encryption: server conversions need the file in clear text on the
  worker.
- Engine network isolation is guaranteed only when the bubblewrap sandbox is enabled; the public
  text therefore says "isolated" rather than "without network access".
