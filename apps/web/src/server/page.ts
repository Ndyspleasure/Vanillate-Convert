/** Small helpers shared by page components. */
import 'server-only';

import { notFound } from 'next/navigation';

import { isLocale, LOCALE_TAGS, type Locale } from '@/i18n/config.ts';
import { getMessages, type Messages } from '@/i18n/messages.ts';

/** Validates the `[locale]` segment (404 for anything else) and loads its dictionary. */
export async function pageLocale(params: Promise<{ locale: string }>): Promise<{
  locale: Locale;
  t: Messages;
}> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, t: getMessages(locale) };
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale]).format(value);
}
