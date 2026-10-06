import type { Metadata } from 'next';
import Link from 'next/link';

import { paths } from '@vanillate/core';

import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { format } from '@/i18n/messages.ts';
import { formatNumber, pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { siteRegistry } from '@/server/site.ts';

function stats() {
  const registry = siteRegistry();
  const categories = registry.visibleCategories();
  const formats = registry.formats.filter((f) => f.readable || f.writable);
  return { registry, categories, formats };
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/formats'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  const { categories, formats } = stats();
  return pageMetadata({
    locale,
    path: paths.formats,
    title: t.format.allTitle,
    description: format(t.format.allIntro, {
      count: formatNumber(formats.length, locale),
      categories: formatNumber(categories.length, locale),
    }),
  });
}

export default async function FormatsPage({ params }: PageProps<'/[locale]/formats'>) {
  const { locale, t } = await pageLocale(params);
  const { registry, categories, formats } = stats();
  const offered = new Set(formats.map((f) => f.id));
  return (
    <>
      <Breadcrumbs
        items={[{ name: t.nav.home, href: paths.home(locale) }, { name: t.format.allTitle }]}
        label={t.nav.breadcrumbs}
      />
      <h1>{t.format.allTitle}</h1>
      <p className="lead">
        {format(t.format.allIntro, {
          count: formatNumber(formats.length, locale),
          categories: formatNumber(categories.length, locale),
        })}
      </p>
      <div className="columns">
        {categories.map((category) => (
          <section key={category.id}>
            <h2>
              <Link href={paths.category(locale, category.id)}>{category.name[locale]}</Link>
            </h2>
            <ul className="link-list">
              {category.formatIds
                .filter((id) => offered.has(id))
                .map((id) => registry.requireFormat(id))
                .map((f) => (
                  <li key={f.id}>
                    <Link href={paths.format(locale, f.id)}>{f.label}</Link>{' '}
                    <span className="muted">{f.name[locale]}</span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
