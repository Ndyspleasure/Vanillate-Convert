import type { Metadata } from 'next';
import Link from 'next/link';

import { paths, search, type SearchResult } from '@vanillate/core';

import { format, type Messages } from '@/i18n/messages.ts';
import type { Locale } from '@/i18n/config.ts';
import { pageLocale } from '@/server/page.ts';
import { siteRegistry } from '@/server/site.ts';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/search'>): Promise<Metadata> {
  const { t } = await pageLocale(params);
  // Result pages are not indexed: every query would create a thin duplicate page.
  return { title: t.search.title, robots: { index: false, follow: true } };
}

function describe(result: SearchResult, locale: Locale, t: Messages) {
  const registry = siteRegistry();
  switch (result.type) {
    case 'conversion': {
      const { from, to } = result.conversion;
      return {
        kind: t.search.conversion,
        href: paths.conversion(locale, from, to),
        text: format(t.conversion.title, {
          from: registry.requireFormat(from).label,
          to: registry.requireFormat(to).label,
        }),
      };
    }
    case 'format':
      return {
        kind: t.search.format,
        href: paths.format(locale, result.format.id),
        text: `${result.format.label} — ${result.format.name[locale]}`,
      };
    case 'tool':
      return {
        kind: t.search.tool,
        href: paths.tool(locale, result.tool.id),
        text: result.tool.name[locale],
      };
    case 'category':
      return {
        kind: t.search.category,
        href: paths.category(locale, result.category.id),
        text: result.category.name[locale],
      };
  }
}

export default async function SearchPage({ params, searchParams }: PageProps<'/[locale]/search'>) {
  const { locale, t } = await pageLocale(params);
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 100).trim() ?? '';
  const results = query ? search(query, siteRegistry(), locale, 30) : [];
  return (
    <>
      <h1>{t.search.title}</h1>
      <form
        role="search"
        action={paths.search(locale)}
        method="get"
        className="converter__controls"
      >
        <div className="field" style={{ flex: '1 1 20rem' }}>
          <label htmlFor="search-query">{t.search.label}</label>
          <input id="search-query" type="search" name="q" defaultValue={query} maxLength={100} />
        </div>
        <button type="submit" className="button button--primary">
          {t.search.submit}
        </button>
      </form>
      {!query && <p className="muted">{t.search.hint}</p>}
      {query && results.length === 0 && <p>{format(t.search.empty, { query })}</p>}
      {results.length > 0 && (
        <>
          <h2>{format(t.search.results, { query })}</h2>
          <ul className="search-results">
            {results.map((result, index) => {
              const item = describe(result, locale, t);
              return (
                <li key={`${item.href}-${index}`}>
                  <span className="kind">{item.kind}</span>
                  <Link href={item.href}>{item.text}</Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
