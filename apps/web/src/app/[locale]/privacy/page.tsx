/**
 * Privacy page. Every number comes from the registry's retention policy, the same values the
 * job service and sweeper enforce, so the page cannot drift from the implementation.
 */
import type { Metadata } from 'next';

import { paths } from '@vanillate/core';

import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { format } from '@/i18n/messages.ts';
import { pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { serverProcessingEnabled, siteRegistry } from '@/server/site.ts';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/privacy'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  return pageMetadata({
    locale,
    path: paths.privacy,
    title: t.privacy.title,
    description: t.privacy.metaDescription,
  });
}

export default async function PrivacyPage({ params }: PageProps<'/[locale]/privacy'>) {
  const { locale, t } = await pageLocale(params);
  const retention = siteRegistry().retention;
  const minutes = (seconds: number) => Math.round(seconds / 60);
  const p = t.privacy;
  return (
    <>
      <Breadcrumbs
        items={[{ name: t.nav.home, href: paths.home(locale) }, { name: p.title }]}
        label={t.nav.breadcrumbs}
      />
      <h1>{p.title}</h1>
      <p className="lead">{p.intro}</p>

      <h2>{p.browserTitle}</h2>
      <p>{p.browserText}</p>

      {serverProcessingEnabled() && (
        <>
          <h2>{p.serverTitle}</h2>
          <p>{p.serverText}</p>
          <h2>{p.retentionTitle}</h2>
          <ul>
            <li>{p.retentionInput}</li>
            <li>
              {format(p.retentionOutput, { outputMinutes: minutes(retention.outputSeconds) })}
            </li>
            <li>
              {format(p.retentionAbandoned, {
                abandonedMinutes: minutes(retention.abandonedUploadSeconds),
              })}
            </li>
            <li>
              {format(p.retentionFailed, { failedMinutes: minutes(retention.failedSeconds) })}
            </li>
            <li>
              {format(p.retentionRecord, {
                recordHours: Math.round(retention.jobRecordSeconds / 3600),
              })}
            </li>
          </ul>
          <h2>{p.accessTitle}</h2>
          <p>{format(p.accessText, { linkMinutes: minutes(retention.signedUrlSeconds) })}</p>
          <h2>{p.logsTitle}</h2>
          <p>{p.logsText}</p>
        </>
      )}

      <h2>{p.cookiesTitle}</h2>
      <p>{p.cookiesText}</p>
    </>
  );
}
