# 0005 — Static localized pages, static CSP

**Decision.** All public pages are statically generated per locale from the registry
(`generateStaticParams`), using Next.js's classic caching model. Conversion routes resolve
unknown slugs on request only to redirect aliases or return 404. The Content-Security-Policy is
a static header (no nonces).

**Reason.** Thousands of SEO landing pages must be fast and cheap: static HTML from the CDN,
no per-request rendering. Nonce-based CSP would force dynamic rendering of every page.

**Alternatives.** Dynamic rendering with nonces (stricter CSP, much higher cost and latency);
incremental static regeneration (unnecessary: content changes only with deployments).

**Trade-offs.** The CSP must allow inline scripts (`'unsafe-inline'`); there is no user-supplied
HTML on the site, and downloads are served with a sandbox CSP. Whether server processing is
enabled is baked in at build time (`VANILLATE_SERVER_PROCESSING`).

**Impact.** Builds generate about 560 sitemap URLs browser-only and several thousand pages with server processing; pages are
served statically.
