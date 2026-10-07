import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { paths, type Category, type Registry } from '@vanillate/core';

import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { format } from '@/i18n/messages.ts';
import { pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { siteRegistry } from '@/server/site.ts';

export function generateStaticParams(): { category: string }[] {
  return siteRegistry()
    .visibleCategories()
    .map((category) => ({ category: category.id }));
}

export const dynamicParams = false;

function resolve(id: string): { registry: Registry; category: Category } {
  const registry = siteRegistry();
  const category = registry.visibleCategories().find((c) => c.id === id);
  if (!category) notFound();
  return { registry, category };
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/categories/[category]'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  const { category } = resolve((await params).category);
  return pageMetadata({
    locale,
    path: (l) => paths.category(l, category.id),
    title: format(t.category.title, { name: category.name[locale] }),
    description: category.description[locale],
  });
}

export default async function CategoryPage({
  params,
}: PageProps<'/[locale]/categories/[category]'>) {
  const { locale, t } = await pageLocale(params);
  const { registry, category } = resolve((await params).category);
  const formats = category.formatIds
    .map((id) => registry.requireFormat(id))
    .filter((f) => f.readable || f.writable);
  const ids = new Set(category.formatIds);
  const conversions = registry
    .offeredConversions()
    .filter((c) => ids.has(c.from) && c.indexable)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 40);
  const name = category.name[locale];
  return (
    <>
      <Breadcrumbs
        items={[{ name: t.nav.home, href: paths.home(locale) }, { name }]}
        label={t.nav.breadcrumbs}
      />
      <h1>{format(t.category.title, { name })}</h1>
      <p className="lead">{category.description[locale]}</p>
      {conversions.length > 0 && (
        <>
          <h2>{format(t.category.conversions, { name })}</h2>
          <ul className="chips">
            {conversions.map((c) => (
              <li key={c.key}>
                <Link className="chip" href={paths.conversion(locale, c.from, c.to)}>
                  {format(t.conversion.title, {
                    from: registry.requireFormat(c.from).label,
                    to: registry.requireFormat(c.to).label,
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>{t.category.formats}</h2>
      <ul className="grid">
        {formats.map((f) => (
          <li key={f.id}>
            <Link className="card card--link" href={paths.format(locale, f.id)}>
              <h3>{f.label}</h3>
              <p className="muted">{f.name[locale]}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
