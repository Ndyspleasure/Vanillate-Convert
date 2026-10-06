/**
 * Metadata helpers: canonical URLs, hreflang alternates and JSON-LD.
 */
import 'server-only';

import type { Metadata } from 'next';

import { DEFAULT_LOCALE, LOCALES, LOCALE_TAGS, type Locale } from '@/i18n/config.ts';
import { getMessages } from '@/i18n/messages.ts';

import { absoluteUrl } from './site.ts';

interface PageMetaInput {
  locale: Locale;
  /** The same page's path in each locale (slugs can differ per locale). */
  path: (locale: Locale) => string;
  title: string;
  description: string;
  /** False for pages that must not be indexed (e.g. experimental conversions). */
  index?: boolean;
}

export function pageMetadata({
  locale,
  path,
  title,
  description,
  index = true,
}: PageMetaInput): Metadata {
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[LOCALE_TAGS[l]] = absoluteUrl(path(l));
  languages['x-default'] = absoluteUrl(path(DEFAULT_LOCALE));
  const url = absoluteUrl(path(locale));
  const siteName = getMessages(locale).meta.siteName;
  return {
    title,
    description,
    alternates: { canonical: url, languages },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      siteName,
      locale: LOCALE_TAGS[locale].replace('-', '_'),
    },
    twitter: { card: 'summary', title, description },
  };
}

/** Serializes JSON-LD safely for an inline script (no `</script>` breakout). */
export function jsonLd(data: unknown): string {
  // Escaping `<` prevents `</script>` and `<!--` from ending the script element early.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
