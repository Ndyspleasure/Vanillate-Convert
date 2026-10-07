import type { Metadata } from 'next';
import Link from 'next/link';

import { paths } from '@vanillate/core';

import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { format } from '@/i18n/messages.ts';
import { formatNumber, pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { siteRegistry } from '@/server/site.ts';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/convert'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  const registry = siteRegistry();
  return pageMetadata({
    locale,
    path: paths.convertIndex,
    title: t.conversion.allTitle,
    description: format(t.conversion.allIntro, {
      count: formatNumber(registry.offeredConversions().length, locale),
      formats: formatNumber(registry.formats.filter((f) => f.readable).length, locale),
    }),
  });
}

/** Every offered conversion, grouped by category and input format. */
export default async function ConvertIndexPage({ params }: PageProps<'/[locale]/convert'>) {
  const { locale, t } = await pageLocale(params);
  const registry = siteRegistry();
  return (
    <>
      <Breadcrumbs
        items={[{ name: t.nav.home, href: paths.home(locale) }, { name: t.conversion.allTitle }]}
        label={t.nav.breadcrumbs}
      />
      <h1>{t.conversion.allTitle}</h1>
      <p className="lead">
        {format(t.conversion.allIntro, {
          count: formatNumber(registry.offeredConversions().length, locale),
          formats: formatNumber(registry.formats.filter((f) => f.readable).length, locale),
        })}
      </p>
      {registry.visibleCategories().map((category) => {
        const sources = category.formatIds
          .map((id) => registry.requireFormat(id))
          .filter((f) => registry.conversionsFrom(f.id).length > 0);
        if (sources.length === 0) return null;
        return (
          <section key={category.id}>
            <h2>
              <Link href={paths.category(locale, category.id)}>{category.name[locale]}</Link>
            </h2>
            <div className="columns">
              {sources.map((source) => (
                <section key={source.id}>
                  <h3>
                    <Link href={paths.format(locale, source.id)}>{source.label}</Link>
                  </h3>
                  <ul className="link-list">
                    {registry.conversionsFrom(source.id).map((c) => (
                      <li key={c.key}>
                        <Link href={paths.conversion(locale, c.from, c.to)}>
                          {format(t.conversion.title, {
                            from: source.label,
                            to: registry.requireFormat(c.to).label,
                          })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
