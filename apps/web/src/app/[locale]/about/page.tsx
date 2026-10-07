import type { Metadata } from 'next';

import { paths, STATUSES } from '@vanillate/core';

import { StatusBadge } from '@/components/Badges.tsx';
import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/about'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  return pageMetadata({
    locale,
    path: paths.about,
    title: t.about.title,
    description: t.about.text,
  });
}

export default async function AboutPage({ params }: PageProps<'/[locale]/about'>) {
  const { locale, t } = await pageLocale(params);
  return (
    <>
      <Breadcrumbs
        items={[{ name: t.nav.home, href: paths.home(locale) }, { name: t.about.title }]}
        label={t.nav.breadcrumbs}
      />
      <h1>{t.about.title}</h1>
      <p className="lead">{t.about.text}</p>
      <h2>{t.about.statusTitle}</h2>
      <dl className="facts">
        {STATUSES.filter((status) => status !== 'unsupported').map((status) => (
          <div key={status} style={{ display: 'contents' }}>
            <dt>
              <StatusBadge status={status} t={t} />
            </dt>
            <dd>{t.conversion.statusText[status]}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
