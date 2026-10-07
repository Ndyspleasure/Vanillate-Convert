import '../globals.css';

import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Footer } from '@/components/Footer.tsx';
import { Header } from '@/components/Header.tsx';
import { I18nProvider } from '@/i18n/client.tsx';
import { isLocale, LOCALE_TAGS, LOCALES } from '@/i18n/config.ts';
import { getMessages } from '@/i18n/messages.ts';
import { siteUrl } from '@/server/site.ts';

export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getMessages(locale);
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t.meta.siteName, template: `%s · ${t.meta.siteName}` },
    applicationName: t.meta.siteName,
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fffdf8' },
    { media: '(prefers-color-scheme: dark)', color: '#14110f' },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getMessages(locale);
  return (
    <html lang={LOCALE_TAGS[locale]}>
      <body>
        <I18nProvider
          locale={locale}
          messages={{
            converter: t.converter,
            status: t.status,
            mode: t.mode,
            error: t.error,
            quality: t.quality,
          }}
        >
          <a className="skip-link" href="#main">
            {t.nav.skipToContent}
          </a>
          <Header locale={locale} t={t} />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer locale={locale} t={t} />
        </I18nProvider>
      </body>
    </html>
  );
}
