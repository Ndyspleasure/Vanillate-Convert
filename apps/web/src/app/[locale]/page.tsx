import type { Metadata } from 'next';
import Link from 'next/link';

import { paths } from '@vanillate/core';

import { Converter } from '@/components/converter/Converter.tsx';
import { JsonLd } from '@/components/JsonLd.tsx';
import { format } from '@/i18n/messages.ts';
import { formatNumber, pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { absoluteUrl, serverProcessingEnabled, siteRegistry } from '@/server/site.ts';

function counts() {
  const registry = siteRegistry();
  return {
    formats: registry.formats.filter((f) => f.readable || f.writable).length,
    conversions: registry.offeredConversions().length,
  };
}

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  const metadata = pageMetadata({
    locale,
    path: paths.home,
    title: t.meta.homeTitle,
    description: format(t.meta.homeDescription, {
      formats: formatNumber(counts().formats, locale),
    }),
  });
  return { ...metadata, title: { absolute: t.meta.homeTitle } };
}

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale, t } = await pageLocale(params);
  const registry = siteRegistry();
  const popular = registry.popular();
  const { formats, conversions } = counts();
  return (
    <>
      <section className="hero">
        <h1>{t.home.title}</h1>
        <p className="lead">
          {format(t.home.subtitle, {
            formats: formatNumber(formats, locale),
            conversions: formatNumber(conversions, locale),
          })}
        </p>
      </section>

      <Converter preset={{ kind: 'open' }} serverProcessing={serverProcessingEnabled()} />

      <h2>{t.home.popularConversions}</h2>
      <ul className="chips">
        {popular.conversions.map((conversion) => (
          <li key={conversion.key}>
            <Link className="chip" href={paths.conversion(locale, conversion.from, conversion.to)}>
              {format(t.conversion.title, {
                from: registry.requireFormat(conversion.from).label,
                to: registry.requireFormat(conversion.to).label,
              })}
            </Link>
          </li>
        ))}
      </ul>
      <p>
        <Link href={paths.convertIndex(locale)}>{t.home.allConversions}</Link>
      </p>

      {popular.tools.length > 0 && (
        <>
          <h2>{t.home.popularTools}</h2>
          <ul className="grid">
            {popular.tools.map((tool) => (
              <li key={tool.id}>
                <Link className="card card--link" href={paths.tool(locale, tool.id)}>
                  <h3>{tool.name[locale]}</h3>
                  <p className="muted">{tool.description[locale]}</p>
                </Link>
              </li>
            ))}
          </ul>
          <p>
            <Link href={paths.tools(locale)}>{t.home.allTools}</Link>
          </p>
        </>
      )}

      <h2>{t.home.categories}</h2>
      <ul className="grid">
        {registry.visibleCategories().map((category) => (
          <li key={category.id}>
            <Link className="card card--link" href={paths.category(locale, category.id)}>
              <h3>{category.name[locale]}</h3>
              <p className="muted">{category.description[locale]}</p>
            </Link>
          </li>
        ))}
      </ul>

      <h2>{t.home.principles}</h2>
      <ul className="grid">
        <li className="card">
          <h3>{t.home.principleBrowserTitle}</h3>
          <p className="muted">{t.home.principleBrowserText}</p>
        </li>
        <li className="card">
          <h3>{t.home.principleServerTitle}</h3>
          <p className="muted">{t.home.principleServerText}</p>
        </li>
        <li className="card">
          <h3>{t.home.principleHonestTitle}</h3>
          <p className="muted">{t.home.principleHonestText}</p>
        </li>
      </ul>

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: t.meta.siteName,
          url: absoluteUrl(paths.home(locale)),
          inLanguage: locale,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${absoluteUrl(paths.search(locale))}?q={query}`,
            'query-input': 'required name=query',
          },
        }}
      />
    </>
  );
}
