import type { Metadata } from 'next';
import Link from 'next/link';

import { paths } from '@vanillate/core';

import { StatusBadge } from '@/components/Badges.tsx';
import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { siteRegistry } from '@/server/site.ts';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/tools'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  return pageMetadata({
    locale,
    path: paths.tools,
    title: t.tools.title,
    description: t.tools.intro,
  });
}

export default async function ToolsPage({ params }: PageProps<'/[locale]/tools'>) {
  const { locale, t } = await pageLocale(params);
  const registry = siteRegistry();
  return (
    <>
      <Breadcrumbs
        items={[{ name: t.nav.home, href: paths.home(locale) }, { name: t.tools.title }]}
        label={t.nav.breadcrumbs}
      />
      <h1>{t.tools.title}</h1>
      <p className="lead">{t.tools.intro}</p>
      <ul className="grid">
        {registry.offeredTools().map((tool) => (
          <li key={tool.id}>
            <Link className="card card--link" href={paths.tool(locale, tool.id)}>
              <h3>{tool.name[locale]}</h3>
              <p className="muted">{tool.description[locale]}</p>
              {tool.status !== 'stable' && <StatusBadge status={tool.status} t={t} />}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
