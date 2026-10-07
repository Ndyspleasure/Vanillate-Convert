# API

The web app exposes a small JSON API under `/api/v1` (`apps/web/src/app/api/v1/**/route.ts`).
It orchestrates server jobs and publishes the registry; it never runs conversions. File bytes
go directly between the browser and storage ([STORAGE.md](STORAGE.md)).

All responses are JSON with `Cache-Control: no-store` unless noted. Request bodies are
`application/json`, at most 64 KiB, validated with strict schemas (unknown fields are rejected).

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/jobs` | — (rate limited) | Create a server job; returns the job token and upload requests |
| `POST` | `/api/v1/jobs/{id}/inputs/{inputId}/complete` | job token | Confirm an upload; the server verifies it |
| `GET` | `/api/v1/jobs/{id}` | job token | Status, progress, outputs with signed download links |
| `POST` | `/api/v1/jobs/{id}/cancel` | job token | Cancel and delete the job's files |
| `PUT` | `/api/v1/storage/{token}` | signed token | Upload bytes (local storage driver only) |
| `GET` | `/api/v1/storage/{token}` | signed token | Download bytes (local storage driver only) |
| `GET` | `/api/v1/health` | — | Liveness and live server capacity |
| `GET` | `/api/v1/formats` | — | Formats of this deployment (static) |
| `GET` | `/api/v1/conversions` | — | Offered conversions of this deployment (static) |

The job token is sent as `Authorization: Bearer <token>`.

## Server conversion flow

```
POST /api/v1/jobs                       → { job, token, uploads[] }      (status: pending)
PUT  uploads[i].request.url  (bytes)    → 2xx                            (direct to storage)
POST /jobs/{id}/inputs/{inputId}/complete → { job }                      (uploading → queued)
GET  /jobs/{id}   (poll, backoff)       → { job }  queued → processing → finalizing → completed
GET  job.outputs[i].download.url        → file (attachment)
POST /jobs/{id}/cancel   (optional)     → { job }                        (cancelled, files deleted)
```

The browser client implementing this flow is `apps/web/src/components/converter/run-server.ts`
(polls from 800 ms, backing off ×1.3 up to 3 s; cancels the job when the user aborts).

### `POST /api/v1/jobs`

```json
{
  "target": { "kind": "conversion", "from": "pdf", "to": "png" },
  "options": { "dpi": 150 },
  "files": [{ "name": "report.pdf", "size": 48213, "format": "pdf" }]
}
```

- `target` is `{ kind: "conversion", from, to }` or `{ kind: "tool", toolId }`.
- `options` maps option ids to string/number/boolean values; they are validated against the
  route's option definitions (unknown options and out-of-range values → `invalid-options` with
  per-field codes in `error.fields`).
- `files` (1–100 entries): the client's **detected** format, the exact byte size and the name
  (sanitized before storage). Conversions that are not `n:1` accept one file per job.

Checks, in order: server processing configured → target offered → file count → each format
accepted by the route → size limits for the route's mode and category ([LIMITS.md](LIMITS.md))
→ options → a live worker with the route's pool and engines → rate limit.

`201 Created`:

```json
{
  "job": {
    "id": "job_k3v…",
    "status": "pending",
    "progress": 0,
    "target": { "kind": "conversion", "from": "pdf", "to": "png" },
    "inputs": [{ "id": "in_q7…", "name": "report.pdf", "size": 48213, "format": "pdf", "uploaded": false }],
    "outputs": [],
    "error": null,
    "createdAt": "2026-10-06T08:00:00.000Z",
    "updatedAt": "2026-10-06T08:00:00.000Z",
    "completedAt": null,
    "expiresAt": "2026-10-06T09:00:00.000Z"
  },
  "token": "<43 characters, shown once>",
  "uploads": [
    {
      "inputId": "in_q7…",
      "request": { "method": "PUT", "url": "…", "headers": { "content-type": "application/pdf" } }
    }
  ]
}
```

The token is 256 random bits; only its SHA-256 hash is stored, so it cannot be recovered.
Upload requests are bound to the storage key, the exact size and the content type, and expire
after `retention.signedUrlSeconds` (15 minutes). The upload must send exactly the given headers.

### `POST /api/v1/jobs/{id}/inputs/{inputId}/complete`

No body. Verifies the stored object's size and detects its format from its bytes. On success
returns `{ job }` (`uploading`, or `queued` when all inputs are verified). If the content does
not match the declared format, the input is deleted, the job fails and the response is
`415 format-mismatch`. Calling it again after the job moved on returns the current job.

### `GET /api/v1/jobs/{id}`

Returns `{ job }`. While the job is `completed` and unexpired, each output has
`download: { url, expiresAt }`; otherwise `download` is `null`. `progress` is 0–100. A failed
job carries `error: { code, message, retryable }`.

### `POST /api/v1/jobs/{id}/cancel`

Cancels a non-terminal job and deletes its files; returns `{ job }` with status `cancelled`.
Cancelling a finished job returns it unchanged. A worker processing the job stops at its next
heartbeat.

### Storage routes (local driver)

`PUT /api/v1/storage/{token}` accepts exactly the signed size and content type (`204` on
success); `GET` streams the object as an attachment with `nosniff` and a `sandbox` CSP. Tokens
are HMAC-signed, scoped to one key and method, and expire. With S3 storage these routes return
`404 not-found`; clients use presigned URLs instead.

### Registry and health

- `GET /api/v1/formats` → `{ formats: [{ id, label, name: {id, en}, category, extensions,
  mimeTypes, readable, writable, support: { browser, server } }] }`
- `GET /api/v1/conversions` → `{ conversions: [{ from, to, status, modes, indexable,
  limitations }] }` — offered conversions only.
- `GET /api/v1/health` → `{ status: "ok", serverProcessing: null | { workers, pools, engines } }`
  where the capacity lists pools and engines of workers seen in the last 120 seconds.

The registry endpoints are generated at build time and reflect the deployment (a browser-only
deployment lists only browser conversions).

## Errors

```json
{ "error": { "code": "file-too-large", "message": "…", "retryable": false } }
```

`message` is localized: `?locale=id|en`, else `Accept-Language`, else English. `fields` is
present for `invalid-options`. Internal details (engine output, stack traces) are logged and
never returned.

| Code | HTTP | Kind | Meaning |
| --- | --- | --- | --- |
| `file-empty` | 422 | user | The file is empty |
| `file-too-large` | 413 | user | A file exceeds the size limit |
| `total-too-large` | 413 | user | All files together exceed the limit |
| `too-many-files` | 422 | user | Too many files for one job |
| `format-unknown` | 415 | user | The format could not be recognized |
| `format-mismatch` | 415 | user | Content does not match the declared/expected format |
| `conversion-unsupported` | 422 | user | The conversion or tool is not offered |
| `invalid-options` | 422 | user | Options are invalid (`fields` lists them) |
| `input-corrupt` | 422 | user | The file is damaged or unreadable |
| `password-protected` | 422 | user | The file is encrypted |
| `image-too-large` | 422 | user | Pixel limit exceeded |
| `media-too-long` | 422 | user | Duration limit exceeded |
| `too-many-pages` | 422 | user | Page limit exceeded |
| `no-subtitle-track` / `no-audio-track` | 422 | user | The media has no such track |
| `font-flavor-mismatch` | 422 | user | Font outline type does not fit the target |
| `archive-unsafe` | 422 | user | Archive contains links, special files or unsafe paths |
| `archive-too-large` | 422 | user | Archive exceeds entry, size or ratio limits |
| `page-range-invalid` | 422 | user | Invalid page selection |
| `browser-unsupported` | 422 | user | The browser lacks a needed capability |
| `rate-limited` | 429 | user | Too many jobs; `Retry-After: 60` |
| `job-not-found` | 404 | user | Unknown or malformed job id |
| `job-expired` | 410 | user | Files were deleted by retention |
| `job-not-ready` / `job-cancelled` / `upload-incomplete` | 409 | user | State conflicts; upload shorter than signed |
| `unauthorized` | 403 | user | Missing or wrong job token / storage token |
| `bad-request` | 400 | developer | Malformed request (schema, JSON, size mismatch) |
| `not-found` / `method-not-allowed` | 404 / 405 | developer | Unknown route or wrong method for a token |
| `conversion-failed` / `conversion-timeout` / `output-invalid` / `output-too-large` | 422 | engine | The engine failed, timed out or produced unusable output |
| `server-processing-disabled` | 503 | infrastructure | This deployment has no server processing |
| `server-unavailable` / `storage-error` | 503 | infrastructure | No capable worker, or storage failure |
| `internal-error` | 500 | system | Unexpected error |

The authoritative list, retryability and both languages' messages are in
`packages/core/src/errors/codes.ts`.

## Rate limiting

`POST /api/v1/jobs` is limited per client to `rateLimits.jobsPerMinute` (10) and
`rateLimits.jobsPerHour` (100) from `catalog/limits.json`. The client key is a salted hash of
the first `X-Forwarded-For` address (set by Vercel; self-hosted deployments must run behind a
proxy that sets it). Counters live in the job store.

## Availability

- Without `VANILLATE_SERVER_PROCESSING=enabled` and a configured store and storage, job
  endpoints return `503 server-processing-disabled`.
- With `VANILLATE_REQUIRE_WORKERS` (default on), job creation returns
  `503 server-unavailable` when no live worker has the route's pool and engines, so jobs are
  never queued for work nobody can do.
