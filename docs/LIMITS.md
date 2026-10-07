# Limits

Every limit is data in `catalog/limits.json`, compiled into the registry and enforced in
several layers, so a file that slips past one check is stopped by the next. Error codes are
listed in [API.md](API.md#errors).

## File limits per processing mode

Defaults, then per-category overrides (`registry.limitsFor(mode, category)`).

| | Browser | Server |
| --- | --- | --- |
| Largest file (`maxInputBytes`) | 200 MiB | 100 MiB |
| All files of a job (`maxTotalInputBytes`) | 1 GiB | 500 MiB |
| All outputs (`maxOutputBytes`) | 1 GiB | 1 GiB |
| Files per job (`maxFilesPerJob`) | 100 | 50 |
| Processing time (`maxJobSeconds`) | 300 s | 300 s |

| Category | Overrides |
| --- | --- |
| image | browser: 100 MiB per file |
| pdf | server: 200 MiB per file |
| audio | server: 500 MiB per file, 900 s |
| video | server: 2 GiB per file, 4 GiB per job, 4 GiB outputs, 1800 s |
| archive | browser: 500 MiB per file; server: 1 GiB per file, 600 s |
| data, developer | 50 MiB per file (data: both modes; developer: browser) |
| subtitle | 10 MiB per file (both modes) |
| font | 20 MiB per file (both modes) |
| ebook | server: 200 MiB per file |

Empty files are always refused (`file-empty`).

## Content limits

| Limit | Value | Enforced by |
| --- | --- | --- |
| Archive entries (`archive.maxEntries`) | 10 000 | 7-Zip listing check and extracted-tree walk; browser archive engine |
| Extracted size (`archive.maxExtractedBytes`) | 2 GiB | listing check, `fsize` while extracting, tree walk |
| Compression ratio (`archive.maxCompressionRatio`) | 200 : 1, checked once extracted content exceeds 100 MiB | listing check; browser archive engine |
| Entry path length (`archive.maxPathLength`) | 1024 | listing check |
| Nested archives (`archive.maxDepth`) | 0 — archives inside archives are extracted as plain files, never recursively | catalog setting; no engine extracts recursively |
| Media duration (`media.maxDurationSeconds`) | 1 hour | FFmpeg probe before transcoding |
| Pixels (`media.maxPixels`) | 100 MP | Poppler/rsvg render size, FFmpeg frame size, output validation; ImageMagick policy area (128 MP) |
| Pages (`media.maxPages`) | 500 | Poppler, qpdf |

## Where limits are enforced

| Layer | Checks | Code |
| --- | --- | --- |
| Browser converter | Route selection uses the mode's limits: a file too large for the browser goes to the server, too large for both is refused before upload | `packages/core/src/routing/select.ts`, `apps/web/src/components/converter/` |
| API, job creation | File count, sizes, totals for the server route's category; options; rate limits | `packages/jobs/src/service.ts` |
| Storage | Exact signed size per upload | `packages/storage` |
| Worker | Exact-size downloads; whole-job deadline (`maxJobSeconds` + 120 s); output size and pixels | `workers/runtime/src` |
| Engine process | CPU seconds from the deadline, address space (`VANILLATE_ENGINE_MEMORY_MB`, 4 GiB), largest written file (2 × `maxOutputBytes`, ≥ 64 MiB), 1024 open files; process-group kill on timeout | `packages/engines/src/runner.ts`, `util.ts` |
| Engine configuration | ImageMagick policy: memory 1 GiB, map 2 GiB, disk 4 GiB, area 128 MP, 32K × 32K pixels, 600 s, 2 threads | `packages/engines/config/imagemagick/policy.xml` |

Uploads go from the browser straight to storage, so platform request-body limits (e.g.
Vercel's function payload limit) do not cap file sizes; API bodies are metadata only (≤ 64 KiB).

## Retention

| Setting | Value | Meaning |
| --- | --- | --- |
| `abandonedUploadSeconds` | 3600 | A job that never gets its inputs expires after 60 minutes |
| `outputSeconds` | 3600 | Outputs are downloadable for 60 minutes |
| `failedSeconds` | 600 | Records of failed/cancelled jobs expire after 10 minutes (files are deleted immediately) |
| `signedUrlSeconds` | 900 | Lifetime of signed upload/download requests |
| `jobRecordSeconds` | 86400 | Expired job records are removed a day later |

## Rate limits

| Setting | Value |
| --- | --- |
| `rateLimits.jobsPerMinute` | 10 server jobs per client |
| `rateLimits.jobsPerHour` | 100 server jobs per client |

Browser conversions are not rate limited: they use the visitor's own device.

## Changing limits

1. Edit `catalog/limits.json` (the schema in `catalog/schema/limits.schema.json` gives editor
   validation).
2. Run `pnpm catalog:check` and `pnpm test`.
3. Consider the costs: server limits drive worker memory, disk (`WORKER_WORK_DIR` must hold
   inputs and outputs of `WORKER_CONCURRENCY` jobs), CPU time and storage. Raising video limits
   usually needs a dedicated `media` worker pool with more resources.
4. The privacy page and the docs read retention from the registry, so they stay correct; update
   this table.
