import Link from 'next/link';

import { paths } from '@vanillate/core';

import type { Locale } from '@/i18n/config.ts';
import type { Messages } from '@/i18n/messages.ts';

import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { Logo } from './Logo.tsx';

export function Header({ locale, t }: { locale: Locale; t: Messages }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href={paths.home(locale)} className="brand">
          <Logo />
          {t.meta.siteName}
        </Link>
        <nav className="site-nav" aria-label={t.nav.home}>
          <Link href={paths.convertIndex(locale)}>{t.nav.convert}</Link>
          <Link href={paths.formats(locale)}>{t.nav.formats}</Link>
          <Link href={paths.tools(locale)}>{t.nav.tools}</Link>
        </nav>
        <form className="header-search" role="search" action={paths.search(locale)} method="get">
          <label className="visually-hidden" htmlFor="site-search">
            {t.nav.search}
          </label>
          <input
            id="site-search"
            type="search"
            name="q"
            placeholder={t.nav.searchPlaceholder}
            autoComplete="off"
            maxLength={100}
          />
          <button type="submit" className="button button--small">
            {t.nav.search}
          </button>
        </form>
        <LanguageSwitcher locale={locale} label={t.nav.language} />
      </div>
    </header>
  );
}
