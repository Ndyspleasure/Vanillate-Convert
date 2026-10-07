# Format registry

The catalog (`catalog/`) is the single source of truth for what Vanillate Convert supports.
It is plain JSON, validated by zod schemas (`packages/core/src/catalog/schema.ts`) and compiled
into an immutable `Registry` (`packages/core/src/registry/`) that the web app, the API and the
workers all use. The generated list of offered conversions is
[CONVERSION-MATRIX.md](CONVERSION-MATRIX.md).

## Catalog files

| File | Contents |
| --- | --- |
| `catalog/formats/<category>.json` | Formats: identity, names, detection, traits |
| `catalog/conversions/<category>.json` | Conversion **rules** that expand into routes |
| `catalog/engines/<engine>.json` | Engines: mode, pool, binaries, capabilities, license, status |
| `catalog/tools.json` | Tools (format, compress, merge, extract, inspect, …) and their engine routes |
| `catalog/options.json` | Reusable option definitions (type, default, range, choices, labels) |
| `catalog/limitations.json` | User-facing limitation notes (id/en) |
| `catalog/limits.json` | Size, time, archive, media, retention and rate limits ([LIMITS.md](LIMITS.md)) |
| `catalog/categories.json` | Categories with names, descriptions and order |
| `catalog/popular.json` | Curated popular conversions and tools for the home page |
| `catalog/index.ts` | Aggregates every file (a check fails if a JSON file is not listed) |
| `catalog/schema/*.schema.json` | JSON Schemas generated from the zod schemas, for editor validation |

All user-visible text is bilingual (`{ "en": …, "id": … }`).

## Formats

```json
{
  "id": "png",
  "label": "PNG",
  "name": { "en": "PNG image", "id": "Gambar PNG" },
  "description": { "en": "Lossless image format with full transparency, …", "id": "…" },
  "category": "image",
  "extensions": ["png"],
  "mimeTypes": ["image/png"],
  "signatures": [[{ "hex": "89504E470D0A1A0A" }]],
  "traits": ["raster", "lossless", "alpha", "binary"],
  "popularity": 98
}
```

- `id`: lowercase alphanumeric; used in URLs and the API. `aliases` (e.g. `jpeg`) resolve to
  it, and alias URLs redirect to the canonical one.
- `category` (primary) and optional `categories` (secondary).
- `signatures`: byte patterns (with offsets) — any matching group identifies the format.
  `sniff` rules cover text formats (JSON, CSV, XML, SVG, …) and containers.
- `traits` describe the format (raster, vector, lossless, lossy, alpha, animated, text,
  container, …); rules can select formats by trait and quality notes are derived from them.
- `status`: an editorial cap (e.g. a format known to be hard to read is never better than
  `experimental`), and `notes` for the format page.

Derived at compile time: `readable` / `writable` (has offered conversions from / to it),
`support` (best offered status per mode) and `engines`.

## Conversion rules

A rule describes a family of conversions that one engine pipeline performs:

```json
{
  "id": "image.browser.raster",
  "mode": "browser",
  "steps": ["browser-image"],
  "from": { "formats": ["jpg", "png", "webp", "gif", "bmp", "ico", "avif"] },
  "to": { "formats": ["jpg", "png", "webp", "bmp", "ico", "tiff"] },
  "status": "stable",
  "priority": 10,
  "metadata": "strip",
  "options": ["width", "height"],
  "limitations": ["color-srgb"],
  "overrides": [
    { "to": "jpg", "addOptions": ["quality", "background"] },
    { "to": "tiff", "status": "supported" },
    { "from": "avif", "status": "supported" }
  ]
}
```

- `from` / `to` select formats by `formats`, `categories` and/or `traits`, with `exclude`.
  The compiler expands every pair (`from === to` only with `identity: true`), minus `exclude`d
  pairs.
- `steps`: one to three engines executed in order; intermediate formats are listed in `via`.
- `mode`: `browser` or `server`. Server routes run on the engine's worker pool.
- `priority`: lower is preferred when several routes serve the same pair.
- `cardinality` (`1:1`, `1:n`, `n:1`, `n:n`) and `batch` describe how files map to outputs.
- `metadata`: `preserve`, `strip`, `transform` or `unsupported`.
- `options`: references into `options.json` (with per-rule overrides of defaults/ranges).
- `limitations`, `imperfect` (output known to be approximate, e.g. PDF → DOCX).
- `overrides`: per-pair changes (status, options, limitations, cardinality).

## Engines and tools

Engine files declare `mode`, `pool`, `binaries`, `capabilities.read/write`, `status`,
`license` and `licenseNotes` — see [ENGINE-MAPPING.md](ENGINE-MAPPING.md). Tools
(`tools.json`) declare inputs (format ids, or `*` for any file), output (`same`, `detect` or a
format), cardinality, metadata policy, limitations and one or more routes
`{ engine, mode, operation, status, priority, options, inputs? }`.

## Statuses

| Status | Meaning | Offered | Indexed |
| --- | --- | --- | --- |
| `stable` | Tested, works for typical files | yes | yes |
| `supported` | Works; less common or with minor caveats | yes | yes |
| `limited` | Works with notable limitations (shown to the user) | yes | yes |
| `experimental` | May fail or produce imperfect results; labeled with a warning | yes | **no** (`noindex`, not in the sitemap) |
| `deprecated` | Kept for compatibility; labeled | yes | no |
| `unsupported` | Not offered; no page exists | no | no |

A route's **effective status** is the worst of the rule's status (after overrides), the
engine's cap (`available` → stable, `degraded` → limited, `experimental`, `deprecated`,
`unavailable`/`disabled` → unsupported) and both formats' caps. A **conversion** (a `from → to`
pair) is offered when at least one route is; its status is that of its best offered route, and
it is indexable only when that status is `stable`, `supported` or `limited`.

### Deployment views

`getRegistry(options)` compiles a view of the same catalog:

- `disabledModes: ['server']` — a browser-only deployment (the web app does this unless
  `VANILLATE_SERVER_PROCESSING=enabled`): server routes are not offered, so their pages,
  sitemap entries and API targets disappear.
- `engineStatus: { <engine>: <status> }` — forces an engine's status (e.g. `disabled`), which
  lowers or removes every route that uses it.

## Quality and limitations

Each conversion carries a quality model — `lossless`, `lossy`, `metadataChanging`,
`resolutionChanging`, `structureChanging`, `potentiallyImperfect` — derived from the formats'
traits and the rule (`packages/core/src/registry/quality.ts`). Derived limitation notes (e.g.
transparency lost when converting to a format without alpha, animation reduced to the first
frame) are added automatically; explicit ones come from rules. Warnings are listed first.
Pages and the converter show both.

## Detection

Formats are recognized by content (`packages/core/src/detection/`), with the extension only as
a hint:

1. **Signatures** — magic bytes at given offsets (`signatures` in the format entry).
2. **Containers** — `sniff: { type: "zip" }` matches ZIP-based formats (DOCX, XLSX, PPTX, ODF,
   EPUB, …) by entry names, prefixes or the `mimetype` entry; `sniff: { type: "ole" }` matches
   legacy Office compound files (DOC, XLS, PPT) by stream names.
3. **Structured text** — `json` (optionally requiring keys), `ndjson`, `xml` (by root element,
   e.g. SVG) and `text` (a regular expression over the decoded head: CSV, YAML, subtitles, …),
   with the extension deciding between equally plausible text formats.
4. **Compressed tar** — `tar-in` recognizes a tar archive inside gzip (`.tar.gz`).

All rules are data in the format entries; the matching code is generic.

Detection runs in the browser before upload, in the API when an upload completes, and again in
the worker. When the content contradicts what the page or job expects, the result is
`format-mismatch` ("This file looks like CSV, not PNG").

## Route selection

`selectRoute(routes, category, files, { serverAvailable, browserSupports }, registry)`
(`packages/core/src/routing/select.ts`) picks the first offered route, in priority order, that
fits: the files are within the mode's limits, the browser supports the engine's needs (e.g.
canvas can decode and encode the formats), and server processing is available for server
routes. Browser routes come first on equal priority. If nothing fits it reports the most helpful
reason (`file-too-large`, `browser-unsupported`, `server-processing-disabled`, …).

## Adding things

**A format**

1. Add the entry to `catalog/formats/<category>.json` with names in both languages, extensions,
   MIME types, signatures or sniff rules, and traits.
2. Add it to the `from`/`to` selectors of rules whose engines can handle it, and to the engine's
   `capabilities` in `catalog/engines/<engine>.json`.
3. Add a detection test (`packages/core/src/detection/detect.test.ts`) and, for server engines,
   a conversion test in `packages/engines/test/engines.integration.test.ts`.

**A conversion** an existing engine supports — add or extend a rule; usually no code changes.

**An engine** — add `catalog/engines/<id>.json`, an adapter in
`packages/engines/src/engines/<id>.ts` (server) or `packages/browser-engines/src/` (browser),
register it in `SERVER_ENGINES` / the browser engine map, add it to the worker image, and write
integration tests. Review its license ([ENGINE-MAPPING.md](ENGINE-MAPPING.md#licensing)).

**A tool** — add it to `catalog/tools.json` with routes to engines that implement the
operation.

Then run:

```
pnpm catalog:check    # schema, references, expansion, generated files up to date
pnpm catalog:schema   # after changing the zod schemas
pnpm docs:matrix      # regenerate docs/CONVERSION-MATRIX.md
pnpm test
```

## Current size

`pnpm catalog:check` reports: 182 formats, 17 engines, 1554 offered conversions (1294
indexable) and 24 tools; a browser-only deployment offers 205 conversions and 16 tools.
