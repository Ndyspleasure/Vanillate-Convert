# 0001 — Registry-driven catalog

**Decision.** Formats, engines, conversion rules, tools, options, limitations and limits are
JSON in `catalog/`, validated by zod schemas and compiled into an immutable `Registry`.
Conversion rules select formats by id, category or trait and expand into concrete routes.
Pages, the sitemap, API validation and worker routing all read the registry.

**Reason.** The target is hundreds of formats and thousands of conversion paths. Writing a
converter per pair does not scale and drifts between UI, SEO and backend. Data plus a generic
pipeline does.

**Alternatives.** A database-backed registry (needs an admin UI and migrations for every
change; harder to review); code-defined converters per pair (duplication).

**Trade-offs.** The compiler is non-trivial (status capping, overrides, derived limitations),
and some engine behaviour still needs adapter code. Catalog mistakes are caught by
`pnpm catalog:check` and tests rather than by types.

**Impact.** Most new conversions are catalog edits reviewed as diffs; the conversion matrix
document is generated from the same data.
