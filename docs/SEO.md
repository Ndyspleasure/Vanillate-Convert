# SEO

SEO is part of the architecture: every public page is generated from the registry, so pages,
the sitemap and the converter always agree on what is offered. Unsupported conversions never
get a page.

## URLs

Every page lives under a locale prefix; conversion slugs are localized.

| Page | English | Indonesian |
| --- | --- | --- |
| Home | `/en` | `/id` |
| All conversions | `/en/convert` | `/id/convert` |
| Conversion | `/en/convert/jpg-to-png` | `/id/convert/jpg-ke-png` |
| Formats / format | `/en/formats`, `/en/formats/pdf` | `/id/formats`, `/id/formats/pdf` |
| Category | `/en/categories/image` | `/id/categories/image` |
| Tools / tool | `/en/tools`, `/en/tools/pdf-merger` | `/id/tools`, … |
| Search | `/en/search?q=…` | `/id/search?q=…` |
| Privacy, About | `/en/privacy`, `/en/about` | `/id/privacy`, `/id/about` |

All paths come from one builder, `paths` in `packages/core/src/routing/slugs.ts`.

**Redirects and 404s** (`apps/web/src/app/[locale]/convert/[slug]/page.tsx`, `src/proxy.ts`):

- Non-canonical conversion slugs — aliases (`jpeg-to-png`), the other language's separator
  (`/id/convert/jpg-to-png`), different case — **308** to the canonical slug.
- Pairs that are not offered (`/en/convert/jpg-to-mp3`) and unknown formats are **404**.
- Paths without a locale (`/`, `/convert/jpg-to-png`) get a **307** to the visitor's language
  — saved choice (`vc-locale` cookie), then `Accept-Language`, then English — straight to the
  localized URL (`/id/convert/jpg-ke-png`), with `Vary: Accept-Language, Cookie`.
- Unknown locales are 404.
- On Vercel production deployments, every `*.vercel.app` host (the project alias and deployment
  URLs) gets a **308** to the canonical origin with path and query kept
  (`apps/web/src/config/redirects.ts`), so the site has one domain. Previews are not redirected.
  The canonical origin is `NEXT_PUBLIC_SITE_URL`, else Vercel's production domain.

## Generation

Pages are statically generated at build time (`generateStaticParams`) for both locales:
conversion pages for every offered conversion, plus all formats, categories and tools. Format,
category and tool routes reject unknown parameters (`dynamicParams = false`); conversion routes
resolve unknown slugs on request so aliases can redirect. A browser-only build
(`VANILLATE_SERVER_PROCESSING` not `enabled`) generates only pages for browser conversions.

### Conversion landing pages

Each offered conversion page has: an H1 ("Convert JPG to PNG"), status and processing-mode
badges, an introduction stating where it runs, the converter widget preset to the pair,
how-to steps, details (status explained, processing mode, engines, maximum size), quality notes,
limitations, an FAQ (privacy, size limit, sign-up, status), the reverse conversion and related
conversions from/to the same formats. All text is localized; names and descriptions come from
the catalog.

## Metadata

`pageMetadata()` (`apps/web/src/server/seo.ts`) gives every page:

- a localized title and description (conversion descriptions mention the formats, the processing
  mode and the status);
- `canonical` = the page's own localized URL;
- `alternates.languages` for every locale (`en`, `id-ID`) plus `x-default` (English);
- `robots`: `index, follow`, or `noindex, follow` for pages that must not be indexed;
- Open Graph (`og:locale` `en` / `id_ID`) and a Twitter summary card.

**Not indexed**: experimental and deprecated conversions (they have a page with a visible
warning, but `noindex` and no sitemap entry), tools that are not indexable, formats without
conversions, and search results (`noindex`, and disallowed in robots.txt).

`<html lang>` is set from the locale (`en`, `id-ID`).

### Structured data

JSON-LD is serialized with `<` escaped (`jsonLd()`), so content cannot break out of the script
element.

| Page | Types |
| --- | --- |
| Home | `WebSite` with a `SearchAction` |
| Conversion | `BreadcrumbList`, `WebApplication`, `FAQPage` |

## Sitemap and robots

`apps/web/src/app/sitemap.ts` lists, for both locales with language alternates: the static
pages, visible categories, **indexable** conversions, indexable tools and formats that have
conversions. `robots.ts` allows everything except `/api/` and search pages and points to the
sitemap. URLs use `NEXT_PUBLIC_SITE_URL` (or the Vercel production URL).

Current size: about 560 URLs for a browser-only deployment; with server processing, about 1300
indexable conversions per locale.

## Performance

Pages are static HTML served from the CDN; the converter is a client component, and engines load
on demand inside a Web Worker, so the first render does not download conversion code.

## Adding a locale

1. Add the locale to `LOCALES` in `packages/core/src/catalog/constants.ts`, its slug separator in
   `SLUG_SEPARATOR`, and names and tags in `apps/web/src/i18n/config.ts`.
2. Add `apps/web/src/i18n/messages/<locale>.json` (the i18n test enforces the same keys and
   placeholders as English) and the locale's text to every localized catalog field (the catalog
   schema requires it).
3. Negotiation, hreflang, sitemap alternates and static generation pick it up automatically.

## Adding a page type

Add the path to `paths`, generate it with `generateStaticParams` from the registry, use
`pageMetadata()` with an `index` rule that excludes unsupported or experimental content, add it
to the sitemap only when indexable, and cover it in `apps/web/e2e/site.spec.ts`.
