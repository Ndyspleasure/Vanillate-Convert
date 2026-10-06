'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, localizePath, type Locale } from '@/i18n/config.ts';

/** Saves the language choice for the proxy's redirects (a year; not used for tracking). */
function remember(target: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
}

/** Links to the current page in every language; remembers the choice in a cookie. */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="lang-switch" aria-label={label}>
      {LOCALES.map((target) => (
        <Link
          key={target}
          href={localizePath(pathname, target)}
          hrefLang={target}
          lang={target}
          aria-current={target === locale ? 'true' : undefined}
          onClick={() => remember(target)}
        >
          {LOCALE_NAMES[target]}
        </Link>
      ))}
    </nav>
  );
}
