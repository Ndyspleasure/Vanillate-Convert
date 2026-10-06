/**
 * Conversion landing pages, generated from the registry: one per offered conversion and
 * locale (`/en/convert/jpg-to-png`, `/id/convert/jpg-ke-png`). Aliases redirect to the
 * canonical slug; conversions that are not offered do not have pages. Experimental
 * conversions have a page but are not indexed.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { locale as rootLocale } from 'next/root-params';

import {
  conversionSlug,
  formatBytes,
  parseConversionSlug,
  paths,
  type Conversion,
  type Registry,
} from '@vanillate/core';

import { ModeBadge, StatusBadge } from '@/components/Badges.tsx';
import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { Converter } from '@/components/converter/Converter.tsx';
import { JsonLd } from '@/components/JsonLd.tsx';
import { isLocale, type Locale } from '@/i18n/config.ts';
import { format, type Messages } from '@/i18n/messages.ts';
import { pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { absoluteUrl, serverProcessingEnabled, siteRegistry } from '@/server/site.ts';

/** Unknown slugs are resolved on request: aliases redirect, everything else is a 404. */
export const dynamicParams = true;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const locale = await rootLocale();
  if (!isLocale(locale)) return [];
  return siteRegistry()
    .offeredConversions()
    .map((conversion) => ({ slug: conversionSlug(conversion.from, conversion.to, locale) }));
}

function resolve(slug: string, locale: Locale): { registry: Registry; conversion: Conversion } {
  const registry = siteRegistry();
  const parsed = parseConversionSlug(slug, locale, registry);
  if (!parsed?.conversion?.offered) notFound();
  if (!parsed.isCanonical)
    permanentRedirect(paths.conversion(locale, parsed.from.id, parsed.to.id));
  return { registry, conversion: parsed.conversion };
}

function modeText(conversion: Conversion, t: Messages, registry: Registry): string {
  return conversion.modes.includes('browser')
    ? t.converter.modeBrowser
    : format(t.converter.modeServer, {
        minutes: Math.round(registry.retention.outputSeconds / 60),
      });
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/convert/[slug]'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  const { slug } = await params;
  const { registry, conversion } = resolve(slug, locale);
  const from = registry.requireFormat(conversion.from);
  const to = registry.requireFormat(conversion.to);
  return pageMetadata({
    locale,
    path: (l) => paths.conversion(l, from.id, to.id),
    title: format(t.conversion.title, { from: from.label, to: to.label }),
    description: format(t.conversion.metaDescription, {
      from: from.label,
      to: to.label,
      fromName: from.name[locale],
      toName: to.name[locale],
      mode: conversion.modes.includes('browser')
        ? t.conversion.metaBrowser
        : t.conversion.metaServer,
      status: t.status[conversion.status],
    }),
    index: conversion.indexable,
  });
}

export default async function ConversionPage({ params }: PageProps<'/[locale]/convert/[slug]'>) {
  const { locale, t } = await pageLocale(params);
  const { slug } = await params;
  const { registry, conversion } = resolve(slug, locale);
  const from = registry.requireFormat(conversion.from);
  const to = registry.requireFormat(conversion.to);
  const route = registry.preferredRoute(conversion);
  const limits = route ? registry.limitsFor(route.mode, from.category) : null;
  const vars = {
    from: from.label,
    to: to.label,
    fromName: from.name[locale],
    toName: to.name[locale],
  };
  const reverse = registry.conversion(to.id, from.id);
  const moreFrom = registry
    .conversionsFrom(from.id)
    .filter((c) => c.to !== to.id)
    .slice(0, 16);
  const moreTo = registry
    .conversionsTo(to.id)
    .filter((c) => c.from !== from.id)
    .slice(0, 16);
  const limitations = conversion.limitations
    .map((id) => registry.limitation(id))
    .filter((l) => l !== undefined);
  const qualityNotes = [
    conversion.quality.lossless ? t.quality.lossless : null,
    conversion.quality.lossy ? t.quality.lossy : null,
    conversion.quality.metadataChanging ? t.quality.metadataChanging : null,
    conversion.quality.structureChanging ? t.quality.structureChanging : null,
    conversion.quality.resolutionChanging ? t.quality.resolutionChanging : null,
  ].filter((note): note is string => note !== null);
  const privacyAnswer = conversion.modes.includes('browser')
    ? t.conversion.faqPrivateBrowser
    : format(t.conversion.faqPrivateServer, {
        minutes: Math.round(registry.retention.outputSeconds / 60),
      });
  const faq = [
    { q: t.conversion.faqPrivateQ, a: privacyAnswer },
    ...(limits
      ? [
          {
            q: t.conversion.faqSizeQ,
            a: format(t.conversion.faqSizeA, { size: formatBytes(limits.maxInputBytes, locale) }),
          },
        ]
      : []),
    { q: t.conversion.faqSignupQ, a: t.conversion.faqSignupA },
    {
      q: t.conversion.faqStatusQ,
      a: format(t.conversion.faqStatusA, {
        status: t.status[conversion.status],
        statusText: t.conversion.statusText[conversion.status],
      }),
    },
  ];
  const title = format(t.conversion.title, vars);
  const crumbs = [
    { name: t.nav.home, href: paths.home(locale) },
    { name: t.conversion.breadcrumbConvert, href: paths.convertIndex(locale) },
    { name: title },
  ];

  return (
    <>
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumbs} />
      <section className="hero">
        <h1>{title}</h1>
        <p className="chips" style={{ margin: '0 0 0.75rem' }}>
          <StatusBadge status={conversion.status} t={t} />
          {conversion.modes.map((mode) => (
            <ModeBadge key={mode} mode={mode} t={t} />
          ))}
        </p>
        <p className="lead">
          {format(t.conversion.intro, { ...vars, modeText: modeText(conversion, t, registry) })}
        </p>
      </section>

      <Converter
        preset={{ kind: 'conversion', from: from.id, to: to.id }}
        serverProcessing={serverProcessingEnabled()}
      />

      <h2>{format(t.conversion.howTitle, vars)}</h2>
      <ol>
        <li>{format(t.conversion.how1, vars)}</li>
        <li>{t.conversion.how2}</li>
        <li>{format(t.conversion.how3, vars)}</li>
      </ol>

      <h2>{t.conversion.detailsTitle}</h2>
      <dl className="facts">
        <dt>{t.conversion.status}</dt>
        <dd>
          <StatusBadge status={conversion.status} t={t} />{' '}
          {t.conversion.statusText[conversion.status]}
        </dd>
        <dt>{t.conversion.processing}</dt>
        <dd>{conversion.modes.map((mode) => t.mode[mode]).join(', ')}</dd>
        {route && (
          <>
            <dt>{t.conversion.engines}</dt>
            <dd>{route.engines.map((id) => registry.engine(id)?.name ?? id).join(' → ')}</dd>
          </>
        )}
        {limits && (
          <>
            <dt>{t.conversion.maxSize}</dt>
            <dd>{formatBytes(limits.maxInputBytes, locale)}</dd>
          </>
        )}
      </dl>

      {qualityNotes.length > 0 && (
        <>
          <h3>{t.conversion.qualityTitle}</h3>
          <ul>
            {qualityNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}

      {limitations.length > 0 && (
        <>
          <h3>{t.converter.limitations}</h3>
          <ul className="limitations">
            {limitations.map((limitation) => (
              <li key={limitation.id} className={`severity-${limitation.severity}`}>
                {limitation.text[locale]}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{t.conversion.faqTitle}</h2>
      <dl className="faq">
        {faq.map((item) => (
          <div key={item.q}>
            <dt>{item.q}</dt>
            <dd>{item.a}</dd>
          </div>
        ))}
      </dl>

      <h2>{t.conversion.related}</h2>
      {reverse?.offered && (
        <p>
          <Link href={paths.conversion(locale, to.id, from.id)}>
            {format(t.conversion.reverse, vars)}
          </Link>
        </p>
      )}
      <div className="columns">
        {moreFrom.length > 0 && (
          <section>
            <h3>{format(t.conversion.moreFrom, vars)}</h3>
            <ul className="link-list">
              {moreFrom.map((c) => (
                <li key={c.key}>
                  <Link href={paths.conversion(locale, c.from, c.to)}>
                    {format(t.conversion.title, {
                      from: from.label,
                      to: registry.requireFormat(c.to).label,
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {moreTo.length > 0 && (
          <section>
            <h3>{format(t.conversion.moreTo, vars)}</h3>
            <ul className="link-list">
              {moreTo.map((c) => (
                <li key={c.key}>
                  <Link href={paths.conversion(locale, c.from, c.to)}>
                    {format(t.conversion.title, {
                      from: registry.requireFormat(c.from).label,
                      to: to.label,
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: crumbs.map((crumb, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              name: crumb.name,
              item: absoluteUrl(crumb.href ?? paths.conversion(locale, from.id, to.id)),
            })),
          },
          {
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: title,
            url: absoluteUrl(paths.conversion(locale, from.id, to.id)),
            applicationCategory: 'UtilitiesApplication',
            operatingSystem: 'Any',
            inLanguage: locale,
          },
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map((item) => ({
              '@type': 'Question',
              name: item.q,
              acceptedAnswer: { '@type': 'Answer', text: item.a },
            })),
          },
        ]}
      />
    </>
  );
}
