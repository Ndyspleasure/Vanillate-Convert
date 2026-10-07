import Link from 'next/link';
import { locale as rootLocale } from 'next/root-params';

import { DEFAULT_LOCALE, isLocale } from '@/i18n/config.ts';
import { getMessages } from '@/i18n/messages.ts';

export default async function NotFound() {
  const value = await rootLocale();
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  const t = getMessages(locale);
  return (
    <section className="hero">
      <h1>{t.notFound.title}</h1>
      <p className="lead">{t.notFound.text}</p>
      <Link className="button button--primary" href={`/${locale}`}>
        {t.notFound.home}
      </Link>
    </section>
  );
}
